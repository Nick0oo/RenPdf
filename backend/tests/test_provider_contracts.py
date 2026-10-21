from unittest.mock import MagicMock

import httpx
import pytest

from app.services.citations.validation import canonicalize_citations, validate_citations
from app.services.models.contracts import (
    EmbeddingInput,
    InferenceRequest,
    MediaInput,
    ProviderError,
)
from app.services.models.providers import (
    GeminiProvider,
    NativeEmbeddingProvider,
    OllamaProvider,
    OpenAICompatibleProvider,
    normalized_vectors,
    safe_error,
    validate_endpoint,
)
from app.services.rag.retrieval import reciprocal_rank_fusion


def test_native_runtime_offline_preserves_provider_error_contract(monkeypatch):
    provider = NativeEmbeddingProvider()

    def unavailable():
        raise httpx.ConnectError("Synthetic unavailable runtime")

    monkeypatch.setattr(provider, "client", unavailable)
    with pytest.raises(ProviderError) as error:
        provider.discover()
    assert error.value.code == "PROVIDER_UNAVAILABLE"
    assert error.value.retryable


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
        len(client.models.embed_content.call_args_list[1].kwargs["contents"].parts) == 1
    )


@pytest.mark.parametrize("mime", ["audio/wav", "audio/mpeg", "video/mp4"])
def test_native_media_parts_reach_gemini_analysis_and_embedding_sdk(monkeypatch, mime):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.embed_content.return_value.embeddings = [
        MagicMock(values=[1.0, 2.0, 3.0])
    ]
    client.models.generate_content.return_value = MagicMock(
        text="{}", usage_metadata=None
    )
    client.models.generate_content_stream.side_effect = httpx.ReadError(
        "interrupted stream"
    )
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    media = MediaInput(data=b"synthetic-media", mime_type=mime)
    assert list(
        provider.stream(
            InferenceRequest(
                model="gemini-test", system="Analyze", prompt="Clip", media=[media]
            )
        )
    ) == ["{}"]
    assert provider.response_mode == "buffered_native"
    client.models.generate_content_stream.assert_not_called()
    part = client.models.generate_content.call_args.kwargs["contents"].parts[-1]
    assert part.inline_data.mime_type == mime and part.inline_data.data == media.data
    provider.embed_multimodal(
        "gemini-embedding-2", [EmbeddingInput(text="segment", media=media)], 3
    )
    part = client.models.embed_content.call_args.kwargs["contents"].parts[-1]
    assert part.inline_data.mime_type == mime and part.inline_data.data == media.data


def test_reused_gemini_adapter_does_not_attribute_previous_clip_usage(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    request = InferenceRequest(model="gemini-test", system="Analyze", prompt="Clip")
    client.models.generate_content_stream.return_value = [
        MagicMock(
            text="first",
            usage_metadata=MagicMock(prompt_token_count=100, candidates_token_count=20),
        )
    ]
    assert list(provider.stream(request)) == ["first"]
    assert provider.last_usage.input_tokens == 100
    client.models.generate_content_stream.return_value = [
        MagicMock(text="second", usage_metadata=None)
    ]
    assert list(provider.stream(request)) == ["second"]
    assert provider.last_usage is None


def test_native_clips_are_interleaved_with_their_own_source_labels(monkeypatch):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.generate_content.return_value = MagicMock(
        text="Cited", usage_metadata=None
    )
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    media = [
        MediaInput(
            data=b"first",
            mime_type="audio/mpeg",
            source_id=1,
            start_seconds=0,
            end_seconds=10,
        ),
        MediaInput(
            data=b"second",
            mime_type="audio/mpeg",
            source_id=6,
            start_seconds=60,
            end_seconds=64,
        ),
    ]
    list(
        provider.stream(
            InferenceRequest(
                model="gemini-test", system="Sources", prompt="Read", media=media
            )
        )
    )
    parts = client.models.generate_content.call_args.kwargs["contents"].parts
    assert "[Fuente 1]" in parts[-4].text and parts[-3].inline_data.data == b"first"
    assert "[Fuente 6]" in parts[-2].text and "60.0" in parts[-2].text
    assert parts[-1].inline_data.data == b"second"


@pytest.mark.parametrize("schema", [None, {"type": "object"}])
def test_learning_requests_buffer_and_retry_before_returning_material(
    monkeypatch, schema
):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.generate_content.side_effect = [
        httpx.RemoteProtocolError("broken response"),
        MagicMock(text="{}", usage_metadata=None),
    ]
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    request = InferenceRequest(
        model="gemini-test",
        system="Study",
        prompt="Sources",
        buffered=True,
        json_schema=schema,
    )
    assert list(provider.stream(request)) == ["{}"]
    assert provider.response_mode == "buffered" and provider.transport_attempts == 2
    client.models.generate_content_stream.assert_not_called()


def test_native_response_retries_one_broken_connection_without_replaying_tokens(
    monkeypatch,
):
    client = MagicMock()
    client.__enter__.return_value = client
    client.models.generate_content.side_effect = [
        httpx.ReadError("connection reset"),
        MagicMock(text="Respuesta [Fuente 1]", usage_metadata=None),
    ]
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: client)
    request = InferenceRequest(
        model="gemini-test",
        system="Read",
        prompt="Question",
        media=[MediaInput(data=b"audio", mime_type="audio/mpeg")],
    )
    assert list(provider.stream(request)) == ["Respuesta [Fuente 1]"]
    assert provider.transport_attempts == 2
    assert client.models.generate_content.call_count == 2
    client.models.generate_content_stream.assert_not_called()

    client.models.generate_content.reset_mock(side_effect=True)
    client.models.generate_content.side_effect = httpx.ReadError("connection reset")
    with pytest.raises(ProviderError) as failure:
        list(provider.stream(request))
    assert failure.value.details == {"exception": "ReadError"}
    assert client.models.generate_content.call_count == 2


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


@pytest.mark.parametrize(
    "status,expected,retryable",
    [(400, "PROVIDER_INPUT_REJECTED", False), (503, "PROVIDER_UNAVAILABLE", True)],
)
def test_sdk_errors_keep_safe_status_without_provider_messages(
    status, expected, retryable
):
    from google.genai.errors import APIError

    failure = safe_error(
        APIError(
            status,
            {
                "error": {
                    "message": "SECRET-MARKER private prompt",
                    "status": "INVALID_ARGUMENT",
                }
            },
        )
    )
    assert failure.code == expected and failure.retryable == retryable
    assert failure.details["http_status"] == status
    assert "SECRET-MARKER" not in str(failure.details) + failure.message


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


def test_tex_citation_spacing_is_normalized_without_accepting_invented_sources():
    answer = r"120 - 90 = 30 [Fuente\ 7, Fuente\\ 6]."
    assert validate_citations(answer, {6, 7}) == {6, 7}
    assert canonicalize_citations(answer) == "120 - 90 = 30 [Fuente 7] [Fuente 6]."
    with pytest.raises(ProviderError):
        validate_citations(r"Dato [Fuente\ 99].", {6, 7})
    with pytest.raises(ProviderError):
        validate_citations(r"Dato [Fuente\unknown 7].", {7})


def test_openai_compatible_contract_does_not_assume_vision(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "LLAMACPP_MODE", "unknown")

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
