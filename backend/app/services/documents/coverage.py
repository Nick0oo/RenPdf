"""Report observed extraction/index coverage; never infer visual understanding."""

import math

from sqlmodel import Session, col, select

from app.domain import (
    ChunkEmbedding,
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentIndex,
    DocumentPage,
    DocumentVersion,
    EmbeddingProfile,
    Job,
)


def document_coverage(session: Session, document: Document) -> dict:
    pages = (
        session.exec(
            select(DocumentPage).where(
                col(DocumentPage.version_id) == document.current_version_id
            )
        ).all()
        if document.current_version_id
        else []
    )
    if document.source_type == "spreadsheet":
        from sqlalchemy import func

        version = (
            session.get(DocumentVersion, document.current_version_id)
            if document.current_version_id
            else None
        )
        manifest = version.artifact_manifest if version else {}
        index = (
            session.get(DocumentIndex, document.active_index_id)
            if document.active_index_id
            else None
        )
        profile = session.get(EmbeddingProfile, index.profile_id) if index else None
        cells_with_chunks = (
            session.exec(
                select(func.count(func.distinct(col(ChunkProvenance.element_id))))
                .select_from(ChunkProvenance)
                .join(DocumentElement)
                .join(DocumentPage)
                .where(col(DocumentPage.version_id) == document.current_version_id)
            ).one()
            if version
            else 0
        )
        indexed = (
            session.exec(
                select(func.count())
                .select_from(ChunkEmbedding)
                .where(col(ChunkEmbedding.index_id) == document.active_index_id)
            ).one()
            if index
            else 0
        )
        return {
            "document_id": str(document.id),
            "version_id": str(version.id) if version else None,
            "source_type": "spreadsheet",
            "sheets_total": document.sheet_count,
            "sheets_extracted": len(pages),
            "cells_total": manifest.get("cells_total", 0),
            "cells_with_chunks": cells_with_chunks,
            "formula_cells": manifest.get("formula_cells", 0),
            "missing_formula_values": manifest.get("missing_formula_values", 0),
            "warnings": manifest.get("warnings", []),
            "sheets": manifest.get("sheets", []),
            "indexed_chunks": indexed,
            "index_modality": profile.modality if profile else None,
            "pages_total": 0,
            "pages_extracted": 0,
            "ocr_pending_pages": [],
            "figures_total": 0,
            "figures_with_chunks": 0,
            "figures_multimodal_indexed": 0,
            "visual_status": "SPREADSHEET_CELLS",
        }
    if document.source_type != "pdf":
        analysis_job = session.exec(
            select(Job)
            .where(
                col(Job.document_id) == document.id, col(Job.kind) == "media_analysis"
            )
            .order_by(col(Job.created_at).desc())
        ).first()
        latest_job = session.exec(
            select(Job)
            .where(col(Job.document_id) == document.id)
            .order_by(col(Job.created_at).desc())
        ).first()
        version = (
            session.get(DocumentVersion, document.current_version_id)
            if document.current_version_id
            else None
        )
        manifest = version.artifact_manifest if version else {}
        # A checkpoint is observable progress, not a published/queryable version.
        native_job = bool(
            latest_job
            and (
                latest_job.kind == "native_prepare"
                or latest_job.parameters.get("native_preparation")
            )
        )
        pending_native = (
            session.get(DocumentVersion, latest_job.version_id)
            if native_job and latest_job and latest_job.version_id
            else None
        )
        native_manifest = (
            pending_native.artifact_manifest if pending_native else manifest
        )
        native_mode = (
            native_manifest.get("analysis_mode") == "native_embeddings" or native_job
        )
        prepared = (
            len(
                session.exec(
                    select(DocumentPage.id).where(
                        col(DocumentPage.version_id) == pending_native.id,
                        col(DocumentPage.unit_kind) == "segment",
                    )
                ).all()
            )
            if pending_native
            else len(pages)
        )
        analyzed = len(pages)
        if not version and analysis_job and analysis_job.version_id:
            analyzed = len(
                session.exec(
                    select(DocumentPage.id).where(
                        col(DocumentPage.version_id) == analysis_job.version_id,
                        col(DocumentPage.unit_kind) == "segment",
                    )
                ).all()
            )
        processing = (
            {
                "id": str(latest_job.id),
                "kind": latest_job.kind,
                "state": latest_job.state,
                "progress": latest_job.progress,
                "checkpoint": latest_job.checkpoint,
                "error_code": latest_job.error_code,
                "error_message": latest_job.error_message,
            }
            if latest_job and latest_job.state != "SUCCEEDED"
            else None
        )
        from sqlalchemy import func

        from app.core.config import settings

        count = (
            session.exec(
                select(func.count())
                .select_from(ChunkEmbedding)
                .where(
                    col(ChunkEmbedding.index_id) == document.active_index_id,
                )
            ).one()
            if document.active_index_id
            else 0
        )
        if native_job and (
            not pending_native or pending_native.id != document.current_version_id
        ):
            count = 0
        if (
            native_job
            and latest_job
            and latest_job.parameters.get("index_id")
            and latest_job.state != "SUCCEEDED"
        ):
            import uuid

            count = session.exec(
                select(func.count())
                .select_from(ChunkEmbedding)
                .where(
                    col(ChunkEmbedding.index_id)
                    == uuid.UUID(latest_job.parameters["index_id"])
                )
            ).one()
        seconds = (native_manifest if native_mode else manifest).get(
            "segment_seconds", settings.MEDIA_SEGMENT_SECONDS
        )
        if native_job and not pending_native:
            prepared, seconds = 0, settings.MEDIA_SEGMENT_SECONDS
        index = (
            session.get(DocumentIndex, document.active_index_id)
            if document.active_index_id
            else None
        )
        profile = session.get(EmbeddingProfile, index.profile_id) if index else None
        return {
            "document_id": str(document.id),
            "version_id": str(document.current_version_id) if version else None,
            "source_type": document.source_type,
            "duration_seconds": document.duration_seconds,
            "segments_total": math.ceil((document.duration_seconds or 0) / seconds),
            "segments_analyzed": 0 if native_mode else analyzed,
            "segments_prepared": prepared if native_mode else analyzed,
            "analysis_mode": "native_embeddings" if native_mode else "transcription",
            "segments_indexed": count,
            "analysis_status": "NATIVE_INDEXED"
            if native_mode
            and version
            and version.id == (pending_native.id if pending_native else version.id)
            and document.active_index_id
            else "NATIVE_PREPARING"
            if native_mode
            else "ANALYZED"
            if version
            else analysis_job.state
            if analysis_job
            else "NOT_ANALYZED",
            "analysis_complete": bool(version) and not native_mode,
            "active_index_ready": bool(document.active_index_id),
            "processing": processing,
            "analysis_provider": manifest.get("analysis_provider")
            or (analysis_job.parameters.get("provider") if analysis_job else None),
            "analysis_model": manifest.get("analysis_model")
            or (analysis_job.parameters.get("model") if analysis_job else None),
            "temporal_precision_seconds": seconds,
            "pages_total": 0,
            "pages_extracted": 0,
            "ocr_pending_pages": [],
            "figures_total": 0,
            "figures_with_chunks": 0,
            "figures_multimodal_indexed": 0,
            "visual_status": "MEDIA_SEGMENTS",
            "index_modality": profile.modality if profile else None,
        }
    figures = (
        session.exec(
            select(DocumentElement.id)
            .join(DocumentPage)
            .where(
                col(DocumentPage.version_id) == document.current_version_id,
                col(DocumentElement.element_type) == "figure",
            )
        ).all()
        if pages
        else []
    )
    queryable = (
        set(
            session.exec(
                select(ChunkProvenance.element_id).where(
                    col(ChunkProvenance.element_id).in_(figures)
                )
            ).all()
        )
        if figures
        else set()
    )
    index = (
        session.get(DocumentIndex, document.active_index_id)
        if document.active_index_id
        else None
    )
    profile = session.get(EmbeddingProfile, index.profile_id) if index else None
    visual_indexed = (
        set(
            session.exec(
                select(ChunkProvenance.element_id)
                .join(
                    ChunkEmbedding,
                    col(ChunkEmbedding.chunk_id) == col(ChunkProvenance.chunk_id),
                )
                .where(
                    col(ChunkProvenance.element_id).in_(figures),
                    col(ChunkEmbedding.index_id) == index.id,
                )
            ).all()
        )
        if figures
        and index
        and index.status == "READY"
        and index.version_id == document.current_version_id
        and profile
        and profile.modality == "multimodal"
        else set()
    )
    return {
        "source_type": "pdf",
        "document_id": str(document.id),
        "version_id": str(document.current_version_id)
        if document.current_version_id
        else None,
        "pages_total": document.page_count,
        "pages_extracted": len(pages),
        "ocr_pending_pages": [
            page.page_number
            for page in pages
            if page.extraction_status in {"OCR_REQUIRED", "OCR_UNAVAILABLE"}
        ],
        "figures_total": len(figures),
        "figures_with_chunks": len(queryable),
        "figures_multimodal_indexed": len(visual_indexed),
        "visual_status": "NOT_EXTRACTED"
        if not pages
        else "NO_FIGURES"
        if not figures
        else "MULTIMODAL_INDEXED"
        if len(visual_indexed) == len(figures)
        else "REGIONS_QUERYABLE"
        if len(queryable) == len(figures)
        else "REINDEX_REQUIRED",
        "index_modality": profile.modality if profile else None,
    }
