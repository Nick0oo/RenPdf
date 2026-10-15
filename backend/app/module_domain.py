"""Local PDF derivatives and their durable, content-free lineage."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

from app.domain import now


class StudioOperation(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    owner_id: uuid.UUID = Field(foreign_key="user.id", ondelete="CASCADE", index=True)
    workspace_id: uuid.UUID | None = Field(
        default=None, foreign_key="workspace.id", ondelete="SET NULL", index=True
    )
    output_document_id: uuid.UUID | None = Field(
        default=None, foreign_key="document.id", ondelete="SET NULL", index=True
    )
    kind: str
    output_name: str = Field(max_length=255)
    state: str = "COMPLETE"
    page_count: int
    file_size: int
    sources: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    created_at: datetime = Field(default_factory=now, index=True)
