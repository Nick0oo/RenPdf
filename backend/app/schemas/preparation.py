from pydantic import BaseModel

from app.schemas.research import JobPublic


class LocalIndexPreparationPublic(BaseModel):
    state: str
    reason: str
    job: JobPublic | None = None
