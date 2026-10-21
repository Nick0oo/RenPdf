import uuid
from datetime import timedelta
from typing import Any

import pymupdf
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.domain import (
    Chunk,
    ChunkProvenance,
    CloudConsent,
    Document,
    DocumentElement,
    DocumentPage,
    DocumentVersion,
    Job,
    now,
)
from app.schemas.preparation import LocalIndexPreparationPublic
from app.schemas.research import (
    ConsentInput,
    ConsentPublic,
    DocumentPublic,
    ElementPublic,
    EnrichmentInput,
    EnrichmentPublic,
    IndexInput,
    JobPublic,
    ModelSelection,
    RenameInput,
)
from app.services.documents.access import owned_document
from app.services.documents.automatic_index import plan_local_index, restored_text_state
from app.services.models.contracts import ProviderError
from app.services.parsing.media import inspect_media, playback_key
from app.services.parsing.pdf import inspect_pdf
from app.services.parsing.spreadsheet import is_spreadsheet, read_spreadsheet
from app.services.storage.local import LocalStorage
from app.services.vision.regions import region_image
from app.workers.tasks import TERMINAL_STATES, enqueue

router = APIRouter(prefix="/documents", tags=["documents"])


def prepare_duplicate(session: SessionDep, document: Document) -> Document:
    preparation = plan_local_index(session, document)
    session.commit()
    if preparation.created and preparation.job:
        enqueue(preparation.job)
    session.refresh(document)
    return document


def new_job(
    session: SessionDep,
    document: Document,
    kind: str,
    parameters: dict | None = None,
    *,
    completed: bool = False,
) -> Job:
    # Serialize job creation across concurrent HTTP requests.
    session.exec(
        select(Document).where(col(Document.id) == document.id).with_for_update()
    ).one()
    session.refresh(document)
    if completed and (parameters or {}).get("index_id") != str(
        document.active_index_id
    ):
        raise HTTPException(409, "La versión o el índice cambió; vuelve a intentarlo")
    existing = session.exec(
        select(Job).where(
            col(Job.document_id) == document.id,
            col(Job.state).notin_(list(TERMINAL_STATES)),
        )
    ).first()  # type: ignore[attr-defined]
    if existing:
        raise HTTPException(409, "El documento ya tiene un trabajo pendiente")
    job = Job(document_id=document.id, kind=kind, parameters=parameters or {})
    if completed:
        job.state, job.stage, job.progress = "SUCCEEDED", "indexed", 100
    if kind == "media_analysis" and not document.current_version_id:
        document.status, document.warning = "ANALYSIS_QUEUED", None
        session.add(document)
    if kind == "native_prepare" and not document.active_index_id:
        document.status, document.warning = "NATIVE_QUEUED", None
        session.add(document)
    session.add(job)
    session.commit()
    session.refresh(job)
    if not completed:
        enqueue(job)
    return job


@router.get("/", response_model=list[DocumentPublic])
def list_documents(session: SessionDep, current_user: CurrentUser, q: str = ""):
    statement = select(Document).where(col(Document.owner_id) == current_user.id)
    if q:
        statement = statement.where(col(Document.title).ilike(f"%{q[:200]}%"))  # type: ignore[attr-defined]
    return session.exec(statement.order_by(col(Document.created_at).desc())).all()


