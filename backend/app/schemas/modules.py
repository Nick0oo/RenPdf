import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.research import DTO, BBox, DocumentPublic, JobPublic


class StudioSource(BaseModel):
    document_id: uuid.UUID
    pages: list[int] | None = Field(default=None, min_length=1, max_length=500)
    rotation: Literal[0, 90, 180, 270] = 0
    crop: BBox | None = None

    @field_validator("pages")
    @classmethod
    def positive_pages(cls, pages: list[int] | None) -> list[int] | None:
        if pages is not None and any(page < 1 for page in pages):
            raise ValueError("Las páginas comienzan en 1")
        return pages


class StudioInput(BaseModel):
    kind: Literal["merge", "pages", "transform"]
    output_name: str = Field(min_length=1, max_length=240)
    workspace_id: uuid.UUID | None = None
    sources: list[StudioSource] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def valid_sources(self) -> StudioInput:
        if self.kind == "merge" and len(self.sources) < 2:
            raise ValueError("Combinar requiere al menos dos documentos")
        if self.kind != "merge" and len(self.sources) != 1:
            raise ValueError("Selecciona un documento para organizar o transformar")
        return self


class StudioOperationPublic(DTO):
    id: uuid.UUID
    workspace_id: uuid.UUID | None
    output_document_id: uuid.UUID | None
    kind: str
    output_name: str
    state: str
    page_count: int
    file_size: int
    sources: list[dict]
    created_at: datetime


class StudioResult(BaseModel):
    operation: StudioOperationPublic
    document: DocumentPublic
    job: JobPublic
