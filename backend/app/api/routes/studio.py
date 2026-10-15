import uuid

import pymupdf
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.module_domain import StudioOperation
from app.schemas.modules import StudioInput, StudioOperationPublic, StudioResult
from app.schemas.research import DocumentPublic, JobPublic
from app.services.documents.access import owned_document
from app.services.documents.studio import create_derivative
from app.services.storage.local import LocalStorage
from app.workers.tasks import enqueue

router = APIRouter(prefix="/studio", tags=["studio"])


@router.get("/documents/{document_id}/pages/{page_number}/preview")
def preview_page(
    document_id: uuid.UUID,
    page_number: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    document = owned_document(session, current_user.id, document_id)
    if not 1 <= page_number <= document.page_count:
        raise HTTPException(404, "Página no encontrada")
    path = LocalStorage().path(document.storage_key)
    if not path.is_file():
        raise HTTPException(404, "Archivo no disponible")
    with pymupdf.open(path) as pdf:
        page = pdf[page_number - 1]
        scale = min(1, 600 / max(page.rect.width, page.rect.height))
        data = page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale), alpha=False
        ).tobytes("png")
    return Response(
        data, media_type="image/png", headers={"Cache-Control": "private, no-store"}
    )


@router.get("/operations", response_model=list[StudioOperationPublic])
def list_operations(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
):
    return session.exec(
        select(StudioOperation)
        .where(col(StudioOperation.owner_id) == current_user.id)
        .order_by(col(StudioOperation.created_at).desc())
        .offset(offset)
        .limit(limit)
    ).all()


@router.post("/operations", response_model=StudioResult)
def run_operation(body: StudioInput, session: SessionDep, current_user: CurrentUser):
    operation, document, job = create_derivative(session, current_user.id, body)
    enqueue(job)
    return StudioResult(
        operation=StudioOperationPublic.model_validate(operation),
        document=DocumentPublic.model_validate(document),
        job=JobPublic.model_validate(job),
    )
