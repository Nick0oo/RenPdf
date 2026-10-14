"""Persisted research domain. Files and secrets are never returned as public DTOs."""

import uuid
from datetime import UTC, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field, SQLModel


def now() -> datetime:
    return datetime.now(UTC)


class Workspace(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE", index=True)
    name: str = Field(max_length=120)
    description: str = ""
    created_at: datetime = Field(default_factory=now)


class Document(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("owner_id", "sha256"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE", index=True)
    title: str = Field(max_length=255)
    original_filename: str = Field(max_length=255)
    sha256: str = Field(max_length=64, index=True)
    storage_key: str
    file_size: int
    page_count: int
    status: str = "UPLOADED"
    current_version_id: uuid.UUID | None = None
    active_index_id: uuid.UUID | None = None
    warning: str | None = None
    created_at: datetime = Field(default_factory=now)


class WorkspaceDocument(SQLModel, table=True):
    workspace_id: uuid.UUID = Field(
        foreign_key="workspace.id", ondelete="CASCADE", primary_key=True
    )
    document_id: uuid.UUID = Field(
        foreign_key="document.id", ondelete="CASCADE", primary_key=True
    )
    added_at: datetime = Field(default_factory=now)


class DocumentVersion(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("document_id", "version_number"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(
        foreign_key="document.id", ondelete="CASCADE", index=True
    )
    version_number: int = 1
    parser_name: str = "pymupdf"
    parser_version: str = ""
    status: str = "PROCESSING"
    artifact_manifest: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON, nullable=False)
    )
    created_at: datetime = Field(default_factory=now)


class DocumentPage(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("version_id", "page_number"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version_id: uuid.UUID = Field(
        foreign_key="documentversion.id", ondelete="CASCADE", index=True
    )
    page_number: int
    width: float
    height: float
    rotation: int = 0
    extraction_status: str = "EXTRACTED"
    crop_box: list[float] = Field(default_factory=list, sa_column=Column(JSON))


class DocumentElement(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    page_id: uuid.UUID = Field(
        foreign_key="documentpage.id", ondelete="CASCADE", index=True
    )
    element_type: str = "text"
    text: str = ""
    bbox: dict[str, float] | None = Field(default=None, sa_column=Column(JSON))
    source_coordinates: list[float] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    structured_content: dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    coordinate_system: str = "normalized_top_left_unrotated_crop"
    extraction_method: str = "digital"
    content_hash: str
    confidence: float | None = None


class Chunk(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version_id: uuid.UUID = Field(
        foreign_key="documentversion.id", ondelete="CASCADE", index=True
    )
    text: str
    contextualized_text: str
    content_hash: str
    chunking_profile: str = "structural-v1"


class ChunkProvenance(SQLModel, table=True):
    chunk_id: uuid.UUID = Field(
        foreign_key="chunk.id", ondelete="CASCADE", primary_key=True
    )
    element_id: uuid.UUID = Field(
        foreign_key="documentelement.id", ondelete="CASCADE", primary_key=True
    )
    span_start: int = 0
    span_end: int = 0


class EmbeddingProfile(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    provider: str
    model: str
    model_version: str
    dimensions: int
    modality: str = "text"
    metric: str = "cosine"
    fingerprint: str = Field(unique=True)


class DocumentIndex(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    version_id: uuid.UUID = Field(
        foreign_key="documentversion.id", ondelete="CASCADE", index=True
    )
    profile_id: uuid.UUID = Field(foreign_key="embeddingprofile.id", index=True)
    status: str = "BUILDING"
    created_at: datetime = Field(default_factory=now)


class ChunkEmbedding(SQLModel, table=True):
    chunk_id: uuid.UUID = Field(
        foreign_key="chunk.id", ondelete="CASCADE", primary_key=True
    )
    index_id: uuid.UUID = Field(
        foreign_key="documentindex.id", ondelete="CASCADE", primary_key=True
    )
    embedding: list[float] = Field(sa_column=Column(Vector(), nullable=False))


class Job(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(
        foreign_key="document.id", ondelete="CASCADE", index=True
    )
    version_id: uuid.UUID | None = None
    kind: str = "extract"
    state: str = "QUEUED"
    stage: str = "queued"
    progress: int = 0
    checkpoint: int = 0
    cancel_requested: bool = False
    error_code: str | None = None
    error_message: str | None = None
    parameters: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now, index=True)


class CloudConsent(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(
        foreign_key="document.id", ondelete="CASCADE", index=True
    )
    owner_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    provider: str
    scope: str
    granted_at: datetime = Field(default_factory=now)
    expires_at: datetime
    revoked_at: datetime | None = None


class RoutingPreference(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("owner_id", "scope_key", "task"),)
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    scope_key: str = "personal"
    task: str
    provider: str
    model: str
    timeout_seconds: int = 90
    max_tokens: int = 2048


class Conversation(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    workspace_id: uuid.UUID = Field(
        foreign_key="workspace.id", ondelete="CASCADE", index=True
    )
    title: str = "Nueva investigación"
    provider: str = "gemini"
    model: str = ""
    created_at: datetime = Field(default_factory=now)


class ChatMessage(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    conversation_id: uuid.UUID = Field(
        foreign_key="conversation.id", ondelete="CASCADE", index=True
    )
    role: str
    content: str
    state: str = "COMPLETE"
    provider: str | None = None
    model: str | None = None
    retrieval_mode: str | None = None
    usage: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=now)


class Citation(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    message_id: uuid.UUID = Field(
        foreign_key="chatmessage.id", ondelete="CASCADE", index=True
    )
    chunk_id: uuid.UUID = Field(foreign_key="chunk.id", ondelete="CASCADE")
    element_id: uuid.UUID = Field(foreign_key="documentelement.id", ondelete="CASCADE")
    label: int
    quote: str
    precision: str = "region"


class Annotation(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE")
    workspace_id: uuid.UUID = Field(
        foreign_key="workspace.id", ondelete="CASCADE", index=True
    )
    document_id: uuid.UUID = Field(foreign_key="document.id", ondelete="CASCADE")
    version_id: uuid.UUID = Field(foreign_key="documentversion.id", ondelete="CASCADE")
    page_number: int
    kind: str = "note"
    text: str = ""
    bbox: dict[str, float] | None = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=now)
