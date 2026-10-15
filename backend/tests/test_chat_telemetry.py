import json
from types import SimpleNamespace

import pytest

from app.services.models.contracts import ModelRoutingPolicy, TokenUsage
from app.services.rag.telemetry import ChatTrace


@pytest.mark.parametrize(
    "finish_reason", ["private-server-detail", {"error": "private-server-detail"}]
)
def test_trace_keeps_reported_usage_on_failure_and_redacts_unknown_finish_reason(
    finish_reason,
):
    trace = ChatTrace(
        ModelRoutingPolicy(
            provider="ollama", model="local", timeout_seconds=120, max_tokens=384
        )
    )
    trace.mark("inference_started")
    provider = SimpleNamespace(
        last_usage=TokenUsage(input_tokens=90, output_tokens=128),
        last_finish_reason=finish_reason,
    )
    result = trace.finish(provider, "failed", "MISSING_CITATIONS")
    assert result["input_tokens"] == 90 and result["output_tokens"] == 128
    assert result["trace"]["outcome"] == "failed"
    assert result["trace"]["error_code"] == "MISSING_CITATIONS"
    assert result["trace"]["elapsed_seconds"] >= 0
    assert result["trace"]["finished_at"] >= result["trace"]["started_at"]
    assert result["trace"]["finish_reason"] is None
    assert "private-server-detail" not in json.dumps(result)


def test_trace_distinguishes_unreported_usage_from_zero_and_records_policy():
    policy = ModelRoutingPolicy(
        provider="ollama", model="local", timeout_seconds=180, max_tokens=384
    )
    result = ChatTrace(policy).finish(None, "no_evidence")
    assert result["status"] == "NOT_REPORTED" and "input_tokens" not in result
    assert result["trace"]["inference_attempted"] is False
    assert result["trace"]["policy"]["max_tokens"] == 384
    assert result["trace"]["policy"]["timeout_seconds"] == 180