@router.post("/", response_model=DocumentPublic)
def upload_document(
    session: SessionDep,
    current_user: CurrentUser,
    file: UploadFile,
    workspace_id: uuid.UUID | None = None,
):
    if workspace_id:
        from app.services.documents.access import owned_workspace

        owned_workspace(session, current_user.id, workspace_id)
    storage = LocalStorage()
    identifier = uuid.uuid4()
    key = f"originals/{identifier}.pdf"
    try:
        size, sha256 = storage.write(
            file.file, key, settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        )
        with storage.path(key).open("rb") as source:
            is_pdf = source.read(1024).lstrip().startswith(b"%PDF-")
        metadata: dict[str, Any]
        if not is_pdf and is_spreadsheet(storage.path(key), file.filename or ""):
            workbook = read_spreadsheet(storage.path(key), file.filename or "")
            metadata = {
                "source_type": "spreadsheet",
                "mime_type": workbook.mime_type,
                "duration_seconds": None,
                "sheet_count": len(workbook.sheets),
            }
        else:
            metadata = (
                {
                    "source_type": "pdf",
                    "mime_type": "application/pdf",
                    "duration_seconds": None,
                }
                if is_pdf
                else inspect_media(storage.path(key))
            )
        page_count = inspect_pdf(storage.path(key)) if is_pdf else 0
        duplicate = session.exec(
            select(Document).where(
                col(Document.owner_id) == current_user.id, Document.sha256 == sha256
            )
        ).first()
        if duplicate:
            storage.delete(key)
            return prepare_duplicate(session, duplicate)
        filename = (
            (file.filename or "document.pdf").replace("\\", "/").split("/")[-1][:255]
        )
        document = Document(
            id=identifier,
            owner_id=current_user.id,
            title=filename,
            original_filename=filename,
            storage_key=key,
            sha256=sha256,
            file_size=size,
            page_count=page_count,
            source_type=metadata["source_type"],
            mime_type=metadata["mime_type"],
            duration_seconds=metadata["duration_seconds"],
            sheet_count=metadata.get("sheet_count", 0),
        )
        session.add(document)
        job = Job(
            document_id=document.id,
            parameters={"workspace_id": str(workspace_id)} if workspace_id else {},
        )
        session.add(job)
        session.commit()
        session.refresh(document)
    except ProviderError as error:
        storage.delete(key)
        raise HTTPException(
            503 if error.code == "MEDIA_RUNTIME_MISSING" else 422, error.message
        ) from None
    except ValueError as error:
        storage.delete(key)
        code = str(error)
        detail = {
            "INVALID_SPREADSHEET": "No se pudo leer el libro. Comprueba que sea un Excel válido y sin contraseña.",
            "INVALID_CELL_REFERENCE": "El libro contiene una referencia de celda inválida.",
            "CSV_REQUIRES_UTF8": "Guarda el CSV o TSV con codificación UTF-8 antes de subirlo.",
        }.get(code, code)
        if code.startswith("SPREADSHEET_") and code.endswith("_LIMIT"):
            detail = "El libro supera los límites de hojas, celdas o tamaño configurados. Divide el archivo y vuelve a subirlo."
        raise HTTPException(422, detail) from None
    except IntegrityError:
        session.rollback()
        storage.delete(key)
        duplicate = session.exec(
            select(Document).where(
                col(Document.owner_id) == current_user.id, Document.sha256 == sha256
            )
        ).first()
        if duplicate:
            return prepare_duplicate(session, duplicate)
        raise HTTPException(409, "No se pudo persistir el documento") from None
    except Exception:
        session.rollback()
        storage.delete(key)
        raise HTTPException(503, "No se pudo guardar el documento") from None
    enqueue(job)
    return document


