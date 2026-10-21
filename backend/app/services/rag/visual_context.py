"""Bounded visual context from figures actually retrieved by a multimodal index."""

import hashlib
import io
import uuid
from dataclasses import dataclass
from typing import Any

from PIL import Image
from sqlmodel import Session

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
from app.services.vision.regions import region_image

MAX_AUTO_IMAGES = 2
MAX_IMAGE_BYTES = 4 * 1024 * 1024
MAX_IMAGE_SIDE = 1024


@dataclass(frozen=True)
class VisualContextRegion:
    source: EvidencePublic
    document: Document
    page: DocumentPage
    element: DocumentElement


def visual_context_candidates(
    session: Session,
    sources: list[EvidencePublic],
    document_ids: list[uuid.UUID],
    retrieval: dict[str, Any],
    *,
    owner_id: uuid.UUID,
    limit: int = MAX_AUTO_IMAGES,
    allow_text_regions: bool = False,
) -> list[VisualContextRegion]:
    """Never broaden a text search into unrelated page images or another owner."""
    allowed = set(document_ids)
    used_indexes: dict[str, set[str]] = {}
    for profile in retrieval.get("used_profiles", []):
        if isinstance(profile, dict) and profile.get("modality") == "multimodal":
            for index_id in profile.get("index_ids", []):
                used_indexes.setdefault(str(index_id), set()).add(
                    str(profile.get("profile_id"))
                )
    count = max(0, min(MAX_AUTO_IMAGES, limit))
    if (not used_indexes and not allow_text_regions) or not count:
        return []
    result: list[VisualContextRegion] = []
    seen: set[uuid.UUID] = set()
    source_groups: dict[uuid.UUID, list[EvidencePublic]] = {}
    for source in sources:
        element = session.get(DocumentElement, source.element_id)
        if element and element.element_type == "figure":
            source_groups.setdefault(source.document_id, []).append(source)
    ordered_sources = [
        group[position]
        for position in range(
            max((len(group) for group in source_groups.values()), default=0)
        )
        for group in source_groups.values()
        if position < len(group)
    ]
    for source in ordered_sources:
        if source.document_id not in allowed or source.element_id in seen:
            continue
        document = session.get(Document, source.document_id)
        element = session.get(DocumentElement, source.element_id)
        page = session.get(DocumentPage, element.page_id) if element else None
        index = (
            session.get(DocumentIndex, document.active_index_id)
            if document and document.active_index_id
            else None
        )
        profile = session.get(EmbeddingProfile, index.profile_id) if index else None
        chunk = session.get(Chunk, source.chunk_id)
        indexed_chunk = (
            session.get(ChunkEmbedding, (source.chunk_id, index.id)) if index else None
        )
        provenance = session.get(ChunkProvenance, (source.chunk_id, source.element_id))
        if (
            not document
            or document.owner_id != owner_id
            or not element
            or element.element_type != "figure"
            or not page
            or page.version_id != document.current_version_id
            or source.version_id != page.version_id
            or not chunk
            or chunk.version_id != page.version_id
            or not provenance
        ):
            continue
        if not allow_text_regions and (
            not index
            or index.status != "READY"
            or index.version_id != page.version_id
            or str(index.id) not in used_indexes
            or not profile
            or profile.modality != "multimodal"
            or str(profile.id) not in used_indexes[str(index.id)]
            or not indexed_chunk
        ):
            continue
        # The source already carries its real label and original chunk/provenance.
        result.append(VisualContextRegion(source, document, page, element))
        seen.add(element.id)
        if len(result) >= count:
            break
    return result


def render_visual_context(
    regions: list[VisualContextRegion],
) -> tuple[list[bytes], list[dict[str, Any]]]:
    """Call only after vision+chat consent and the chosen model's capability check.

    This function never discovers a provider, grants consent, invokes inference,
    creates chunks, or changes an active index.
    """
    images, metadata = [], []
    for region in regions[:MAX_AUTO_IMAGES]:
        original = region_image(region.document, region.page, region.element)
        try:
            with Image.open(io.BytesIO(original)) as source:
                source.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE))
                normalized = source.convert("RGB")
                output = io.BytesIO()
                normalized.save(output, format="PNG")
                image = output.getvalue()
                width, height = normalized.size
        except ValueError, OSError:
            raise ProviderError(
                "VISUAL_REGION_INVALID", "No se pudo preparar la figura recuperada."
            ) from None
        if len(image) > MAX_IMAGE_BYTES:
            raise ProviderError(
                "VISUAL_CONTEXT_TOO_LARGE",
                "La figura recuperada supera el límite de contexto visual.",
            )
        images.append(image)
        metadata.append(
            {
                "source_label": region.source.label,
                "element_id": str(region.element.id),
                "document_id": str(region.document.id),
                "version_id": str(region.page.version_id),
                "page_number": region.page.page_number,
                "width": width,
                "height": height,
                "bytes": len(image),
                "region_sha256": hashlib.sha256(image).hexdigest(),
            }
        )
    return images, metadata
