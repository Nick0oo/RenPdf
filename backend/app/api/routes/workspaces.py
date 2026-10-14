import uuid

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.domain import Annotation, Workspace, WorkspaceDocument
from app.schemas.research import (
    AnnotationInput,
    AnnotationPublic,
    DocumentPublic,
    EvidencePublic,
    QuestionInput,
    WorkspaceInput,
    WorkspacePublic,
)
from app.services.documents.access import (
    owned_document,
    owned_workspace,
    workspace_documents,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("/", response_model=list[WorkspacePublic])
def list_workspaces(session: SessionDep, current_user: CurrentUser):
    return session.exec(
        select(Workspace)
        .where(col(Workspace.owner_id) == current_user.id)
        .order_by(col(Workspace.created_at).desc())
    ).all()


@router.post("/", response_model=WorkspacePublic)
def create_workspace(
    body: WorkspaceInput, session: SessionDep, current_user: CurrentUser
):
    workspace = Workspace(owner_id=current_user.id, **body.model_dump())
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    return workspace


@router.patch("/{workspace_id}", response_model=WorkspacePublic)
def update_workspace(
    workspace_id: uuid.UUID,
    body: WorkspaceInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    workspace = owned_workspace(session, current_user.id, workspace_id)
    workspace.sqlmodel_update(body.model_dump())
    session.add(workspace)
    session.commit()
    session.refresh(workspace)
    return workspace


@router.delete("/{workspace_id}")
def delete_workspace(
    workspace_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    session.delete(owned_workspace(session, current_user.id, workspace_id))
    session.commit()
    return {"deleted": True}


@router.get("/{workspace_id}/documents", response_model=list[DocumentPublic])
def list_workspace_documents(
    workspace_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    owned_workspace(session, current_user.id, workspace_id)
    return workspace_documents(session, workspace_id)


@router.put("/{workspace_id}/documents/{document_id}")
def attach_document(
    workspace_id: uuid.UUID,
    document_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_workspace(session, current_user.id, workspace_id)
    owned_document(session, current_user.id, document_id)
    if not session.get(WorkspaceDocument, (workspace_id, document_id)):
        session.add(
            WorkspaceDocument(workspace_id=workspace_id, document_id=document_id)
        )
        session.commit()
    return {"attached": True}


@router.delete("/{workspace_id}/documents/{document_id}")
def detach_document(
    workspace_id: uuid.UUID,
    document_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_workspace(session, current_user.id, workspace_id)
    link = session.get(WorkspaceDocument, (workspace_id, document_id))
    if link:
        session.delete(link)
        session.commit()
    return {"detached": True}


@router.get("/{workspace_id}/annotations", response_model=list[AnnotationPublic])
def list_annotations(
    workspace_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    owned_workspace(session, current_user.id, workspace_id)
    return session.exec(
        select(Annotation)
        .where(col(Annotation.workspace_id) == workspace_id)
        .order_by(col(Annotation.created_at).desc())
    ).all()


@router.post("/{workspace_id}/annotations", response_model=AnnotationPublic)
def create_annotation(
    workspace_id: uuid.UUID,
    body: AnnotationInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_workspace(session, current_user.id, workspace_id)
    document = owned_document(session, current_user.id, body.document_id)
    if (
        not session.get(WorkspaceDocument, (workspace_id, document.id))
        or not document.current_version_id
    ):
        raise HTTPException(409, "Documento no disponible en este workspace")
    if body.page_number > document.page_count:
        raise HTTPException(422, "Página fuera del documento")
    annotation = Annotation(
        owner_id=current_user.id,
        workspace_id=workspace_id,
        version_id=document.current_version_id,
        **body.model_dump(),
    )
    session.add(annotation)
    session.commit()
    session.refresh(annotation)
    return annotation


@router.delete("/{workspace_id}/annotations/{annotation_id}")
def delete_annotation(
    workspace_id: uuid.UUID,
    annotation_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_workspace(session, current_user.id, workspace_id)
    annotation = session.get(Annotation, annotation_id)
    if not annotation or annotation.workspace_id != workspace_id:
        raise HTTPException(404, "Anotación no encontrada")
    session.delete(annotation)
    session.commit()
    return {"deleted": True}


@router.post("/{workspace_id}/search", response_model=list[EvidencePublic])
def search_workspace(
    workspace_id: uuid.UUID,
    body: QuestionInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    from app.services.rag.retrieval import retrieve

    owned_workspace(session, current_user.id, workspace_id)
    allowed = [document.id for document in workspace_documents(session, workspace_id)]
    if not set(body.document_ids) <= set(allowed):
        raise HTTPException(403, "Documentos fuera del workspace")
    evidence, _mode = retrieve(session, body.document_ids or allowed, body.question)
    return evidence
