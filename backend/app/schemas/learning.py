import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.research import DTO, EvidencePublic


class ResearchInput(BaseModel):
    workspace_id: uuid.UUID
    kind: Literal["question", "summary", "comparison"]
    title: str = Field(min_length=1, max_length=200)
    question: str = Field(default="", max_length=4000)
    notes: str = Field(default="", max_length=10000)
    source_message_ids: list[uuid.UUID] = Field(default_factory=list, max_length=30)
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def valid_question(self):
        self.title = self.title.strip()
        self.question = self.question.strip()
        if not self.title or (self.kind == "question" and not self.question):
            raise ValueError("Escribe un título y una pregunta para investigar")
        return self


class SourceAnswer(BaseModel):
    message_id: uuid.UUID
    available: bool
    content: str = ""
    provider: str | None = None
    model: str | None = None
    citations: list[EvidencePublic] = Field(default_factory=list)


class ResearchPublic(DTO):
    id: uuid.UUID
    workspace_id: uuid.UUID
    kind: str
    title: str
    question: str
    notes: str
    document_ids: list[str]
    created_at: datetime
    answers: list[SourceAnswer] = Field(default_factory=list)


class DeckInput(BaseModel):
    workspace_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)

    @field_validator("name")
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Escribe un nombre para el mazo")
        return value.strip()


class DeckPublic(DTO):
    id: uuid.UUID
    workspace_id: uuid.UUID
    name: str
    description: str
    created_at: datetime
    cards: int = 0
    due_cards: int = 0
    reviews: int = 0


class CardInput(BaseModel):
    deck_id: uuid.UUID
    question: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=10000)
    document_id: uuid.UUID | None = None
    page_number: int = Field(default=1, ge=1)
    source_message_id: uuid.UUID | None = None
    citation_label: int | None = Field(default=None, ge=1)

    @field_validator("question", "answer")
    @classmethod
    def nonempty_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Escribe la pregunta y la respuesta de la ficha")
        return value.strip()

    @model_validator(mode="after")
    def source_required(self):
        if self.source_message_id is not None:
            if self.citation_label is None:
                raise ValueError("Selecciona una cita de la respuesta")
        elif self.document_id is None:
            raise ValueError("Vincula la ficha a una página del PDF o a una cita")
        return self


class CardPublic(DTO):
    id: uuid.UUID
    deck_id: uuid.UUID
    question: str
    answer: str
    document_id: uuid.UUID | None
    version_id: uuid.UUID | None
    page_number: int
    source_message_id: uuid.UUID | None
    citation_label: int | None
    created_at: datetime
    due_at: datetime
    review_count: int
    source_title: str | None = None
    source_available: bool = False
    evidence: EvidencePublic | None = None


class ReviewInput(BaseModel):
    rating: Literal["again", "hard", "good", "easy"]
    response: str = Field(default="", max_length=10000)


class ReviewPublic(DTO):
    id: uuid.UUID
    card_id: uuid.UUID
    rating: str
    response: str
    created_at: datetime
    next_due_at: datetime


class ProgressPublic(BaseModel):
    cards: int
    due_cards: int
    reviewed_cards: int
    reviews: int
    ratings: dict[str, int]
    assessment: Literal["self_reported"] = "self_reported"
