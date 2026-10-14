import uuid
from datetime import timedelta

import pymupdf
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.domain import (
    CloudConsent,
    Document,
    DocumentElement,
    DocumentPage,
    DocumentVersion,
    Job,
    now,
)
from app.schemas.research import (
    ConsentInput,
    ConsentPublic,
    DocumentPublic,
    ElementPublic,
    EnrichmentInput,
    EnrichmentPublic,
    IndexInput,
    JobPublic,
    RenameInput,
)
from app.services.documents.access import owned_document
from app.services.parsing.pdf import inspect_pdf
from app.services.storage.local import LocalStorage
from app.services.vision.regions import region_image
from app.workers.tasks import TERMINAL_STATES, enqueue

router = APIRouter(prefix="/documents", tags=["documents"])


def new_job(
    session: SessionDep, document: Document, kind: str, parameters: dict | None = None
) -> Job:
    # Serialize job creation across concurrent HTTP requests.
    session.exec(
        select(Document).where(col(Document.id) == document.id).with_for_update()
    ).one()
    existing = session.exec(
        select(Job).where(
            col(Job.document_id) == document.id,
            col(Job.state).notin_(list(TERMINAL_STATES)),
        )
    ).first()  # type: ignore[attr-defined]
    if existing:
        raise HTTPException(409, "El documento ya tiene un trabajo pendiente")
    job = Job(document_id=document.id, kind=kind, parameters=parameters or {})
    session.add(job)
    session.commit()
    session.refresh(job)
    enqueue(job)
    return job


@router.get("/", response_model=list[DocumentPublic])
def list_documents(session: SessionDep, current_user: CurrentUser, q: str = ""):
    statement = select(Document).where(col(Document.owner_id) == current_user.id)
    if q:
        statement = statement.where(col(Document.title).ilike(f"%{q[:200]}%"))  # type: ignore[attr-defined]
    return session.exec(statement.order_by(col(Document.created_at).desc())).all()


@router.post("/", response_model=DocumentPublic)
def upload_document(session: SessionDep, current_user: CurrentUser, file: UploadFile):
    storage = LocalStorage()
    identifier = uuid.uuid4()
    key = f"originals/{identifier}.pdf"
    try:
        size, sha256 = storage.write(
            file.file, key, settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
        )
        page_count = inspect_pdf(storage.path(key))
        duplicate = session.exec(
            select(Document).where(
                col(Document.owner_id) == current_user.id, Document.sha256 == sha256
            )
        ).first()
        if duplicate:
            storage.delete(key)
            return duplicate
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
        )
        session.add(document)
        job = Job(document_id=document.id)
        session.add(job)
        session.commit()
        session.refresh(document)
    except ValueError as error:
        storage.delete(key)
        raise HTTPException(422, str(error)) from None
    except IntegrityError:
        session.rollback()
        storage.delete(key)
        duplicate = session.exec(
            select(Document).where(
                col(Document.owner_id) == current_user.id, Document.sha256 == sha256
            )
        ).first()
        if duplicate:
            return duplicate
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
        media_type="application/pdf",
        filename=document.original_filename,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/{document_id}/thumbnail")
def thumbnail(document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    document = owned_document(session, current_user.id, document_id)
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
    from app.services.privacy.consent import require_consent

    require_consent(session, [document_id], body.provider, "embeddings")
    if body.modality == "multimodal":
        require_consent(session, [document_id], body.provider, "multimodal_embeddings")
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


@router.post("/{document_id}/jobs/{job_id}/cancel", response_model=JobPublic)
def cancel_job(
    document_id: uuid.UUID,
    job_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_document(session, current_user.id, document_id)
    job = session.get(Job, job_id)
    if not job or job.document_id != document_id:
        raise HTTPException(404, "Trabajo no encontrado")
    job.cancel_requested = True
    if job.state == "QUEUED":
        job.state = "CANCELLED"
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
    if job.kind == "index":
        from app.services.privacy.consent import require_consent

        require_consent(
            session, [document.id], job.parameters["provider"], "embeddings"
        )
    job.state, job.cancel_requested, job.error_code, job.error_message = (
        "QUEUED",
        False,
        None,
        None,
    )
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
