"""Saved research and explicit self-assessment, separate from AI verification."""

import uuid
from datetime import datetime

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

from app.domain import now


class ResearchEntry(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    workspace_id: uuid.UUID = Field(
        foreign_key="workspace.id", ondelete="CASCADE", index=True
    )
    kind: str = Field(max_length=20)
    title: str = Field(max_length=200)
    question: str = ""
    notes: str = ""
    source_message_ids: list[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    document_ids: list[str] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    created_at: datetime = Field(default_factory=now)


class StudyDeck(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    workspace_id: uuid.UUID = Field(
        foreign_key="workspace.id", ondelete="CASCADE", index=True
    )
    name: str = Field(max_length=120)
    description: str = ""
    created_at: datetime = Field(default_factory=now)


class StudyCard(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    deck_id: uuid.UUID = Field(
        foreign_key="studydeck.id", ondelete="CASCADE", index=True
    )
    question: str
    answer: str
    document_id: uuid.UUID | None = Field(
        default=None, foreign_key="document.id", ondelete="SET NULL"
    )
    version_id: uuid.UUID | None = Field(
        default=None, foreign_key="documentversion.id", ondelete="SET NULL"
    )
    page_number: int = 1
    source_message_id: uuid.UUID | None = Field(
        default=None, foreign_key="chatmessage.id", ondelete="SET NULL"
    )
    citation_label: int | None = None
    created_at: datetime = Field(default_factory=now)
    due_at: datetime = Field(default_factory=now, index=True)
    review_count: int = 0


class StudyReview(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    card_id: uuid.UUID = Field(
        foreign_key="studycard.id", ondelete="CASCADE", index=True
    )
    rating: str = Field(max_length=10)
    response: str = ""
    previous_due_at: datetime
    next_due_at: datetime
    created_at: datetime = Field(default_factory=now)
