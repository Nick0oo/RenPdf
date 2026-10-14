import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class DTO(BaseModel):
    model_config = {"from_attributes": True}

    @field_validator(
        "created_at",
        "updated_at",
        "expires_at",
        "granted_at",
        "revoked_at",
        mode="after",
        check_fields=False,
    )
    @classmethod
    def canonical_utc(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value and value.tzinfo is None else value


class WorkspaceInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)


class WorkspacePublic(DTO):
    id: uuid.UUID
    name: str
    description: str
    created_at: datetime


class DocumentPublic(DTO):
    id: uuid.UUID
    title: str
    original_filename: str
    file_size: int
    page_count: int
    status: str
    current_version_id: uuid.UUID | None
    active_index_id: uuid.UUID | None
    warning: str | None
    created_at: datetime


class RenameInput(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class JobPublic(DTO):
    id: uuid.UUID
    document_id: uuid.UUID
    kind: str
    state: str
    stage: str
    progress: int
    checkpoint: int
    cancel_requested: bool
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


ProviderName = Literal["gemini", "ollama", "llamacpp", "openai-compatible"]
ConsentScope = Literal[
    "embeddings", "multimodal_embeddings", "chat", "vision", "original_pdf"
]


class ConsentInput(BaseModel):
    provider: ProviderName
    scope: ConsentScope
    expires_in_days: int = Field(default=30, ge=1, le=365)


class ConsentPublic(DTO):
    id: uuid.UUID
    document_id: uuid.UUID
    provider: str
    scope: str
    granted_at: datetime
    expires_at: datetime
    revoked_at: datetime | None


class ModelSelection(BaseModel):
    provider: ProviderName
    model: str = Field(min_length=1, max_length=200)


class IndexInput(ModelSelection):
    dimensions: int = Field(default=768, ge=1, le=2000)
    modality: Literal["text", "multimodal"] = "text"


class RoutingInput(ModelSelection):
    task: Literal["chat", "embeddings", "vision", "rerank", "questions", "summary"]
    scope_key: str = "personal"
    timeout_seconds: int = Field(default=90, ge=5, le=300)
    max_tokens: int = Field(default=2048, ge=64, le=8192)


class RoutingPublic(DTO):
    task: str
    scope_key: str
    provider: str
    model: str
    timeout_seconds: int
    max_tokens: int


class ConversationInput(BaseModel):
    title: str = Field(default="Nueva investigación", min_length=1, max_length=200)
    provider: ProviderName = "gemini"
    model: str = Field(default="", max_length=200)


class ConversationPublic(DTO):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str
    provider: str
    model: str
    created_at: datetime


class BBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def fits_page(self) -> BBox:
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("La región debe permanecer dentro de la página")
        return self


class QuestionInput(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=30)
    selected_element_id: uuid.UUID | None = None
    vision_element_id: uuid.UUID | None = None


class EvidencePublic(DTO):
    chunk_id: uuid.UUID
    element_id: uuid.UUID
    document_id: uuid.UUID
    version_id: uuid.UUID
    document_title: str
    page_number: int
    text: str
    bbox: BBox | None
    rotation: int
    precision: str = "region"
    label: int = 0
    score: float = 0


class MessagePublic(DTO):
    id: uuid.UUID
    role: str
    content: str
    state: str
    provider: str | None
    model: str | None
    retrieval_mode: str | None
    created_at: datetime
    citations: list[EvidencePublic] = Field(default_factory=list)
    usage: dict[str, Any] = Field(default_factory=dict)


class AnnotationInput(BaseModel):
    document_id: uuid.UUID
    page_number: int = Field(ge=1)
    kind: Literal["note", "highlight", "bookmark"] = "note"
    text: str = Field(default="", max_length=10000)
    bbox: BBox | None = None


class AnnotationPublic(DTO):
    id: uuid.UUID
    document_id: uuid.UUID
    version_id: uuid.UUID
    page_number: int
    kind: str
    text: str
    bbox: BBox | None
    created_at: datetime


class ElementPublic(DTO):
    id: uuid.UUID
    element_type: str
    text: str
    bbox: BBox | None
    extraction_method: str
    confidence: float | None
    structured_content: dict[str, Any]


class EnrichmentInput(BaseModel):
    purpose: Literal["questions", "summary"] = "questions"


class SuggestedQuestion(BaseModel):
    question: str = Field(min_length=5, max_length=300)
    element_ids: list[uuid.UUID] = Field(min_length=1, max_length=5)


class EnrichmentPublic(BaseModel):
    questions: list[SuggestedQuestion] = Field(default_factory=list)
    summary: str | None = None
    provider: str | None = None
    model: str | None = None
