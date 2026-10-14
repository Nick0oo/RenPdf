import uuid
from datetime import UTC, datetime

from sqlmodel import Session, col, select

from app.domain import CloudConsent
from app.services.models.contracts import ProviderError
from app.services.models.providers import get_provider


def require_consent(
    session: Session, document_ids: list[uuid.UUID], provider: str, scope: str
) -> None:
    if not get_provider(provider).is_cloud:
        return
    for document_id in set(document_ids):
        consent = session.exec(
            select(CloudConsent).where(
                col(CloudConsent.document_id) == document_id,
                col(CloudConsent.provider) == provider,
                col(CloudConsent.scope) == scope,
                col(CloudConsent.revoked_at).is_(None),  # type: ignore[union-attr]
                col(CloudConsent.expires_at) > datetime.now(UTC),
            )
        ).first()
        if not consent:
            raise ProviderError(
                "CONSENT_REQUIRED",
                f"Autoriza {scope} con {provider} para cada documento seleccionado.",
            )
