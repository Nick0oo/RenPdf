"""Owner-scoped evidence of persisted execution, without inferred historical events."""

import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import cast, func, or_
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.domain import (
    ChatMessage,
    Chunk,
    Citation,
    CloudConsent,
    Conversation,
    Document,
    DocumentElement,
    DocumentIndex,
    DocumentPage,
    DocumentVersion,
    EmbeddingProfile,
    Job,
    Workspace,
    WorkspaceDocument,
)
from app.module_domain import StudioOperation
from app.schemas.modules import StudioOperationPublic
from app.schemas.research import ConsentPublic, DocumentPublic, JobPublic, MessagePublic
from app.services.documents.access import (
    owned_conversation,
    owned_document,
    owned_workspace,
)
from app.services.rag.chat import message_sources

router = APIRouter(prefix="/trace", tags=["trace"])


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def safe_usage(usage: dict) -> dict:
    # Providers and future SDK fields must not introduce prompts or secrets here.
    allowed = {
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "input_tokens",
        "output_tokens",
        "tokens",
        "retrieval_notice",
        "error_code",
        "elapsed_seconds",
        "coverage",
        "covered_pages",
        "total_pages",
        "retrieval_mode",
        "context_tokens",
        "context_budget",
        "truncated",
        "trace",
        "status",
    }
    return {key: value for key, value in usage.items() if key in allowed}


@router.get("/overview")
def overview(session: SessionDep, current_user: CurrentUser):
    def count(statement) -> int:
        return int(session.exec(statement).one())

    owner = current_user.id
    return {
        "documents": count(
            select(func.count())
            .select_from(Document)
            .where(col(Document.owner_id) == owner)
        ),
        "workspaces": count(
            select(func.count())
            .select_from(Workspace)
            .where(col(Workspace.owner_id) == owner)
        ),
        "responses": count(
            select(func.count())
            .select_from(ChatMessage)
            .join(Conversation)
            .join(Workspace)
            .where(
                col(Workspace.owner_id) == owner, col(ChatMessage.role) == "assistant"
            )
        ),
        "jobs": count(
            select(func.count())
            .select_from(Job)
            .join(Document)
            .where(col(Document.owner_id) == owner)
        ),
        "studio_operations": count(
            select(func.count())
            .select_from(StudioOperation)
            .where(col(StudioOperation.owner_id) == owner)
        ),
        "active_consents": count(
            select(func.count())
            .select_from(CloudConsent)
            .where(
                col(CloudConsent.owner_id) == owner,
                col(CloudConsent.revoked_at).is_(None),
                col(CloudConsent.expires_at) > datetime.now(UTC),
            )
        ),
        "history_source": "persisted_records",
    }


