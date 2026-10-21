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
    ChunkProvenance,
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


@router.get("/rag/sources")
def rag_sources(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
    source_type: Literal["all", "pdf", "audio", "video", "spreadsheet"] = "all",
    q: str = Query(default="", max_length=200),
    offset: int = Query(default=0, ge=0, le=100000),
    limit: int = Query(default=30, ge=1, le=100),
):
    from app.services.documents.coverage import document_coverage

    statement = select(Document).where(col(Document.owner_id) == current_user.id)
    if workspace_id:
        owned_workspace(session, current_user.id, workspace_id)
        statement = statement.join(WorkspaceDocument).where(
            col(WorkspaceDocument.workspace_id) == workspace_id
        )
    if source_type != "all":
        statement = statement.where(col(Document.source_type) == source_type)
    if q:
        statement = statement.where(col(Document.title).ilike(f"%{q}%"))
    total = session.exec(select(func.count()).select_from(statement.subquery())).one()
    data = []
    for document in session.exec(
        statement.order_by(col(Document.created_at).desc()).offset(offset).limit(limit)
    ).all():
        chunks = (
            session.exec(
                select(func.count())
                .select_from(Chunk)
                .where(col(Chunk.version_id) == document.current_version_id)
            ).one()
            if document.current_version_id
            else 0
        )
        workspace_ids = session.exec(
            select(WorkspaceDocument.workspace_id)
            .join(Workspace)
            .where(
                col(WorkspaceDocument.document_id) == document.id,
                col(Workspace.owner_id) == current_user.id,
            )
        ).all()
        data.append(
            {
                "document": DocumentPublic.model_validate(document),
                "coverage": document_coverage(session, document),
                "chunks": chunks,
                "workspace_ids": workspace_ids,
            }
        )
    return {"data": data, "total": total, "offset": offset, "limit": limit}


