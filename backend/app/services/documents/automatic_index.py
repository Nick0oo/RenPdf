"""Prepare complete local text indexes through the durable PostgreSQL outbox."""

import uuid
from dataclasses import dataclass
from urllib.parse import urlsplit

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.config import settings
from app.domain import (
    Chunk,
    Document,
    DocumentIndex,
    DocumentVersion,
    Job,
    Workspace,
    WorkspaceDocument,
)
from app.services.models.routing import resolve_policy

LOCAL_HOSTS = {"localhost", "127.0.0.1", "host.docker.internal"}
PENDING_STATES = {"QUEUED", "RUNNING"}


@dataclass
class LocalIndexPlan:
    state: str
    reason: str
    job: Job | None = None
    created: bool = False


def restored_text_state(session: Session, document: Document) -> str:
    version = session.get(DocumentVersion, document.current_version_id)
    return (
        "DEGRADED"
        if version and version.artifact_manifest.get("ocr_pending_pages")
        else "EXTRACTED"
    )


def local_index_workspace(
    session: Session, document: Document, extraction_job: Job | None
) -> uuid.UUID | None:
    explicit = (extraction_job.parameters if extraction_job else {}).get("workspace_id")
    if explicit:
        try:
            workspace = session.get(Workspace, uuid.UUID(str(explicit)))
        except ValueError:
            workspace = None
        if workspace and workspace.owner_id == document.owner_id:
            return workspace.id
    linked = session.exec(
        select(WorkspaceDocument.workspace_id)
        .join(Workspace, col(Workspace.id) == col(WorkspaceDocument.workspace_id))
        .where(
            col(WorkspaceDocument.document_id) == document.id,
            col(Workspace.owner_id) == document.owner_id,
        )
        .limit(2)
    ).all()
    return linked[0] if len(linked) == 1 else None


def plan_local_index(
    session: Session, document: Document, *, extraction_job: Job | None = None
) -> LocalIndexPlan:
    """Stage at most one index job; the caller commits and dispatches it.

    No discovery or model calls happen here. The index worker verifies the real
    model/version/capabilities before embedding, and keeps any failure visible.
    """
    session.exec(
        select(Document).where(col(Document.id) == document.id).with_for_update()
    ).one()
    if not settings.AUTO_INDEX_LOCAL:
        return LocalIndexPlan("DISABLED", "AUTOMATIC_LOCAL_INDEX_DISABLED")
    if not document.current_version_id:
        return LocalIndexPlan("NOT_READY", "DOCUMENT_NOT_EXTRACTED")
    active = (
        session.get(DocumentIndex, document.active_index_id)
        if document.active_index_id
        else None
    )
    if (
        active
        and active.status == "READY"
        and active.version_id == document.current_version_id
    ):
        return LocalIndexPlan("READY", "EXISTING_CURRENT_INDEX")
    pending = session.exec(
        select(Job).where(
            col(Job.document_id) == document.id,
            col(Job.state).in_(list(PENDING_STATES)),
            col(Job.id) != extraction_job.id if extraction_job else True,
        )
    ).first()
    if pending:
        if pending.kind == "index" and pending.parameters.get("auto_index_local"):
            return LocalIndexPlan(pending.state, "EXISTING_LOCAL_INDEX_JOB", pending)
        return LocalIndexPlan("BUSY", "EXISTING_DOCUMENT_JOB", pending)
    workspace_id = local_index_workspace(session, document, extraction_job)
    policy = resolve_policy(session, document.owner_id, workspace_id, "embeddings")
    endpoint = {
        "llamacpp": settings.LLAMACPP_BASE_URL,
        "ollama": settings.OLLAMA_BASE_URL,
        "embeddinggemma": settings.EMBEDDINGGEMMA_BASE_URL,
    }.get(policy.provider)
    if policy.provider not in {"llamacpp", "ollama", "embeddinggemma"}:
        return LocalIndexPlan("NOT_CONFIGURED", "SELECT_LOCAL_EMBEDDING_PROVIDER")
    try:
        hostname = urlsplit(endpoint).hostname if endpoint else None
    except ValueError:
        hostname = None
    if hostname not in LOCAL_HOSTS:
        return LocalIndexPlan("NOT_CONFIGURED", "LOCAL_ENDPOINT_REQUIRED")
    if not policy.model or (
        policy.provider == "llamacpp" and settings.LLAMACPP_MODE != "embeddings"
    ):
        return LocalIndexPlan("NOT_CONFIGURED", "LOCAL_EMBEDDING_MODEL_REQUIRED")
    dimensions = (
        settings.LLAMACPP_EMBEDDING_DIMENSIONS
        if policy.provider == "llamacpp"
        else settings.EMBEDDING_DIMENSIONS
    )
    parameters = {
        "provider": policy.provider,
        "model": policy.model,
        "dimensions": dimensions,
        "modality": "multimodal"
        if policy.provider == "embeddinggemma" and document.source_type == "pdf"
        else "text",
        "auto_index_local": True,
        "timeout_seconds": policy.timeout_seconds,
    }
    if workspace_id:
        parameters["workspace_id"] = str(workspace_id)
    previous = session.exec(
        select(Job)
        .where(
            col(Job.document_id) == document.id,
            col(Job.kind) == "index",
            col(Job.version_id) == document.current_version_id,
        )
        .order_by(col(Job.created_at).desc())
    ).all()
    for attempt in previous:
        if all(
            attempt.parameters.get(key) == parameters[key]
            for key in (
                "provider",
                "model",
                "dimensions",
                "modality",
                "auto_index_local",
            )
        ):
            return LocalIndexPlan(
                attempt.state, "EXISTING_LOCAL_INDEX_ATTEMPT", attempt
            )
    count = session.exec(
        select(func.count())
        .select_from(Chunk)
        .where(col(Chunk.version_id) == document.current_version_id)
    ).one()
    if not count:
        return LocalIndexPlan("NO_TEXT", "NO_EXTRACTED_TEXT_CHUNKS")
    job = Job(
        document_id=document.id,
        version_id=document.current_version_id,
        kind="index",
        parameters=parameters,
    )
    session.add(job)
    if not document.active_index_id:
        document.status = "INDEXING"
        session.add(document)
    return LocalIndexPlan("QUEUED", "LOCAL_INDEX_QUEUED", job, True)
