"""Validate a complete immutable index before acknowledging a repeated request."""

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.domain import Chunk, ChunkEmbedding, Document, DocumentIndex, EmbeddingProfile
from app.schemas.research import IndexInput
from app.services.models.providers import get_provider


def reusable_index(
    session: Session, document: Document, body: IndexInput
) -> DocumentIndex | None:
    index = (
        session.get(DocumentIndex, document.active_index_id)
        if document.active_index_id
        else None
    )
    profile = session.get(EmbeddingProfile, index.profile_id) if index else None
    if (
        not index
        or not profile
        or index.status != "READY"
        or index.version_id != document.current_version_id
    ):
        return None
    if (profile.provider, profile.model, profile.dimensions, profile.modality) != (
        body.provider,
        body.model,
        body.dimensions,
        body.modality,
    ):
        return None
    try:
        descriptor = next(
            (
                item
                for item in get_provider(body.provider, timeout=10).discover()
                if item.id == body.model
            ),
            None,
        )
    except Exception:
        # This optional shortcut must not hide the durable worker's diagnostics.
        return None
    if (
        not descriptor
        or descriptor.version != profile.model_version
        or descriptor.capabilities.embeddings == "unsupported"
    ):
        return None
    chunks = session.exec(
        select(func.count())
        .select_from(Chunk)
        .where(col(Chunk.version_id) == index.version_id)
    ).one()
    vectors = session.exec(
        select(func.count())
        .select_from(ChunkEmbedding)
        .where(col(ChunkEmbedding.index_id) == index.id)
    ).one()
    return index if chunks > 0 and chunks == vectors else None
