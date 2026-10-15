import re
import unicodedata
import uuid
from collections import defaultdict
from collections.abc import Sequence
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

# These words describe the interaction rather than a document topic. Database
# stemming/stopwords still handle the remaining Spanish and English vocabulary.
QUESTION_WORDS = set(
    """puedes podrias podria quiero necesito dime decir explicame explica explicar
    cuentame muestra mostrar indicame indica responde responder pregunta favor
    favor de el la los las un una unos unas en del al para por sobre con sin es
    son hay tiene tienen tenemos tengo este esta estos estas ese esa eso esto
    documento documentos pdf archivo archivos texto pagina paginas informacion
    cual cuales que como cuando donde cuanto cuantos quien porque segun hacer
    haz hazme saber seria dame dar me mi puedes pdfs
    can could would please tell explain show give answer question according
    document documents file files pdf text page pages information what which
    how where when who why about from this that these those does do did is are
    was were has have the a an in on of to for and or i my me you your it
    """.split()
)

OVERVIEW_WORDS = set(
    """resume resumeme resumir resumen resumelo resumenes sintesis sintetiza
    sintetizar panorama principales principal puntos punto ideas idea general
    generales global todo todos toda todas completo completa principales temas
    tema trata tratan abordar aborda abordan abordados contenido contenidos
    esencial esenciales fuente fuentes citas cita citando referencias sus su se
    overview summarize summarise summary summaries main key points ideas topics
    topic takeaways overall entire whole contents sources citations references
    """.split()
)

# A lexical-only PDF is still usable when common field names differ from the
# question's language. These are search alternatives, never inferred answers or
# a translation of the document. Expand only after ordinary topic matches fail.
FIELD_TERMS = (
    frozenset(("factura", "facturas", "invoice", "invoices", "bill", "billing")),
    frozenset(("mes", "month", "fecha", "date", "periodo", "period")),
    frozenset(("fecha", "date", "emision", "expedicion", "issued", "issue")),
    frozenset(("vencimiento", "vence", "due")),
    frozenset(("numero", "number")),
    frozenset(("importe", "monto", "amount", "total")),
    frozenset(("impuesto", "impuestos", "iva", "tax", "taxes")),
    frozenset(("pago", "payment", "paid")),
    frozenset(("cliente", "customer", "client")),
)


def field_search_terms(terms: Sequence[str]) -> list[str]:
    expanded = []
    for term in terms:
        normalized = "".join(
            letter
            for letter in unicodedata.normalize("NFD", term)
            if unicodedata.category(letter) != "Mn"
        )
        for group in FIELD_TERMS:
            if normalized in group:
                expanded.extend(sorted(group - {normalized}))
    return list(dict.fromkeys(expanded))[:64]


def is_document_overview(question: str) -> bool:
    """Recognize an untargeted overview without treating factual questions as one."""
    normalized = "".join(
        letter
        for letter in unicodedata.normalize("NFD", question.lower())
        if unicodedata.category(letter) != "Mn"
    )
    words = set(re.findall(r"[^\W_]+", normalized))
    intent = bool(
        words
        & {
            "resume",
            "resumeme",
            "resumen",
            "resumir",
            "resumelo",
            "sintesis",
            "sintetiza",
            "overview",
            "summarize",
            "summarise",
            "summary",
            "takeaways",
        }
        or re.search(r"de que trata(?:n)?\b", normalized)
        or words & {"principales", "main", "key"}
        and words & {"puntos", "ideas", "points", "topics"}
    )
    return intent and not (words - QUESTION_WORDS - OVERVIEW_WORDS)