@router.get("/activity")
def activity(
    session: SessionDep,
    current_user: CurrentUser,
    kind: Literal["all", "chat", "job", "studio"] = "all",
    workspace_id: uuid.UUID | None = None,
    state: str = Query(default="", max_length=40),
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1000),
):
    if workspace_id:
        owned_workspace(session, current_user.id, workspace_id)
    rows = []
    total = 0
    window = limit + offset
    if kind in {"all", "chat"}:
        statement = (
            select(ChatMessage, Conversation)
            .join(Conversation)
            .join(Workspace)
            .where(
                col(Workspace.owner_id) == current_user.id,
                col(ChatMessage.role) == "assistant",
            )
        )
        if workspace_id:
            statement = statement.where(col(Conversation.workspace_id) == workspace_id)
        if state:
            statement = statement.where(col(ChatMessage.state) == state)
        if q:
            statement = statement.where(
                col(Conversation.title).ilike(f"%{q}%")
                | col(ChatMessage.model).ilike(f"%{q}%")
            )
        total += int(
            session.exec(select(func.count()).select_from(statement.subquery())).one()
        )
        for message, conversation in session.exec(
            statement.order_by(col(ChatMessage.created_at).desc()).limit(window)
        ).all():
            citations = int(
                session.exec(
                    select(func.count())
                    .select_from(Citation)
                    .where(col(Citation.message_id) == message.id)
                ).one()
            )
            rows.append(
                {
                    "id": str(message.id),
                    "kind": "chat",
                    "title": conversation.title,
                    "workspace_id": str(conversation.workspace_id),
                    "conversation_id": str(conversation.id),
                    "state": message.state,
                    "provider": message.provider,
                    "model": message.model,
                    "mode": message.retrieval_mode,
                    "citations": citations,
                    "usage": safe_usage(message.usage),
                    "created_at": utc(message.created_at),
                }
            )
    if kind in {"all", "job"}:
        statement = (
            select(Job, Document)
            .join(Document)
            .where(col(Document.owner_id) == current_user.id)
        )
        if workspace_id:
            statement = statement.join(
                WorkspaceDocument,
                col(WorkspaceDocument.document_id) == col(Document.id),
            ).where(col(WorkspaceDocument.workspace_id) == workspace_id)
        if state:
            statement = statement.where(
                col(Job.state).in_(["COMPLETE", "SUCCEEDED"])
                if state == "COMPLETE"
                else col(Job.state) == state
            )
        if q:
            statement = statement.where(col(Document.title).ilike(f"%{q}%"))
        total += int(
            session.exec(select(func.count()).select_from(statement.subquery())).one()
        )
        for job, document in session.exec(
            statement.order_by(col(Job.created_at).desc()).limit(window)
        ).all():
            rows.append(
                {
                    "id": str(job.id),
                    "kind": "job",
                    "title": document.title,
                    "document_id": str(document.id),
                    "state": job.state,
                    "stage": job.stage,
                    "action": job.kind,
                    "progress": job.progress,
                    "error_code": job.error_code,
                    "provider": job.parameters.get("provider"),
                    "model": job.parameters.get("model"),
                    "created_at": utc(job.created_at),
                }
            )
    if kind in {"all", "studio"}:
        statement = select(StudioOperation).where(
            col(StudioOperation.owner_id) == current_user.id
        )
        if workspace_id:
            statement = statement.where(
                col(StudioOperation.workspace_id) == workspace_id
            )
        if state:
            statement = statement.where(col(StudioOperation.state) == state)
        if q:
            statement = statement.where(
                col(StudioOperation.output_name).ilike(f"%{q}%")
            )
        total += int(
            session.exec(select(func.count()).select_from(statement.subquery())).one()
        )
        for operation in session.exec(
            statement.order_by(col(StudioOperation.created_at).desc()).limit(window)
        ).all():
            rows.append(
                {
                    "id": str(operation.id),
                    "kind": "studio",
                    "title": operation.output_name,
                    "document_id": str(operation.output_document_id)
                    if operation.output_document_id
                    else None,
                    "workspace_id": str(operation.workspace_id)
                    if operation.workspace_id
                    else None,
                    "state": operation.state,
                    "action": operation.kind,
                    "page_count": operation.page_count,
                    "created_at": utc(operation.created_at),
                }
            )
    rows.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
    return {
        "data": rows[offset : offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


@router.get("/responses/{message_id}")
def response_detail(
    message_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    message = session.get(ChatMessage, message_id)
    if not message or message.role != "assistant":
        raise HTTPException(404, "Respuesta no encontrada")
    conversation = owned_conversation(session, current_user.id, message.conversation_id)
    dto = MessagePublic.model_validate(message)
    dto.usage = safe_usage(message.usage)
    dto.citations = message_sources(session, message.id)
    return {
        "conversation_id": conversation.id,
        "workspace_id": conversation.workspace_id,
        "message": dto,
    }


@router.get("/documents/{document_id}")
def document_detail(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    document = owned_document(session, current_user.id, document_id)
    versions = []
    for version in session.exec(
        select(DocumentVersion)
        .where(col(DocumentVersion.document_id) == document.id)
        .order_by(col(DocumentVersion.version_number).desc())
    ).all():
        chunks = int(
            session.exec(
                select(func.count())
                .select_from(Chunk)
                .where(col(Chunk.version_id) == version.id)
            ).one()
        )
        figures = int(
            session.exec(
                select(func.count())
                .select_from(DocumentElement)
                .join(DocumentPage)
                .where(
                    col(DocumentPage.version_id) == version.id,
                    col(DocumentElement.element_type) == "figure",
                )
            ).one()
        )
        indexes = []
        for index, profile in session.exec(
            select(DocumentIndex, EmbeddingProfile)
            .join(EmbeddingProfile)
            .where(col(DocumentIndex.version_id) == version.id)
        ).all():
            indexes.append(
                {
                    "id": index.id,
                    "state": index.status,
                    "active": index.id == document.active_index_id,
                    "profile": {
                        "id": profile.id,
                        "provider": profile.provider,
                        "model": profile.model,
                        "model_version": profile.model_version,
                        "dimensions": profile.dimensions,
                        "modality": profile.modality,
                        "metric": profile.metric,
                        "fingerprint": profile.fingerprint,
                    },
                }
            )
        versions.append(
            {
                "id": version.id,
                "number": version.version_number,
                "state": version.status,
                "parser": version.parser_name,
                "parser_version": version.parser_version,
                "current": version.id == document.current_version_id,
                "chunks": chunks,
                "figures": figures,
                "indexes": indexes,
                "created_at": utc(version.created_at),
            }
        )
    lineage_statement = select(StudioOperation).where(
        col(StudioOperation.owner_id) == current_user.id,
        or_(
            col(StudioOperation.output_document_id) == document.id,
            cast(col(StudioOperation.sources), JSONB).contains(
                [{"document_id": str(document.id)}]
            ),
        ),
    )
    lineage_total = int(
        session.exec(
            select(func.count()).select_from(lineage_statement.subquery())
        ).one()
    )
    lineage = [
        StudioOperationPublic.model_validate(operation)
        for operation in session.exec(
            lineage_statement.order_by(col(StudioOperation.created_at).desc()).limit(
                100
            )
        ).all()
    ]
    jobs = session.exec(
        select(Job)
        .where(col(Job.document_id) == document.id)
        .order_by(col(Job.created_at).desc())
        .limit(100)
    ).all()
    return {
        "document": DocumentPublic.model_validate(document),
        "sha256": document.sha256,
        "versions": versions,
        "jobs": [JobPublic.model_validate(job) for job in jobs],
        "lineage": lineage,
        "lineage_total": lineage_total,
    }


@router.get("/permissions")
def permissions(
    session: SessionDep,
    current_user: CurrentUser,
    document_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=10000),
):
    if document_id:
        owned_document(session, current_user.id, document_id)
    if workspace_id:
        owned_workspace(session, current_user.id, workspace_id)
    statement = (
        select(CloudConsent, Document)
        .join(Document)
        .where(
            col(CloudConsent.owner_id) == current_user.id,
            col(Document.owner_id) == current_user.id,
        )
    )
    if document_id:
        statement = statement.where(col(Document.id) == document_id)
    if workspace_id:
        statement = statement.join(
            WorkspaceDocument, col(WorkspaceDocument.document_id) == col(Document.id)
        ).where(col(WorkspaceDocument.workspace_id) == workspace_id)
    total = int(
        session.exec(select(func.count()).select_from(statement.subquery())).one()
    )
    records = []
    timestamp = datetime.now(UTC)
    for consent, document in session.exec(
        statement.order_by(col(CloudConsent.granted_at).desc())
        .offset(offset)
        .limit(limit)
    ).all():
        status = (
            "REVOKED"
            if consent.revoked_at
            else "EXPIRED"
            if utc(consent.expires_at) <= timestamp
            else "ACTIVE"
        )
        records.append(
            {
                "consent": ConsentPublic.model_validate(consent),
                "document_title": document.title,
                "state": status,
            }
        )
    return {"data": records, "total": total, "default_policy": "DENY"}
