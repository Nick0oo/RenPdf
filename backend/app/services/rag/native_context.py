"""Attach only retrieved native clips, with bounded payload and exact provenance."""

import hashlib
from collections import defaultdict

from sqlmodel import Session

from app.domain import DocumentElement
from app.schemas.research import EvidencePublic
from app.services.models.contracts import MediaInput, ProviderError
from app.services.storage.local import LocalStorage


def native_context(session: Session, evidence: list[EvidencePublic]):
    selected, media, metadata = [], [], []
    total_bytes, seconds = 0, 0.0
    omitted = 0
    # Retrieval restores document reading order. Interleave again before applying
    # the media budget so one source cannot consume every available clip.
    by_document = defaultdict(list)
    for item in evidence:
        by_document[item.document_id].append(item)
    balanced = [
        items[offset]
        for offset in range(
            max((len(items) for items in by_document.values()), default=0)
        )
        for items in by_document.values()
        if offset < len(items)
    ]
    for item in balanced:
        element = session.get(DocumentElement, item.element_id)
        if not element or not element.structured_content.get("native_reference"):
            item.label = len(selected) + 1
            selected.append(item)
            continue
        data = LocalStorage().path(element.structured_content["media_key"]).read_bytes()
        duration = (element.end_seconds or 0) - (element.start_seconds or 0)
        if (
            len(media) >= 6
            or total_bytes + len(data) > 18 * 1024 * 1024
            or seconds + duration > 60
        ):
            omitted += 1
            continue
        digest = hashlib.sha256(data).hexdigest()
        if digest != element.structured_content["clip_sha256"]:
            raise ProviderError(
                "MEDIA_INTEGRITY", "El clip cambió; prepara nuevamente su índice."
            )
        item.label = len(selected) + 1
        selected.append(item)
        media.append(
            MediaInput(data=data, mime_type=element.structured_content["mime_type"])
        )
        metadata.append(
            {
                "media": len(media),
                "source_id": item.label,
                "document_id": str(item.document_id),
                "version_id": str(item.version_id),
                "element_id": str(item.element_id),
                "start_seconds": element.start_seconds,
                "end_seconds": element.end_seconds,
                "clip_sha256": digest,
                "bytes": len(data),
                "mime_type": element.structured_content["mime_type"],
            }
        )
        total_bytes += len(data)
        seconds += duration
    return (
        selected,
        media,
        {
            "clips": metadata,
            "omitted": omitted,
            "bytes": total_bytes,
            "duration_seconds": seconds,
        },
    )