@router.get("/rag/queries")
def rag_queries(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
    q: str = Query(default="", max_length=200),
    offset: int = Query(default=0, ge=0, le=100000),
    limit: int = Query(default=30, ge=1, le=100),
):
    from sqlalchemy import text

    if workspace_id:
        owned_workspace(session, current_user.id, workspace_id)
    conditions = "w.owner_id=:owner AND m.role='assistant'"
    parameters = {
        "owner": current_user.id,
        "workspace": workspace_id,
        "q": f"%{q}%",
        "offset": offset,
        "limit": limit,
    }
    if workspace_id:
        conditions += " AND w.id=:workspace"
    if q:
        conditions += " AND (u.content ILIKE :q OR c.title ILIKE :q)"
    # The only interpolated SQL fragments are fixed server-owned clauses above.
    relation = f"""FROM chatmessage m JOIN conversation c ON c.id=m.conversation_id
        JOIN workspace w ON w.id=c.workspace_id
        LEFT JOIN chatmessage u ON u.id::text=(m.usage::jsonb->'trace'->>'query_message_id')
          AND u.conversation_id=c.id AND u.role='user'
        WHERE {conditions}"""
    total = (
        session.connection()
        .execute(text("SELECT count(*) " + relation), parameters)
        .scalar_one()
    )
    rows = (
        session.connection()
        .execute(
            text(
                "SELECT m.id,c.title,c.workspace_id,c.id AS conversation_id,m.state,m.provider,m.model,m.retrieval_mode,m.usage,m.created_at,u.content AS query "
                + relation
                + " ORDER BY m.created_at DESC,m.id LIMIT :limit OFFSET :offset"
            ),
            parameters,
        )
        .mappings()
        .all()
    )
    return {
        "data": [{**dict(row), "usage": safe_usage(row["usage"])} for row in rows],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


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


@router.get("/responses/{message_id}/context")
def response_context(
    message_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    message = session.get(ChatMessage, message_id)
    if not message or message.role != "assistant":
        raise HTTPException(404, "Respuesta no encontrada")
    owned_conversation(session, current_user.id, message.conversation_id)
    trace = message.usage.get("trace", {})
    query = None
    try:
        question = session.get(
            ChatMessage, uuid.UUID(trace.get("query_message_id", ""))
        )
        if (
            question
            and question.conversation_id == message.conversation_id
            and question.role == "user"
        ):
            query = question.content
    except ValueError:
        pass
    sources = []
    for reference in trace.get("sources", [])[:96]:
        try:
            chunk_id, element_id = (
                uuid.UUID(reference["chunk_id"]),
                uuid.UUID(reference["element_id"]),
            )
        except ValueError, KeyError, TypeError:
            continue
        row = session.exec(
            select(
                ChunkProvenance,
                Chunk,
                DocumentElement,
                DocumentPage,
            )
            .select_from(ChunkProvenance)
            .join(Chunk, col(Chunk.id) == col(ChunkProvenance.chunk_id))
            .join(
                DocumentElement,
                col(DocumentElement.id) == col(ChunkProvenance.element_id),
            )
            .join(DocumentPage, col(DocumentPage.id) == col(DocumentElement.page_id))
            .join(
                DocumentVersion, col(DocumentVersion.id) == col(DocumentPage.version_id)
            )
            .join(Document, col(Document.id) == col(DocumentVersion.document_id))
            .where(
                col(ChunkProvenance.chunk_id) == chunk_id,
                col(ChunkProvenance.element_id) == element_id,
                col(Document.owner_id) == current_user.id,
            )
        ).first()
        if not row:
            continue
        provenance, chunk, element, page = row
        version = session.get(DocumentVersion, page.version_id)
        document = session.get(Document, version.document_id) if version else None
        if not document or chunk.version_id != page.version_id:
            continue
        content = (
            element.text[provenance.span_start : provenance.span_end] or chunk.text
        )[: reference.get("chars", 6000)]
        sources.append(
            {
                **reference,
                "text": content,
                "kind": element.element_type,
                "document_title": document.title,
                "page_number": page.page_number
                if document.source_type == "pdf"
                else None,
                "source_type": document.source_type,
                "start_seconds": element.start_seconds,
                "end_seconds": element.end_seconds,
                "sheet_name": element.sheet_name,
                "cell_range": element.cell_range,
            }
        )
    return {
        "query": query,
        "sources": sources,
        "coverage": trace.get("document_coverage"),
        "visual": trace.get("visual_coverage"),
    }


@router.get("/documents/{document_id}/chunks")
def document_chunks(
    document_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    page: int | None = Query(default=None, ge=1),
    second: float | None = Query(default=None, ge=0),
    sheet: str | None = Query(default=None, max_length=255),
    cell: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=100000),
):
    document = owned_document(session, current_user.id, document_id)
    statement = (
        select(Chunk, DocumentElement, DocumentPage)
        .select_from(Chunk)
        .join(ChunkProvenance)
        .join(DocumentElement)
        .join(DocumentPage)
        .where(
            col(Chunk.version_id) == document.current_version_id,
        )
    )
    if page is not None:
        statement = statement.where(col(DocumentPage.page_number) == page)
    if second is not None:
        statement = statement.where(
            col(DocumentElement.start_seconds) <= second,
            col(DocumentElement.end_seconds) > second,
        )
    if sheet is not None:
        statement = statement.where(col(DocumentElement.sheet_name) == sheet)
    if cell is not None:
        from openpyxl.utils.cell import range_boundaries

        try:
            bounds = range_boundaries(cell.upper().replace("$", ""))
            if any(value is None for value in bounds):
                raise ValueError
        except ValueError:
            raise HTTPException(422, "Referencia de celda no válida") from None
        content = cast(col(DocumentElement.structured_content), JSONB)
        statement = statement.where(
            content["column"].as_integer() >= bounds[0],
            content["row"].as_integer() >= bounds[1],
            content["column"].as_integer() <= bounds[2],
            content["row"].as_integer() <= bounds[3],
        )
    total = session.exec(select(func.count()).select_from(statement.subquery())).one()
    rows = session.exec(
        statement.order_by(
            col(DocumentPage.page_number), col(Chunk.id), col(DocumentElement.id)
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "data": [
            {
                "id": str(chunk.id),
                "element_id": str(element.id),
                "page_number": source_page.page_number
                if document.source_type == "pdf"
                else None,
                "source_type": document.source_type,
                "start_seconds": element.start_seconds,
                "end_seconds": element.end_seconds,
                "sheet_name": element.sheet_name,
                "cell_range": element.cell_range,
                "analysis": {
                    key: value
                    for key, value in element.structured_content.items()
                    if key
                    in {
                        "provider",
                        "model",
                        "model_version",
                        "elapsed_seconds",
                        "usage",
                        "temporal_precision",
                        "clip_sha256",
                        "native_reference",
                        "original_sha256",
                        "coordinate",
                        "row",
                        "column",
                        "value",
                        "display_value",
                        "formula",
                        "cached",
                        "number_format",
                        "merged_range",
                        "context_cells",
                    }
                },
                "kind": element.element_type,
                "text": chunk.text,
                "contextualized_text": chunk.contextualized_text,
                "profile": chunk.chunking_profile,
                "bbox": element.bbox,
            }
            for chunk, element, source_page in rows
        ],
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
                "extraction": {
                    key: value
                    for key, value in version.artifact_manifest.items()
                    if key
                    in {
                        "source_type",
                        "duration_seconds",
                        "segments_total",
                        "segments_analyzed",
                        "segment_seconds",
                        "analysis_provider",
                        "analysis_model",
                        "analysis_model_version",
                        "analysis_mode",
                        "segments_prepared",
                        "clips_reused",
                        "native_enrichment",
                        "temporal_precision",
                        "ocr_pending_pages",
                        "format",
                        "sheets_total",
                        "sheets_extracted",
                        "cells_total",
                        "formula_cells",
                        "missing_formula_values",
                        "warnings",
                        "sheets",
                    }
                },
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
