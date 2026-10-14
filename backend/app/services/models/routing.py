import uuid

from sqlmodel import Session, col, select

from app.core.config import settings
from app.domain import RoutingPreference
from app.services.models.contracts import ModelRoutingPolicy


def resolve_policy(
    session: Session,
    owner_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
    task: str,
    provider: str | None = None,
    model: str | None = None,
) -> ModelRoutingPolicy:
    policy = ModelRoutingPolicy(
        provider=settings.DEFAULT_EMBEDDING_PROVIDER
        if task == "embeddings"
        else settings.DEFAULT_CHAT_PROVIDER,
        model=settings.DEFAULT_EMBEDDING_MODEL
        if task == "embeddings"
        else settings.DEFAULT_CHAT_MODEL,
        timeout_seconds=settings.PROVIDER_TIMEOUT_SECONDS,
        max_tokens=settings.MAX_ANSWER_TOKENS,
    )
    for scope in (
        "global",
        "personal",
        f"workspace:{workspace_id}" if workspace_id else "",
    ):
        if not scope:
            continue
        row = session.exec(
            select(RoutingPreference).where(
                col(RoutingPreference.owner_id) == owner_id,
                col(RoutingPreference.scope_key) == scope,
                col(RoutingPreference.task) == task,
            )
        ).first()
        if row:
            policy = ModelRoutingPolicy(
                provider=row.provider,
                model=row.model,
                timeout_seconds=row.timeout_seconds,
                max_tokens=row.max_tokens,
            )
    if provider and model:
        policy.provider, policy.model = provider, model
    return policy
