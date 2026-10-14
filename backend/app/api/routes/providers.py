from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.domain import RoutingPreference
from app.schemas.research import RoutingInput, RoutingPublic
from app.services.documents.access import owned_workspace
from app.services.models.contracts import ProviderConfig, ProviderError
from app.services.models.providers import get_provider

router = APIRouter(prefix="/providers", tags=["providers"])


def safe_health(name: str) -> ProviderConfig:
    try:
        return get_provider(name, timeout=10).health()
    except ProviderError as error:
        return ProviderConfig(
            name=name,
            endpoint=None,
            is_cloud=True,
            status="UNAVAILABLE",
            checked_at=datetime.now(UTC).isoformat(),
            error_code=error.code,
        )


@router.get("/", response_model=list[ProviderConfig])
def provider_catalog(current_user: CurrentUser):
    del current_user
    with ThreadPoolExecutor(max_workers=2) as executor:
        return list(
            executor.map(
                safe_health,
                ["gemini", "ollama", "llamacpp", "openai-compatible"],
            )
        )


@router.get("/routing", response_model=list[RoutingPublic])
def read_routing(session: SessionDep, current_user: CurrentUser):
    return session.exec(
        select(RoutingPreference).where(
            col(RoutingPreference.owner_id) == current_user.id
        )
    ).all()


@router.put("/routing", response_model=RoutingPublic)
def save_routing(body: RoutingInput, session: SessionDep, current_user: CurrentUser):
    if body.scope_key.startswith("workspace:"):
        import uuid

        try:
            identifier = uuid.UUID(body.scope_key.split(":", 1)[1])
        except ValueError:
            raise HTTPException(422, "Workspace inválido") from None
        owned_workspace(session, current_user.id, identifier)
    elif body.scope_key not in {"global", "personal"}:
        raise HTTPException(422, "Ámbito de configuración inválido")
    row = session.exec(
        select(RoutingPreference).where(
            col(RoutingPreference.owner_id) == current_user.id,
            col(RoutingPreference.scope_key) == body.scope_key,
            col(RoutingPreference.task) == body.task,
        )
    ).first()
    if row:
        row.sqlmodel_update(body.model_dump())
    else:
        row = RoutingPreference(owner_id=current_user.id, **body.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


@router.get("/diagnostics")
def diagnostics(session: SessionDep, current_user: CurrentUser):
    del current_user
    import importlib.metadata

    from redis import Redis

    from app.services.parsing.pdf import parser_available

    database = (
        session.connection()
        .execute(text("SELECT extversion FROM pg_extension WHERE extname='vector'"))
        .scalar()
    )
    try:
        redis_available = bool(
            Redis.from_url(
                settings.REDIS_URL, socket_timeout=2, socket_connect_timeout=2
            ).ping()
        )
    except Exception:
        redis_available = False
    return {
        "database": "AVAILABLE",
        "pgvector": database,
        "redis": "AVAILABLE" if redis_available else "UNAVAILABLE",
        "parser": "docling" if parser_available() else "pymupdf",
        "pymupdf_version": importlib.metadata.version("pymupdf"),
        "ocr_enabled": settings.ENABLE_OCR,
        "cloud_default": "DENY",
        "reranking": "NOT_CONFIGURED",
        "max_pages": settings.MAX_DOCUMENT_PAGES,
        "max_upload_mb": settings.MAX_UPLOAD_SIZE_MB,
    }