def overview_evidence(
    session: Session, documents: Sequence[Document], top_k: int = 8
) -> list[EvidencePublic]:
    """Sample real, text-bearing chunks across pages with bounded document balance.

    Sample a six-chunk reading window, not a single disconnected line. Source
    spans and coordinates remain unchanged; each source retains its own label.
    This is a partial overview, not a claim that every page was read by a model.
    """
    candidates: dict[uuid.UUID, list[list[uuid.UUID]]] = {}
    for document in documents:
        if not document.current_version_id:
            continue
        rows = (
            session.connection()
            .execute(
                text("""
                SELECT p.page_number, c.id, length(c.text) AS characters,
                  min(coalesce((e.bbox->>'y')::double precision, 1)) AS y,
                  min(coalesce((e.bbox->>'x')::double precision, 0)) AS x
                FROM chunk c JOIN chunkprovenance cp ON cp.chunk_id = c.id
                JOIN documentelement e ON e.id = cp.element_id
                JOIN documentpage p ON p.id = e.page_id
                WHERE c.version_id = :version AND length(trim(e.text)) > 0
                GROUP BY p.page_number, c.id, c.text
                ORDER BY p.page_number, y, x, c.id
            """),
                {"version": document.current_version_id},
            )
            .all()
        )
        if rows:
            pages: dict[int, list[Any]] = defaultdict(list)
            for row in rows:
                pages[row.page_number].append(row)
            ordered_pages = list(pages.values())
            # Request a fair share from each document, distributed from start to end.
            quota = max(1, top_k // max(1, len(documents)))
            count = min(quota, len(ordered_pages))
            positions = [
                round(index * (len(ordered_pages) - 1) / (count - 1))
                if count > 1
                else 0
                for index in range(count)
            ]
            windows = []
            for position in positions:
                page_chunks = ordered_pages[position]
                body = [index for index, row in enumerate(page_chunks) if row.y < 0.85]
                anchor = max(
                    body or range(len(page_chunks)),
                    key=lambda index: page_chunks[index].characters,
                )
                start = max(0, min(anchor - 2, len(page_chunks) - 6))
                windows.append([row.id for row in page_chunks[start : start + 6]])
            candidates[document.id] = windows
    selected: list[list[uuid.UUID]] = []
    for round_number in range(top_k):
        for document in documents:
            choices = candidates.get(document.id, [])
            if round_number < len(choices):
                selected.append(choices[round_number])
            if len(selected) >= top_k:
                break
        if len(selected) >= top_k:
            break
    # Round-robin keeps page coverage under the global bound, then restore reading
    # order so adjoining lines arrive together. Never concatenate unrelated quotes.
    result: list[EvidencePublic] = []
    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    characters = 0
    for offset in range(6):
        for window in selected:
            if offset >= len(window):
                continue
            for item in evidence_for_chunk(session, window[offset]):
                identity = (item.chunk_id, item.element_id)
                origin = session.get(DocumentElement, item.element_id)
                if (
                    identity in seen
                    or not origin
                    or not origin.text.strip()
                    or not item.text.strip()
                    or len(result) >= 48
                    or characters + len(item.text) > 6000
                ):
                    continue
                seen.add(identity)
                result.append(item)
                characters += len(item.text)
    document_order = {document.id: index for index, document in enumerate(documents)}
    result.sort(
        key=lambda item: (
            document_order[item.document_id],
            item.page_number,
            item.bbox.y if item.bbox else 1,
            item.bbox.x if item.bbox else 0,
            str(item.chunk_id),
        )
    )
    for label, item in enumerate(result, 1):
        item.label = label
    return result


def lexical_keywords(question: str) -> list[str]:
    """Keep bounded topic terms; never require every conversational query word."""
    result = []
    for word in re.findall(r"[^\W_]+", question.lower(), flags=re.UNICODE):
        normalized = "".join(
            letter
            for letter in unicodedata.normalize("NFD", word)
            if unicodedata.category(letter) != "Mn"
        )
        if len(word) > 1 and normalized not in QUESTION_WORDS and word not in result:
            result.append(word)
        if len(result) == 64:
            break
    return result


def lexical_candidates(
    session: Session, versions: list[uuid.UUID], question: str
) -> tuple[list[uuid.UUID], str]:
    """Prefer the exact query and backfill with ranked, disjunctive topic matches.

    A natural-language question often contains a verb absent from the PDF. The
    original AND-only query returned no evidence even when its topic occurred
    throughout the extracted document. OR candidates stay inside selected
    versions and are evidence for the model to assess, never an asserted answer.
    """
    statement = text("""
        SELECT id FROM chunk
        WHERE version_id = ANY(:versions)
        AND (to_tsvector('spanish', contextualized_text) || to_tsvector('english', contextualized_text))
          @@ (websearch_to_tsquery('spanish', :question) || websearch_to_tsquery('english', :question))
        ORDER BY ts_rank_cd(to_tsvector('spanish', contextualized_text) || to_tsvector('english', contextualized_text),
          websearch_to_tsquery('spanish', :question) || websearch_to_tsquery('english', :question)) DESC, id
        LIMIT 30
    """)
    strict = list(
        session.connection()
        .execute(statement, {"versions": versions, "question": question})
        .scalars()
        .all()
    )
    terms = lexical_keywords(question)
    if len(strict) >= 30 or not terms:
        return strict, "lexical"
    relaxed = list(
        session.connection()
        .execute(
            statement,
            {"versions": versions, "question": " OR ".join(terms)},
        )
        .scalars()
        .all()
    )
    if strict or relaxed:
        return list(dict.fromkeys(strict + relaxed)), (
            "lexical_relaxed" if relaxed and not strict else "lexical"
        )
    alternatives = field_search_terms(terms)
    if not alternatives:
        return [], "lexical"
    expanded = list(
        session.connection()
        .execute(
            statement,
            {"versions": versions, "question": " OR ".join(alternatives)},
        )
        .scalars()
        .all()
    )
    return expanded, "lexical_expanded" if expanded else "lexical"


def adjacent_field_evidence(
    session: Session,
    documents: Sequence[Document],
    ranked: list[tuple[uuid.UUID, float]],
) -> list[EvidencePublic]:
    """Keep a field's short neighboring values, each with its exact provenance.

    Native PDFs can store a date label and its value as separate text elements.
    Only expand real matching chunks on their own pages, by two reading-order
    neighbors. An unrelated query never receives a generic page sample.
    """
    if not ranked:
        return []
    neighbors = (
        session.connection()
        .execute(
            text("""
          WITH positions AS (
            SELECT c.id, p.id AS page_id,
              row_number() OVER (PARTITION BY p.id ORDER BY
                min(coalesce((e.bbox->>'y')::double precision, 1)),
                min(coalesce((e.bbox->>'x')::double precision, 0)), c.id) AS position
            FROM chunk c JOIN chunkprovenance cp ON cp.chunk_id=c.id
            JOIN documentelement e ON e.id=cp.element_id
            JOIN documentpage p ON p.id=e.page_id
            WHERE c.version_id=ANY(:versions) AND length(trim(e.text))>0
            GROUP BY c.id,p.id
          )
          SELECT DISTINCT neighbor.id FROM positions seed JOIN positions neighbor
            ON neighbor.page_id=seed.page_id
            AND neighbor.position BETWEEN seed.position-2 AND seed.position+2
          WHERE seed.id=ANY(:seeds)
          ORDER BY neighbor.id
        """),
            {
                "versions": [doc.current_version_id for doc in documents],
                "seeds": [identifier for identifier, _score in ranked],
            },
        )
        .scalars()
    )
    candidates = ranked + [(identifier, 0.0) for identifier in neighbors]
    result: list[EvidencePublic] = []
    seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
    characters = 0
    for identifier, score in candidates:
        for item in evidence_for_chunk(session, identifier, score=score):
            identity = (item.chunk_id, item.element_id)
            if (
                identity in seen
                or not item.text.strip()
                or len(result) >= 48
                or characters + len(item.text) > 6000
            ):
                continue
            seen.add(identity)
            result.append(item)
            characters += len(item.text)
    document_order = {doc.id: index for index, doc in enumerate(documents)}
    result.sort(
        key=lambda item: (
            document_order[item.document_id],
            item.page_number,
            item.bbox.y if item.bbox else 1,
            item.bbox.x if item.bbox else 0,
            str(item.chunk_id),
        )
    )
    for label, item in enumerate(result, 1):
        item.label = label
    return result


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
    diagnostics: dict[str, Any] | None = None,
) -> tuple[list[EvidencePublic], str]:
    if diagnostics is not None:
        diagnostics.update(used_profiles=[], semantic_failures=[])
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
    if selected_element_id is None and is_document_overview(question):
        return overview_evidence(session, documents, top_k), "document_overview"
    lexical, lexical_mode = lexical_candidates(session, versions, question)
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
                session,
                [doc.id for doc, _idx in pairs],
                profile.provider,
                "multimodal_embeddings"
                if profile.modality == "multimodal"
                else "embeddings",
            )
            provider = get_provider(profile.provider)
            descriptor = next(
                (item for item in provider.discover() if item.id == profile.model), None
            )
            if not descriptor or descriptor.version != profile.model_version:
                if diagnostics is not None:
                    diagnostics["semantic_failures"].append(
                        {
                            "profile_id": str(profile.id),
                            "error_code": "MODEL_PROFILE_MISMATCH",
                        }
                    )
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
            if diagnostics is not None:
                diagnostics["used_profiles"].append(
                    {
                        "profile_id": str(profile.id),
                        "provider": profile.provider,
                        "model": profile.model,
                        "model_version": profile.model_version,
                        "dimensions": profile.dimensions,
                        "modality": profile.modality,
                        "index_ids": [str(idx.id) for _doc, idx in pairs],
                    }
                )
        except ProviderError as error:
            if diagnostics is not None:
                diagnostics["semantic_failures"].append(
                    {"profile_id": str(profile.id), "error_code": error.code}
                )
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
    ranked = reciprocal_rank_fusion(rankings)[:top_k]
    if (
        lexical_mode == "lexical_expanded" or semantic_used
    ) and not selected_element_id:
        return adjacent_field_evidence(session, documents, ranked), (
            "hybrid" if semantic_used else lexical_mode
        )
    result = []
    for identifier, score in ranked:
        for item in evidence_for_chunk(session, identifier, score=score):
            item.label = len(result) + 1
            result.append(item)
    return result, "hybrid" if semantic_used else lexical_mode
