from unittest.mock import MagicMock

import httpx
import pytest

from app.services.citations.validation import validate_citations
from app.services.models.contracts import EmbeddingInput, ProviderError
from app.services.models.providers import (
    GeminiProvider,
    OllamaProvider,
    OpenAICompatibleProvider,
    normalized_vectors,
    safe_error,
    validate_endpoint,
)
from app.services.rag.retrieval import reciprocal_rank_fusion


def test_embedding_two_uses_independent_calls_and_retrieval_formats(monkeypatch):
    client = MagicMock()
    client.models.embed_content.return_value.embeddings = [
        MagicMock(values=[1.0, 2.0, 3.0])
    ]
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    client.__enter__.return_value = client
    result = provider.embed("gemini-embedding-2", ["uno", "dos"], 3)
    assert len(result) == 2
    assert client.models.embed_content.call_count == 2
    assert (
        client.models.embed_content.call_args_list[0].kwargs["contents"]
        == "title: none | text: uno"
    )


def test_multimodal_embeddings_are_one_vector_per_independent_input(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.embed_content.return_value.embeddings = [
        MagicMock(values=[1.0, 2.0, 3.0])
    ]
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    vectors = provider.embed_multimodal(
        "gemini-embedding-2",
        [EmbeddingInput(text="text"), EmbeddingInput(image=b"synthetic-contract")],
        3,
    )
    assert len(vectors) == 2
    assert client.models.embed_content.call_count == 2
    assert (
        len(client.models.embed_content.call_args_list[1].kwargs["contents"].parts) == 2
    )


def test_revocation_guard_stops_before_next_cloud_request(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.embed_content.return_value.embeddings = [
        MagicMock(values=[1.0, 2.0, 3.0])
    ]
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    count = 0

    def guard():
        nonlocal count
        count += 1
        if count == 2:
            raise ProviderError("CONSENT_REQUIRED", "Revoked during batch")

    with pytest.raises(ProviderError):
        provider.embed("gemini-embedding-2", ["one", "two"], 3, before_send=guard)
    assert client.models.embed_content.call_count == 1
    provider.embed("gemini-embedding-2", ["pregunta"], 3, query=True)
    assert (
        client.models.embed_content.call_args.kwargs["contents"]
        == "task: search result | query: pregunta"
    )


@pytest.mark.parametrize(
    "vectors,count,dimensions",
    [([], 1, 3), ([[1, 2]], 1, 3), ([[0, 0, 0]], 1, 3), ([[1, float("nan"), 2]], 1, 3)],
)
def test_invalid_embeddings_rejected(vectors, count, dimensions):
    with pytest.raises(ProviderError):
        normalized_vectors(vectors, count, dimensions)


@pytest.mark.parametrize(
    "url",
    [
        "http://169.254.169.254/latest/meta-data",
        "http://attacker.example",
        "http://user:password@localhost",
        "http://localhost?token=secret",
    ],
)
def test_endpoint_policy_denies_ssrf(url):
    with pytest.raises(ProviderError):
        validate_endpoint(url)


def test_error_redacts_provider_response_and_credentials():
    response = httpx.Response(
        429,
        text="SECRET-MARKER API key and prompt",
        request=httpx.Request("POST", "https://example.com"),
    )
    error = safe_error(
        httpx.HTTPStatusError(
            "SECRET-MARKER", request=response.request, response=response
        )
    )
    assert error.code == "QUOTA_EXCEEDED"
    assert "SECRET-MARKER" not in error.message


def test_invalid_and_missing_citations_are_rejected():
    assert validate_citations("Dato [Fuente 2].", {1, 2}) == {2}
    with pytest.raises(ProviderError):
        validate_citations("Dato [Fuente 99].", {1})
    with pytest.raises(ProviderError):
        validate_citations("Dato sin fuentes.", {1})
    assert validate_citations("No encontré evidencia.", set()) == set()
    assert validate_citations("Dato [Fuente 1, Fuente 2].", {1, 2}) == {1, 2}
    with pytest.raises(ProviderError):
        validate_citations("Dato [Fuente 1, Fuente 99].", {1})


def test_rrf_deduplicates_within_rankings():
    import uuid

    a, b = uuid.uuid4(), uuid.uuid4()
    fused = reciprocal_rank_fusion([[a, a, b], [b, a]])
    assert len(fused) == 2
    assert fused[0][1] == pytest.approx(1 / 61 + 1 / 62)


def test_ollama_contract_discovers_capabilities_embeds_and_streams(monkeypatch):
    import json

    from app.services.models.contracts import InferenceRequest

    seen = []

    def handler(request):
        seen.append(request.url.path)
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": "contract", "digest": "v1"}]}
            )
        if request.url.path == "/api/show":
            return httpx.Response(
                200, json={"capabilities": ["completion", "vision", "embedding"]}
            )
        if request.url.path == "/api/embed":
            return httpx.Response(200, json={"embeddings": [[1, 2, 3]]})
        return httpx.Response(
            200,
            content="\n".join(
                json.dumps(value)
                for value in [
                    {"message": {"content": "answer"}},
                    {"done": True, "eval_count": 1, "prompt_eval_count": 3},
                ]
            ),
        )

    provider = OllamaProvider()
    monkeypatch.setattr(
        provider,
        "client",
        lambda: httpx.Client(
            base_url="http://127.0.0.1:11434", transport=httpx.MockTransport(handler)
        ),
    )
    assert provider.discover()[0].capabilities.vision == "declared"
    assert len(provider.embed("contract", ["text"], 3)[0]) == 3
    assert (
        "".join(
            provider.stream(
                InferenceRequest(model="contract", system="safe", prompt="text")
            )
        )
        == "answer"
    )
    assert provider.last_usage.output_tokens == 1
    assert seen == ["/api/tags", "/api/show", "/api/embed", "/api/chat"]


def test_openai_compatible_contract_does_not_assume_vision(monkeypatch):
    def handler(request):
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "contract"}]})
        if request.url.path == "/v1/embeddings":
            return httpx.Response(
                200,
                json={
                    "data": [
                        {"index": 1, "embedding": [3, 2, 1]},
                        {"index": 0, "embedding": [1, 2, 3]},
                    ]
                },
            )
        return httpx.Response(
            200,
            content='data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n',
        )

    from app.services.models.contracts import InferenceRequest

    provider = OpenAICompatibleProvider("llamacpp")
    monkeypatch.setattr(
        provider,
        "client",
        lambda: httpx.Client(
            base_url="http://127.0.0.1:8080", transport=httpx.MockTransport(handler)
        ),
    )
    assert provider.discover()[0].capabilities.vision == "unknown"
    assert len(provider.embed("contract", ["one", "two"], 3)) == 2
    assert (
        "".join(
            provider.stream(
                InferenceRequest(model="contract", system="safe", prompt="text")
            )
        )
        == "answer"
    )
