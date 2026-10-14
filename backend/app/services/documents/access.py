import uuid

from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.domain import Conversation, Document, Workspace, WorkspaceDocument


def owned_document(
    session: Session, owner_id: uuid.UUID, identifier: uuid.UUID
) -> Document:
    document = session.get(Document, identifier)
    if not document or document.owner_id != owner_id:
        raise HTTPException(404, "Documento no encontrado")
    return document


def owned_workspace(
    session: Session, owner_id: uuid.UUID, identifier: uuid.UUID
) -> Workspace:
    workspace = session.get(Workspace, identifier)
    if not workspace or workspace.owner_id != owner_id:
        raise HTTPException(404, "Workspace no encontrado")
    return workspace


def owned_conversation(
    session: Session, owner_id: uuid.UUID, identifier: uuid.UUID
) -> Conversation:
    conversation = session.get(Conversation, identifier)
    if not conversation:
        raise HTTPException(404, "Conversación no encontrada")
    owned_workspace(session, owner_id, conversation.workspace_id)
    return conversation


def workspace_documents(session: Session, workspace_id: uuid.UUID) -> list[Document]:
    return list(
        session.exec(
            select(Document)
            .join(
                WorkspaceDocument,
                col(WorkspaceDocument.document_id) == col(Document.id),
            )
            .where(col(WorkspaceDocument.workspace_id) == workspace_id)
            .order_by(col(Document.created_at).desc())
        ).all()
    )
