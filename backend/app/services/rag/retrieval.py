import uuid
from collections import defaultdict
from typing import Any, cast

from pgvector import Vector
from sqlalchemy import text
from sqlmodel import Session, col, select

from app.domain import (
    Chunk,
    ChunkEmbedding,
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentIndex,
    DocumentPage,
    EmbeddingProfile,
)
from app.schemas.research import EvidencePublic
from app.services.models.contracts import ProviderError
from app.services.models.providers import get_provider
from app.services.privacy.consent import require_consent


def reciprocal_rank_fusion(
    rankings: list[list[uuid.UUID]], k: int = 60
) -> list[tuple[uuid.UUID, float]]:
    scores: dict[uuid.UUID, float] = defaultdict(float)
    for ranking in rankings:
        for rank, identifier in enumerate(dict.fromkeys(ranking), 1):
            scores[identifier] += 1 / (k + rank)
    return sorted(scores.items(), key=lambda item: (-item[1], str(item[0])))


def evidence_for_chunk(
    session: Session, chunk_id: uuid.UUID, label: int = 0, score: float = 0
) -> list[EvidencePublic]:
    chunk = session.get(Chunk, chunk_id)
    if not chunk:
        return []
    rows = session.exec(
        select(ChunkProvenance, DocumentElement, DocumentPage, Document)
        .select_from(ChunkProvenance)
        .join(
            DocumentElement, col(DocumentElement.id) == col(ChunkProvenance.element_id)
        )
        .join(DocumentPage, col(DocumentPage.id) == col(DocumentElement.page_id))
        .join(
            Document,
            col(Document.current_version_id) == col(DocumentPage.version_id),
            isouter=True,
        )
        .where(col(ChunkProvenance.chunk_id) == chunk_id)
    ).all()
    result = []
    for provenance, element, page, document in rows:
        if document is None:
            from app.domain import DocumentVersion

            version = session.get(DocumentVersion, page.version_id)
            document = session.get(Document, version.document_id) if version else None
        if not document:
            continue
        result.append(
            EvidencePublic(
                chunk_id=chunk.id,
                element_id=element.id,
                document_id=document.id,
                version_id=page.version_id,
                document_title=document.title,
                page_number=page.page_number,
                text=element.text[provenance.span_start : provenance.span_end]
                or chunk.text,
                bbox=element.bbox,
                rotation=page.rotation,
                precision="region" if element.bbox else "page",
                label=label,
                score=score,
            )
        )
    return result


def retrieve(
    session: Session,
    document_ids: list[uuid.UUID],
    question: str,
    *,
    top_k: int = 8,
    selected_element_id: uuid.UUID | None = None,
) -> tuple[list[EvidencePublic], str]:
    if not document_ids:
        return [], "lexical"
    documents = session.exec(
        select(Document).where(col(Document.id).in_(document_ids))
    ).all()  # type: ignore[attr-defined]
    versions = [
        document.current_version_id
        for document in documents
        if document.current_version_id
    ]
    if not versions:
        return [], "lexical"
    lexical = (
        session.connection()
        .execute(
            text("""
        SELECT id FROM chunk
        WHERE version_id = ANY(:versions)
        AND (to_tsvector('spanish', contextualized_text) || to_tsvector('english', contextualized_text))
          @@ (websearch_to_tsquery('spanish', :question) || websearch_to_tsquery('english', :question))
        ORDER BY ts_rank_cd(to_tsvector('spanish', contextualized_text) || to_tsvector('english', contextualized_text),
          websearch_to_tsquery('spanish', :question) || websearch_to_tsquery('english', :question)) DESC, id
        LIMIT 30
    """),
            {"versions": versions, "question": question},
        )
        .scalars()
        .all()
    )
    rankings: list[list[uuid.UUID]] = [list(lexical)]
    semantic_used = False
    grouped: dict[uuid.UUID, list[tuple[Document, DocumentIndex]]] = defaultdict(list)
    for document in documents:
        index = (
            session.get(DocumentIndex, document.active_index_id)
            if document.active_index_id
            else None
        )
        if (
            index
            and index.status == "READY"
            and index.version_id == document.current_version_id
        ):
            grouped[index.profile_id].append((document, index))
    for profile_id, pairs in grouped.items():
        profile = session.get(EmbeddingProfile, profile_id)
        if not profile:
            continue
        try:
            require_consent(
                session, [doc.id for doc, _idx in pairs], profile.provider, "embeddings"
            )
            provider = get_provider(profile.provider)
            descriptor = next(
                (item for item in provider.discover() if item.id == profile.model), None
            )
            if not descriptor or descriptor.version != profile.model_version:
                continue  # A changed model requires a new profile, even at equal dimensions.
            query = provider.embed(
                profile.model, [question], profile.dimensions, query=True
            )[0]
            rows = session.exec(
                select(col(ChunkEmbedding.chunk_id))
                .where(
                    col(ChunkEmbedding.index_id).in_([idx.id for _doc, idx in pairs])
                )  # type: ignore[attr-defined]
                .order_by(
                    cast(Any, col(ChunkEmbedding.embedding)).cosine_distance(
                        Vector(query)
                    )
                )
                .limit(30)
            ).all()
            rankings.append(list(rows))
            semantic_used = True
        except ProviderError:
            # No data went to another provider. Lexical degradation is explicit in results.
            continue
    if selected_element_id:
        selected = session.exec(
            select(col(ChunkProvenance.chunk_id))
            .join(Chunk, col(Chunk.id) == col(ChunkProvenance.chunk_id))
            .where(
                col(ChunkProvenance.element_id) == selected_element_id,
                col(Chunk.version_id).in_(versions),
            )
        ).all()  # type: ignore[attr-defined]
        rankings.insert(0, list(selected))
    result = []
    for identifier, score in reciprocal_rank_fusion(rankings)[:top_k]:
        result.extend(evidence_for_chunk(session, identifier, len(result) + 1, score))
    return result, "hybrid" if semantic_used else "lexical"
