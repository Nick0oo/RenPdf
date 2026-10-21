"""Prepare real temporal references locally, without generative transcription."""

import hashlib
import math

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.config import settings
from app.domain import (
    Chunk,
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentPage,
    DocumentVersion,
    Job,
)
from app.services.models.contracts import ProviderError
from app.services.parsing.media import extract_segment, prepare_playback
from app.services.storage.local import LocalStorage


def prepare_native_media(session: Session, job: Job, document: Document) -> Job:
    from app.workers.tasks import check_cancel, update_job

    check_cancel(session, job)
    prepare_playback(document)
    version = session.get(DocumentVersion, job.version_id) if job.version_id else None
    seconds = settings.MEDIA_SEGMENT_SECONDS
    total = math.ceil((document.duration_seconds or 0) / seconds)
    if not total:
        raise ProviderError("INVALID_MEDIA", "La fuente no tiene duración válida.")
    if not version:
        number = (
            session.exec(
                select(func.max(col(DocumentVersion.version_number))).where(
                    col(DocumentVersion.document_id) == document.id
                )
            ).one()
            or 0
        )
        version = DocumentVersion(
            document_id=document.id,
            version_number=number + 1,
            parser_name="ffmpeg-native-references",
            parser_version="native-segments-v1",
            artifact_manifest={
                "analysis_mode": "native_embeddings",
                "source_type": document.source_type,
                "duration_seconds": document.duration_seconds,
                "temporal_precision": "segment_boundary",
                "segments_total": total,
                "segment_seconds": seconds,
                "segments_analyzed": 0,
                "original_sha256": document.sha256,
            },
        )
        session.add(version)
        session.flush()
        job.version_id = version.id
        session.add(job)
        session.commit()
    # Reuse already prepared clips, verified against this exact original file.
    previous = (
        session.exec(
            select(DocumentElement)
            .join(DocumentPage)
            .where(
                col(DocumentPage.version_id) == document.current_version_id,
                col(DocumentElement.start_seconds).is_not(None),
            )
        ).all()
        if document.current_version_id
        else []
    )
    reused = 0
    for ordinal in range(job.checkpoint + 1, total + 1):
        check_cancel(session, job)
        start, end = (
            (ordinal - 1) * seconds,
            min(ordinal * seconds, document.duration_seconds or 0),
        )
        existing = next(
            (
                item
                for item in previous
                if item.start_seconds == start
                and item.end_seconds == end
                and item.structured_content.get("original_sha256") == document.sha256
                and LocalStorage().path(item.structured_content["media_key"]).is_file()
            ),
            None,
        )
        if existing:
            key, mime, digest = (
                existing.structured_content["media_key"],
                existing.structured_content["mime_type"],
                existing.content_hash,
            )
            reused += 1
        else:
            key, media = extract_segment(document, version.id, ordinal, start, end)
            mime, digest = media.mime_type, hashlib.sha256(media.data).hexdigest()
        text = f"Segmento {start:.3f}–{end:.3f} s. Contenido nativo adjunto; sin transcripción."
        page = DocumentPage(
            version_id=version.id,
            page_number=ordinal,
            unit_kind="segment",
            width=1,
            height=1,
        )
        session.add(page)
        session.flush()
        element = DocumentElement(
            page_id=page.id,
            element_type=f"{document.source_type}_segment",
            text=text,
            start_seconds=start,
            end_seconds=end,
            content_hash=digest,
            extraction_method="native-segment-reference",
            coordinate_system="seconds_from_original_start",
            structured_content={
                "native_reference": True,
                "media_key": key,
                "mime_type": mime,
                "clip_sha256": digest,
                "original_sha256": document.sha256,
                "temporal_precision": "segment_boundary",
                "segment_seconds": seconds,
            },
        )
        session.add(element)
        session.flush()
        chunk = Chunk(
            version_id=version.id,
            text=text,
            contextualized_text=f"{document.title}\n{text}",
            content_hash=digest,
            chunking_profile="native-media-v1",
        )
        session.add(chunk)
        session.flush()
        session.add(
            ChunkProvenance(
                chunk_id=chunk.id, element_id=element.id, span_end=len(text)
            )
        )
        job.checkpoint = ordinal
        update_job(
            session, job, stage="native_segments", progress=int(ordinal / total * 95)
        )
    check_cancel(session, job)
    version.status = "EXTRACTED"
    version.artifact_manifest = {
        **version.artifact_manifest,
        "segments_prepared": total,
        "clips_reused": reused,
        "analysis_provider": job.parameters["provider"],
        "analysis_model": job.parameters["model"],
    }
    next_job = Job(
        document_id=document.id,
        version_id=version.id,
        kind="index",
        parameters={
            **job.parameters,
            "native_preparation": True,
            "previous_version_id": str(document.current_version_id)
            if document.current_version_id
            else None,
        },
    )
    if not document.active_index_id:
        document.status = "INDEXING"
    session.add_all([version, document, next_job])
    update_job(session, job, state="SUCCEEDED", stage="native_prepared", progress=100)
    return next_job
