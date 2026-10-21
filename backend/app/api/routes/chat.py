import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.domain import ChatMessage, Conversation
from app.schemas.research import (
    ConversationInput,
    ConversationPublic,
    MessagePublic,
    ModelSelection,
    QuestionInput,
)
from app.services.documents.access import (
    owned_conversation,
    owned_workspace,
    workspace_documents,
)
from app.services.rag.chat import chat_events, message_sources

router = APIRouter(tags=["chat"])


@router.get(
    "/workspaces/{workspace_id}/conversations", response_model=list[ConversationPublic]
)
def conversations(
    workspace_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    owned_workspace(session, current_user.id, workspace_id)
    return session.exec(
        select(Conversation)
        .where(col(Conversation.workspace_id) == workspace_id)
        .order_by(col(Conversation.created_at).desc())
    ).all()


@router.post(
    "/workspaces/{workspace_id}/conversations", response_model=ConversationPublic
)
def create_conversation(
    workspace_id: uuid.UUID,
    body: ConversationInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_workspace(session, current_user.id, workspace_id)
    conversation = Conversation(workspace_id=workspace_id, **body.model_dump())
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


@router.patch(
    "/conversations/{conversation_id}/model", response_model=ConversationPublic
)
def select_conversation_model(
    conversation_id: uuid.UUID,
    body: ModelSelection,
    session: SessionDep,
    current_user: CurrentUser,
):
    conversation = owned_conversation(session, current_user.id, conversation_id)
    conversation.provider, conversation.model = body.provider, body.model
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


@router.get(
    "/conversations/{conversation_id}/messages", response_model=list[MessagePublic]
)
def messages(
    conversation_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    owned_conversation(session, current_user.id, conversation_id)
    result = []
    for row in session.exec(
        select(ChatMessage)
        .where(col(ChatMessage.conversation_id) == conversation_id)
        .order_by(col(ChatMessage.created_at))
    ).all():
        message = MessagePublic.model_validate(row)
        message.citations = message_sources(session, row.id)
        result.append(message)
    return result


@router.post("/conversations/{conversation_id}/messages")
def ask(
    conversation_id: uuid.UUID,
    body: QuestionInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    conversation = owned_conversation(session, current_user.id, conversation_id)
    allowed = [
        document.id
        for document in workspace_documents(session, conversation.workspace_id)
    ]
    if body.document_ids and not set(body.document_ids) <= set(allowed):
        raise HTTPException(403, "Hay documentos fuera del workspace")
    ids = body.document_ids or allowed
    return StreamingResponse(
        chat_events(conversation.id, current_user.id, body, ids),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/conversations/{conversation_id}/messages/{message_id}/cancel")
def cancel_generation(
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_conversation(session, current_user.id, conversation_id)
    message = session.get(ChatMessage, message_id)
    if not message or message.conversation_id != conversation_id:
        raise HTTPException(404, "Mensaje no encontrado")
    if message.state == "GENERATING":
        message.state = "CANCELLED"
        session.add(message)
        session.commit()
    return {"state": message.state}


@router.get("/conversations/{conversation_id}/export")
def export_conversation(
    conversation_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    format: str = "markdown",
):
    rows = messages(conversation_id, session, current_user)
    if format == "json":
        import json

        return Response(
            json.dumps(
                [row.model_dump(mode="json") for row in rows],
                ensure_ascii=False,
                indent=2,
            ),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="conversation.json"'},
        )
    if format != "markdown":
        raise HTTPException(422, "Formato no soportado")
    parts = ["# Investigación documental\n"]
    for row in rows:
        parts.append(f"## {row.role}\n\n{row.content}\n")
        for source in row.citations:
            location = (
                f"hoja {source.sheet_name}, celda {source.cell_range}"
                if source.sheet_name and source.cell_range
                else f"{source.start_seconds:.3f}–{source.end_seconds:.3f} segundos"
                if source.start_seconds is not None and source.end_seconds is not None
                else f"página {source.page_number}"
            )
            parts.append(
                f"- Fuente {source.label}: {source.document_title}, {location}, versión {source.version_id}, elemento {source.element_id}\n"
            )
    return Response(
        "\n".join(parts),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="conversation.md"'},
    )