@router.get("/{document_id}", response_model=DocumentPublic)
def get_document(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    return owned_document(session, current_user.id, document_id)


@router.patch("/{document_id}", response_model=DocumentPublic)
def rename_document(
    document_id: uuid.UUID,
    body: RenameInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    document = owned_document(session, current_user.id, document_id)
    document.title = body.title
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


@router.delete("/{document_id}")
def delete_document(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    document = owned_document(session, current_user.id, document_id)
    active = session.exec(
        select(Job).where(
            col(Job.document_id) == document_id,
            col(Job.state).notin_(list(TERMINAL_STATES)),
        )
    ).first()  # type: ignore[attr-defined]
    if active:
        raise HTTPException(
            409, "Cancela o termina el trabajo antes de eliminar el documento"
        )
    key = document.storage_key
    session.delete(document)
    session.commit()
    LocalStorage().delete(key)
    if document.source_type != "pdf":
        import shutil

        media_root = LocalStorage().path(f"media/{document.id}")
        if (
            media_root.is_dir()
            and media_root.resolve().parent == LocalStorage().path("media").resolve()
        ):
            shutil.rmtree(media_root)
    return {"deleted": True}


@router.get("/{document_id}/file")
def document_file(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    document = owned_document(session, current_user.id, document_id)
    path = LocalStorage().path(document.storage_key)
    if not path.is_file():
        raise HTTPException(404, "Archivo original no disponible")
    return FileResponse(
        path,
        media_type=document.mime_type,
        filename=document.original_filename,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/{document_id}/coverage")
def coverage(document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    from app.services.documents.coverage import document_coverage

    return document_coverage(
        session, owned_document(session, current_user.id, document_id)
    )


@router.get("/{document_id}/playback")
def media_playback(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    document = owned_document(session, current_user.id, document_id)
    if document.source_type not in {"audio", "video"}:
        raise HTTPException(422, "La fuente no es audio ni video")
    target = LocalStorage().path(playback_key(document.id, document.source_type))
    if not target.is_file():
        raise HTTPException(409, "El archivo todavía está preparando su reproducción")
    return FileResponse(
        target,
        media_type="video/mp4" if document.source_type == "video" else "audio/mpeg",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/{document_id}/segments")
def media_segments(
    document_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = 30,
    offset: int = 0,
):
    from sqlalchemy import func

    document = owned_document(session, current_user.id, document_id)
    if not 1 <= limit <= 100 or not 0 <= offset <= 100000:
        raise HTTPException(422, "Paginación no válida")
    statement = (
        select(DocumentElement, Chunk)
        .select_from(DocumentElement)
        .join(DocumentPage)
        .join(
            ChunkProvenance, col(ChunkProvenance.element_id) == col(DocumentElement.id)
        )
        .join(Chunk, col(Chunk.id) == col(ChunkProvenance.chunk_id))
        .where(
            col(DocumentPage.version_id) == document.current_version_id,
            col(DocumentElement.start_seconds).is_not(None),
        )
    )
    total = session.exec(select(func.count()).select_from(statement.subquery())).one()
    rows = session.exec(
        statement.order_by(col(DocumentElement.start_seconds), col(DocumentElement.id))
        .offset(offset)
        .limit(limit)
    ).all()
    return {
        "data": [
            {
                "id": str(element.id),
                "chunk_id": str(chunk.id),
                "source_type": document.source_type,
                "start_seconds": element.start_seconds,
                "end_seconds": element.end_seconds,
                "text": element.text,
                "analysis": element.structured_content.get("analysis"),
                "temporal_precision": "segment_boundary",
            }
            for element, chunk in rows
        ],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.post("/{document_id}/prepare-native", response_model=JobPublic)
def request_native_index(
    document_id: uuid.UUID,
    body: IndexInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    from app.services.privacy.consent import require_consent

    document = owned_document(session, current_user.id, document_id)
    if document.source_type not in {"audio", "video"} or body.modality != "multimodal":
        raise HTTPException(422, "Selecciona audio/video e indexación multimodal")
    if not (
        (body.provider == "embeddinggemma" and body.model == "embeddinggemma-2-native")
        or (body.provider == "gemini" and "embedding-2" in body.model)
    ):
        raise HTTPException(
            422, "Selecciona EmbeddingGemma 2 nativo o Gemini Embedding 2"
        )
    if (
        body.dimensions not in {128, 256, 512, 768}
        and body.provider == "embeddinggemma"
    ):
        raise HTTPException(422, "Dimensiones locales admitidas: 128, 256, 512, 768")
    require_consent(session, [document.id], body.provider, "embeddings")
    require_consent(session, [document.id], body.provider, "multimodal_embeddings")
    version = (
        session.get(DocumentVersion, document.current_version_id)
        if document.current_version_id
        else None
    )
    if (
        version
        and version.artifact_manifest.get("analysis_mode") == "native_embeddings"
        and version.artifact_manifest.get("original_sha256") == document.sha256
        and version.artifact_manifest.get("segment_seconds")
        == settings.MEDIA_SEGMENT_SECONDS
    ):
        from app.services.documents.index_cache import reusable_index

        index = reusable_index(session, document, body)
        if index:
            return new_job(
                session,
                document,
                "index",
                {
                    **body.model_dump(),
                    "index_id": str(index.id),
                    "reused_existing_index": True,
                },
                completed=True,
            )
    return new_job(session, document, "native_prepare", body.model_dump())


@router.post("/{document_id}/analyze", response_model=JobPublic)
def request_media_analysis(
    document_id: uuid.UUID,
    body: ModelSelection,
    session: SessionDep,
    current_user: CurrentUser,
):
    from app.services.privacy.consent import require_consent

    document = owned_document(session, current_user.id, document_id)
    if document.source_type not in {"audio", "video"} or body.provider != "gemini":
        raise HTTPException(422, "El análisis de audio/video requiere Gemini")
    if (
        not LocalStorage()
        .path(playback_key(document.id, document.source_type))
        .is_file()
    ):
        raise HTTPException(409, "Espera a que termine la preparación de la fuente")
    require_consent(session, [document.id], body.provider, "media_analysis")
    from app.services.models.media_capabilities import validate_media_analysis_model

    validate_media_analysis_model(body.model)
    return new_job(
        session,
        document,
        "media_analysis",
        {**body.model_dump(), "segment_seconds": settings.MEDIA_SEGMENT_SECONDS},
    )


@router.get("/{document_id}/thumbnail")
def thumbnail(document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    document = owned_document(session, current_user.id, document_id)
    if document.source_type != "pdf":
        raise HTTPException(404, "Esta fuente no tiene miniatura PDF")
    storage = LocalStorage()
    path = storage.path(f"thumbnails/{document.id}.png")
    if not path.exists():
        with pymupdf.open(storage.path(document.storage_key)) as pdf:
            page = pdf[0]
            scale = 200 / max(page.rect.width, page.rect.height)
            image = page.get_pixmap(
                matrix=pymupdf.Matrix(scale, scale), alpha=False
            ).tobytes("png")
            import io

            storage.write(
                io.BytesIO(image), f"thumbnails/{document.id}.png", 2 * 1024 * 1024
            )
    return FileResponse(
        path, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"}
    )


def owned_page(
    document_id: uuid.UUID,
    page_number: int,
    version_id: uuid.UUID | None,
    session: SessionDep,
    current_user: CurrentUser,
) -> tuple[Document, DocumentPage]:
    document = owned_document(session, current_user.id, document_id)
    if document.source_type != "pdf":
        raise HTTPException(404, "Esta fuente usa segmentos temporales")
    version = (
        session.get(DocumentVersion, version_id or document.current_version_id)
        if version_id or document.current_version_id
        else None
    )
    if not version or version.document_id != document.id:
        raise HTTPException(404, "Versión no encontrada")
    page = session.exec(
        select(DocumentPage).where(
            col(DocumentPage.version_id) == version.id,
            col(DocumentPage.page_number) == page_number,
        )
    ).first()
    if not page:
        raise HTTPException(404, "Página todavía no extraída")
    return document, page


@router.get(
    "/{document_id}/pages/{page_number}/elements", response_model=list[ElementPublic]
)
def page_elements_api(
    document_id: uuid.UUID,
    page_number: int,
    session: SessionDep,
    current_user: CurrentUser,
    version_id: uuid.UUID | None = None,
):
    _document, page = owned_page(
        document_id, page_number, version_id, session, current_user
    )
    return session.exec(
        select(DocumentElement).where(col(DocumentElement.page_id) == page.id)
    ).all()


@router.get("/{document_id}/elements/{element_id}/image")
def element_image(
    document_id: uuid.UUID,
    element_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    document = owned_document(session, current_user.id, document_id)
    if document.source_type != "pdf":
        raise HTTPException(404, "Esta fuente usa segmentos temporales")
    element = session.get(DocumentElement, element_id)
    page = session.get(DocumentPage, element.page_id) if element else None
    version = session.get(DocumentVersion, page.version_id) if page else None
    if not element or not page or not version or version.document_id != document.id:
        raise HTTPException(404, "Región no encontrada")
    return Response(region_image(document, page, element), media_type="image/png")


@router.post("/{document_id}/process", response_model=JobPublic)
def reprocess(document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    return new_job(
        session, owned_document(session, current_user.id, document_id), "extract"
    )


@router.post("/{document_id}/index", response_model=JobPublic)
def reindex(
    document_id: uuid.UUID,
    body: IndexInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    document = owned_document(session, current_user.id, document_id)
    if not document.current_version_id:
        raise HTTPException(409, "Primero completa la extracción")
    version = session.get(DocumentVersion, document.current_version_id)
    if (
        version
        and version.artifact_manifest.get("analysis_mode") == "native_embeddings"
        and body.modality != "multimodal"
    ):
        raise HTTPException(
            422, "Las fuentes sin transcripción requieren embeddings multimodales"
        )
    if document.source_type == "spreadsheet" and body.modality != "text":
        raise HTTPException(
            422,
            "Excel utiliza un índice de texto de sus celdas. Selecciona modalidad Texto.",
        )
    from app.services.privacy.consent import require_consent

    require_consent(session, [document_id], body.provider, "embeddings")
    if body.modality == "multimodal":
        require_consent(session, [document_id], body.provider, "multimodal_embeddings")
    from app.services.documents.index_cache import reusable_index

    index = reusable_index(session, document, body)
    if index:
        return new_job(
            session,
            document,
            "index",
            {
                **body.model_dump(),
                "index_id": str(index.id),
                "reused_existing_index": True,
            },
            completed=True,
        )
    return new_job(session, document, "index", body.model_dump())


@router.get("/{document_id}/jobs", response_model=list[JobPublic])
def document_jobs(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    owned_document(session, current_user.id, document_id)
    return session.exec(
        select(Job)
        .where(col(Job.document_id) == document_id)
        .order_by(col(Job.created_at).desc())
    ).all()


@router.post("/{document_id}/index-local", response_model=LocalIndexPreparationPublic)
def prepare_local_index(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    document = owned_document(session, current_user.id, document_id)
    preparation = plan_local_index(session, document)
    session.commit()
    if preparation.job:
        session.refresh(preparation.job)
    if preparation.created and preparation.job:
        enqueue(preparation.job)
    return LocalIndexPreparationPublic(
        state=preparation.state,
        reason=preparation.reason,
        job=JobPublic.model_validate(preparation.job) if preparation.job else None,
    )


@router.post("/{document_id}/jobs/{job_id}/cancel", response_model=JobPublic)
def cancel_job(
    document_id: uuid.UUID,
    job_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    document = owned_document(session, current_user.id, document_id)
    job = session.get(Job, job_id)
    if not job or job.document_id != document_id:
        raise HTTPException(404, "Trabajo no encontrado")
    job.cancel_requested = True
    if job.state == "QUEUED":
        job.state = "CANCELLED"
        if (
            job.kind in {"media_analysis", "native_prepare"}
            and not document.current_version_id
        ):
            document.status = "MEDIA_READY"
            document.warning = (
                "Preparación cancelada. Puedes preparar la fuente de nuevo."
            )
            session.add(document)
        if job.parameters.get("auto_index_local") and not document.active_index_id:
            document.status = restored_text_state(session, document)
            session.add(document)
        if job.parameters.get("native_preparation") and not document.active_index_id:
            document.status = "MEDIA_READY"
            session.add(document)
    job.updated_at = now()
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


@router.post("/{document_id}/jobs/{job_id}/retry", response_model=JobPublic)
def retry_job(
    document_id: uuid.UUID,
    job_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    document = owned_document(session, current_user.id, document_id)
    job = session.get(Job, job_id)
    if (
        not job
        or job.document_id != document_id
        or job.state not in {"FAILED", "CANCELLED"}
    ):
        raise HTTPException(409, "Trabajo no reintentable")
    active = session.exec(
        select(Job).where(
            col(Job.document_id) == document_id,
            col(Job.state).notin_(list(TERMINAL_STATES)),
        )
    ).first()  # type: ignore[attr-defined]
    if active:
        raise HTTPException(409, "Ya existe un trabajo pendiente")
    if job.kind in {"index", "native_prepare"}:
        from app.services.privacy.consent import require_consent

        require_consent(
            session, [document.id], job.parameters["provider"], "embeddings"
        )
        if job.parameters.get("modality") == "multimodal":
            require_consent(
                session,
                [document.id],
                job.parameters["provider"],
                "multimodal_embeddings",
            )
    elif job.kind == "media_analysis":
        from app.services.privacy.consent import require_consent

        require_consent(
            session, [document.id], job.parameters["provider"], "media_analysis"
        )
        from app.services.models.media_capabilities import validate_media_analysis_model

        validate_media_analysis_model(job.parameters["model"])
        if not document.current_version_id:
            document.status, document.warning = "ANALYSIS_QUEUED", None
            session.add(document)
    job.state, job.cancel_requested, job.error_code, job.error_message = (
        "QUEUED",
        False,
        None,
        None,
    )
    if job.parameters.get("auto_index_local") and not document.active_index_id:
        document.status = "INDEXING"
        session.add(document)
    if job.parameters.get("native_preparation") and not document.active_index_id:
        document.status, document.warning = "INDEXING", None
        session.add(document)
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue(job)
    return job


@router.get("/{document_id}/consents", response_model=list[ConsentPublic])
def consents(document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    owned_document(session, current_user.id, document_id)
    return session.exec(
        select(CloudConsent).where(col(CloudConsent.document_id) == document_id)
    ).all()


@router.post("/{document_id}/consents", response_model=ConsentPublic)
def grant_consent(
    document_id: uuid.UUID,
    body: ConsentInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_document(session, current_user.id, document_id)
    consent = CloudConsent(
        document_id=document_id,
        owner_id=current_user.id,
        provider=body.provider,
        scope=body.scope,
        expires_at=now() + timedelta(days=body.expires_in_days),
    )
    session.add(consent)
    session.commit()
    session.refresh(consent)
    return consent


@router.delete("/{document_id}/consents/{consent_id}", response_model=ConsentPublic)
def revoke_consent(
    document_id: uuid.UUID,
    consent_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_document(session, current_user.id, document_id)
    consent = session.get(CloudConsent, consent_id)
    if not consent or consent.document_id != document_id:
        raise HTTPException(404, "Autorización no encontrada")
    consent.revoked_at = now()
    session.add(consent)
    session.commit()
    session.refresh(consent)
    return consent


@router.get("/{document_id}/enrichment", response_model=EnrichmentPublic)
def read_enrichment(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    document = owned_document(session, current_user.id, document_id)
    version = (
        session.get(DocumentVersion, document.current_version_id)
        if document.current_version_id
        else None
    )
    data = version.artifact_manifest if version else {}
    return EnrichmentPublic(
        questions=data.get("questions", []),
        summary=data.get("summary"),
        provider=data.get("enrichment_provider"),
        model=data.get("enrichment_model"),
    )


@router.post("/{document_id}/enrichment", response_model=JobPublic)
def generate_enrichment(
    document_id: uuid.UUID,
    body: EnrichmentInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    from app.services.models.routing import resolve_policy
    from app.services.privacy.consent import require_consent

    document = owned_document(session, current_user.id, document_id)
    if not document.current_version_id:
        raise HTTPException(409, "Primero completa la extracción")
    policy = resolve_policy(session, current_user.id, None, body.purpose)
    require_consent(session, [document_id], policy.provider, "chat")
    return new_job(session, document, body.purpose, policy.model_dump())
