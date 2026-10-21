import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx

from app.core.config import settings
from app.services.models.contracts import InferenceRequest
from app.services.models.providers import (
    GeminiProvider,
    OllamaProvider,
    OpenAICompatibleProvider,
    safe_error,
)


def test_gemini_audio_families_are_not_advertised_for_document_chat(monkeypatch):
    remote = MagicMock()
    remote.__enter__.return_value = remote
    remote.models.list.return_value = [
        SimpleNamespace(
            name=f"models/{name}",
            supported_actions=["generateContent"],
            version="v1",
            input_token_limit=1000,
        )
        for name in (
            "gemini-3.8-flash",
            "gemini-3.8-flash-tts",
            "gemini-3.1-flash-tts-preview",
            "lyria-3.5",
        )
    ]
    provider = GeminiProvider()
    monkeypatch.setattr(provider, "client", lambda: remote)
    models = provider.discover()
    assert len(models) == 4  # Catalog retained; task filtering uses capabilities.
    assert models[0].capabilities.text == "declared"
    assert all(
        model.capabilities.text == "unsupported"
        and model.capabilities.streaming == "unsupported"
        for model in models[1:]
    )


def client(handler):
    return httpx.Client(
        base_url="http://127.0.0.1:8081", transport=httpx.MockTransport(handler)
    )


def test_embeddinggemma_uses_distinct_query_document_prompts_in_both_runtimes(
    monkeypatch,
):
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append(body["input"])
        if request.url.path == "/api/embed":
            return httpx.Response(200, json={"embeddings": [[1, 2, 3]]})
        return httpx.Response(
            200, json={"data": [{"index": 0, "embedding": [1, 2, 3]}]}
        )

    for provider in (OllamaProvider(), OpenAICompatibleProvider("llamacpp")):
        monkeypatch.setattr(provider, "client", lambda: client(handler))
        provider.embed("embeddinggemma-2-q8_0", ["documento"], 3)
        provider.embed("embeddinggemma-2-q8_0", ["consulta"], 3, query=True)
    assert (
        seen
        == [
            ["title: none | text: documento"],
            ["task: search result | query: consulta"],
        ]
        * 2
    )


def test_ollama_cpu_limits_disable_thinking_and_pass_structured_output(monkeypatch):
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(
            200, content='{"message":{"content":"ok"}}\n{"done":true}\n'
        )

    provider = OllamaProvider()
    monkeypatch.setattr(provider, "client", lambda: client(handler))
    request = InferenceRequest(
        model="contract",
        system="reglas",
        prompt="entrada",
        json_schema={"type": "object"},
    )
    assert "".join(provider.stream(request)) == "ok"
    assert seen[0]["think"] is False
    assert seen[0]["keep_alive"] == "0s"
    assert seen[0]["options"]["temperature"] == 0
    assert seen[0]["options"]["num_ctx"] == settings.OLLAMA_NUM_CTX
    assert seen[0]["format"] == request.json_schema
    assert provider.last_usage is None  # Missing counters are not actual zero usage.


def test_embedding_only_llamacpp_is_not_advertised_as_chat(monkeypatch):
    monkeypatch.setattr(settings, "LLAMACPP_MODE", "embeddings")
    monkeypatch.setattr(settings, "LLAMACPP_MODEL_VERSION", "actual-model-hash")
    provider = OpenAICompatibleProvider("llamacpp")
    monkeypatch.setattr(
        provider,
        "client",
        lambda: client(
            lambda _request: httpx.Response(
                200, json={"data": [{"id": "embeddinggemma-2-q8_0"}]}
            )
        ),
    )
    descriptor = provider.discover()[0]
    assert descriptor.version == "actual-model-hash"
    assert descriptor.capabilities.text == "unsupported"
    assert descriptor.capabilities.embeddings == "declared"
    assert descriptor.capabilities.embedding_dimensions == 768


def test_local_memory_error_is_actionable_and_redacts_server_details():
    response = httpx.Response(
        500,
        json={"error": "model requires more system memory. PRIVATE-MARKER"},
        request=httpx.Request("POST", "http://localhost/api/chat"),
    )
    error = safe_error(
        httpx.HTTPStatusError(
            "PRIVATE-MARKER", request=response.request, response=response
        )
    )
    assert error.code == "INSUFFICIENT_MEMORY"
    assert "PRIVATE-MARKER" not in error.message
