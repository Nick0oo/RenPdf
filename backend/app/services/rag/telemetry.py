"""Owner-visible inference metadata without prompts, generated text or source text."""

import time
from datetime import UTC, datetime
from typing import Any

from app.services.models.contracts import ModelRoutingPolicy

PROMPT_TEMPLATE_VERSION = "rag-native-media-v5"


class ChatTrace:
    def __init__(self, policy: ModelRoutingPolicy):
        self.started = time.monotonic()
        self.data: dict[str, Any] = {
            "schema_version": 1,
            "started_at": datetime.now(UTC).isoformat(),
            "prompt_template_version": PROMPT_TEMPLATE_VERSION,
            "policy": policy.model_dump(exclude={"alternatives"}),
            "stages": [],
            "inference_attempted": False,
            "consent_verified": False,
        }

    def mark(self, stage: str) -> None:
        self.data["stages"].append(
            {
                "stage": stage,
                "elapsed_seconds": round(time.monotonic() - self.started, 3),
            }
        )

    def finish(
        self, provider: Any, outcome: str, error_code: str | None = None
    ) -> dict[str, Any]:
        usage = getattr(provider, "last_usage", None)
        result: dict[str, Any] = (
            usage.model_dump() if usage else {"status": "NOT_REPORTED"}
        )
        finish_reason = getattr(provider, "last_finish_reason", None)
        self.data.update(
            finished_at=datetime.now(UTC).isoformat(),
            elapsed_seconds=round(time.monotonic() - self.started, 3),
            outcome=outcome,
            error_code=error_code,
            response_mode=getattr(provider, "response_mode", None),
            transport_attempts=getattr(provider, "transport_attempts", None),
            finish_reason=finish_reason
            if isinstance(finish_reason, str)
            and finish_reason
            in {"stop", "length", "content_filter", "STOP", "MAX_TOKENS", "SAFETY"}
            else None,
        )
        self.mark("finished")
        result["trace"] = self.data
        return result
