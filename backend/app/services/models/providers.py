"""Real provider adapters. No document transfer in discovery, no model downloads."""

import base64
import json
import math
import time
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
from google import genai
from google.genai import types

from app.core.config import settings
from app.services.models.contracts import (
    EmbeddingInput,
    InferenceRequest,
    ModelCapabilities,
    ModelDescriptor,
    ProviderConfig,
    ProviderError,
    TokenUsage,
)
from app.services.models.media_capabilities import audio_input_capability


def validate_endpoint(url: str) -> str:
    parts = urlsplit(url)
    if (
        parts.scheme not in {"http", "https"}
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
    ):
        raise ProviderError("INVALID_ENDPOINT", "Endpoint de proveedor inválido.")
    if parts.hostname not in settings.PROVIDER_ALLOWED_HOSTS:
        raise ProviderError(
            "ENDPOINT_DENIED", "Host fuera de la lista autorizada del servidor."
        )
    if parts.scheme == "http" and parts.hostname not in {
        "localhost",
        "127.0.0.1",
        "host.docker.internal",
    }:
        raise ProviderError("ENDPOINT_DENIED", "Un proveedor remoto requiere HTTPS.")
    return url.rstrip("/")


def normalized_vectors(
    vectors: list[list[float]], count: int, dimensions: int
) -> list[list[float]]:
    if len(vectors) != count:
        raise ProviderError(
            "EMBEDDING_CARDINALITY", "El proveedor no devolvió un vector por entrada."
        )
    result = []
    for vector in vectors:
        if len(vector) != dimensions or not all(math.isfinite(x) for x in vector):
            raise ProviderError(
                "EMBEDDING_DIMENSIONS", "Dimensiones o valores incompatibles."
            )
        norm = math.sqrt(sum(x * x for x in vector))
        if norm == 0:
            raise ProviderError(
                "EMBEDDING_ZERO", "El proveedor devolvió un vector vacío."
            )
        result.append([x / norm for x in vector])
    return result


def retrieval_inputs(model: str, texts: list[str], *, query: bool) -> list[str]:
    if model.lower().startswith("embeddinggemma"):
        prefix = "task: search result | query: " if query else "title: none | text: "
        return [prefix + value for value in texts]
    return texts


def safe_error(error: Exception) -> ProviderError:
    if isinstance(error, ProviderError):
        return error
    code = getattr(error, "code", None)
    # Only fixed metadata crosses the trace boundary, never SDK messages,
    # request URLs, credentials, document contents or exception arguments.
    details = {"exception": type(error).__name__}
    if isinstance(error, httpx.HTTPStatusError):
        code = error.response.status_code
        if code == 500:
            try:
                detail = str(error.response.json().get("error", "")).lower()
            except ValueError, AttributeError:
                detail = ""
            if any(
                message in detail
                for message in (
                    "requires more system memory",
                    "not enough memory",
                    "out of memory",
                )
            ):
                return ProviderError(
                    "INSUFFICIENT_MEMORY",
                    "El modelo local necesita más memoria disponible. Elige un modelo instalado más pequeño o libera memoria.",
                )
    if isinstance(code, int):
        details["http_status"] = code
    if code in {400, 413, 422}:
        return ProviderError(
            "PROVIDER_INPUT_REJECTED",
            "El proveedor rechazó el contenido o tamaño de la solicitud. Revisa los detalles de la ejecución.",
            details=details,
        )
    if code in {500, 502, 503, 504}:
        return ProviderError(
            "PROVIDER_UNAVAILABLE",
            "El proveedor no pudo atender la solicitud. Reintenta la consulta.",
            True,
            details=details,
        )
    if code == 429:
        return ProviderError(
            "QUOTA_EXCEEDED",
            "Cuota del proveedor agotada. Reintenta más tarde.",
            True,
            details=details,
        )
    if code in {401, 403}:
        return ProviderError(
            "AUTH_REJECTED",
            "El proveedor rechazó las credenciales o permisos.",
            details=details,
        )
    if isinstance(error, httpx.TimeoutException):
        return ProviderError(
            "PROVIDER_TIMEOUT",
            "El proveedor excedió el tiempo de espera.",
            True,
            details=details,
        )
    return ProviderError(
        "PROVIDER_UNAVAILABLE",
        "No se pudo completar la operación con el proveedor.",
        True,
        details=details,
    )


class BaseProvider:
    name: str
    endpoint: str | None = None
    is_cloud = False
    configured = True
    last_usage: TokenUsage | None = None
    last_finish_reason: str | None = None
    response_mode: str = "stream"
    transport_attempts: int | None = None

    def discover(self) -> list[ModelDescriptor]:
        raise NotImplementedError

    def health(self) -> ProviderConfig:
        config = ProviderConfig(
            name=self.name,
            endpoint=self.endpoint,
            is_cloud=self.is_cloud,
            status="NOT_CONFIGURED",
            checked_at=datetime.now(UTC).isoformat(),
        )
        if not self.configured:
            return config
        try:
            config.models = self.discover()
            config.status = "AVAILABLE" if config.models else "NO_MODELS"
        except Exception as error:
            config.status = "UNAVAILABLE"
            config.error_code = safe_error(error).code
        return config


class GeminiProvider(BaseProvider):
    name = "gemini"
    endpoint = "https://generativelanguage.googleapis.com"
    is_cloud = True

    def __init__(self, timeout: int | None = None):
        self.key = settings.GEMINI_API_KEY or settings.GOOGLE_API_KEY
        self.configured = bool(self.key)
        self.timeout = timeout or settings.PROVIDER_TIMEOUT_SECONDS

    def client(self) -> genai.Client:
        if not self.key:
            raise ProviderError(
                "NOT_CONFIGURED", "Configura la clave Gemini en el servidor."
            )
        return genai.Client(
            api_key=self.key,
            http_options=types.HttpOptions(timeout=self.timeout * 1000),
        )

    def discover(self) -> list[ModelDescriptor]:
        with self.client() as client:
            models = []
            for model in client.models.list():
                actions = model.supported_actions or []
                identifier = (model.name or "").removeprefix("models/")
                # The shared action does not imply textual chat support. Google's
                # documented TTS/music families require an audio workload, which
                # this textual generateContent adapter does not implement.
                audio_workload = (
                    "-tts" in identifier.lower()
                    or identifier.lower().startswith("lyria")
                )
                if not any(
                    action in actions for action in ("generateContent", "embedContent")
                ):
                    continue
                models.append(
                    ModelDescriptor(
                        id=identifier,
                        provider=self.name,
                        version=model.version or model.name or "unknown",
                        capabilities=ModelCapabilities(
                            text="declared"
                            if "generateContent" in actions and not audio_workload
                            else "unsupported",
                            embeddings="declared"
                            if "embedContent" in actions
                            else "unsupported",
                            streaming="declared"
                            if "generateContent" in actions and not audio_workload
                            else "unsupported",
                            vision="unsupported"
                            if audio_workload
                            else "declared"
                            if "embedding-2" in identifier
                            else "unknown",
                            audio="unsupported"
                            if audio_workload
                            else "declared"
                            if "embedding-2" in identifier
                            else audio_input_capability(identifier),
                            video="declared"
                            if "embedding-2" in identifier
                            else "unsupported"
                            if audio_workload
                            else "unknown",
                            context_window=model.input_token_limit,
                        ),
                    )
                )
            return models

    def embed(
        self,
        model: str,
        texts: list[str],
        dimensions: int,
        *,
        query: bool = False,
        before_send: Callable[[], None] | None = None,
    ) -> list[list[float]]:
        vectors = []
        try:
            with self.client() as client:
                for text in texts:
                    if before_send:
                        before_send()
                    # Embedding 2 aggregates multimodal parts: one call per chunk
                    # deliberately guarantees independent vectors and cardinality.
                    config = types.EmbedContentConfig(output_dimensionality=dimensions)
                    if "embedding-2" in model:
                        text = (
                            f"task: search result | query: {text}"
                            if query
                            else f"title: none | text: {text}"
                        )
                    else:
                        config.task_type = (
                            "RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT"
                        )
                    response = client.models.embed_content(
                        model=model, contents=text, config=config
                    )
                    values = [
                        list(item.values or []) for item in response.embeddings or []
                    ]
                    vectors.extend(normalized_vectors(values, 1, dimensions))
            return normalized_vectors(vectors, len(texts), dimensions)
        except Exception as error:
            raise safe_error(error) from None

    def stream(self, request: InferenceRequest) -> Iterator[str]:
        self.last_usage = None
        self.last_finish_reason = None
        self.response_mode = "buffered_native" if request.media else "stream"
        self.transport_attempts = 0
        started = time.monotonic()
        try:
            with self.client() as client:
                config = types.GenerateContentConfig(
                    system_instruction=request.system,
                    max_output_tokens=request.max_tokens,
                    temperature=0.1,
                )
                if request.model.startswith("gemini-2.5-flash"):
                    config.thinking_config = types.ThinkingConfig(thinking_budget=0)
                if request.json_schema:
                    config.response_mime_type = "application/json"
                    config.response_json_schema = request.json_schema
                contents = [types.Part.from_text(text=request.prompt)]
                contents.extend(
                    types.Part.from_bytes(data=data, mime_type="image/png")
                    for data in request.images
                )
                contents.extend(
                    types.Part.from_bytes(data=item.data, mime_type=item.mime_type)
                    for item in request.media
                )
                arguments: dict[str, Any] = {
                    "model": request.model,
                    "contents": types.Content(role="user", parts=contents),
                    "config": config,
                }
                # Native media responses can lose their HTTP stream while the
                # provider processes several clips. A regular response retains
                # the same model, bytes and citations without replaying a request.
                if request.media:
                    # The SDK retries HTTP error statuses but not a socket reset
                    # during response reading. Retry once before any text is sent,
                    # within the selected timeout and with exactly the same input.
                    for attempt in range(2):
                        self.transport_attempts = attempt + 1
                        config.http_options = types.HttpOptions(
                            timeout=max(
                                1,
                                int(
                                    (self.timeout - (time.monotonic() - started)) * 1000
                                ),
                            )
                        )
                        try:
                            chunks = [client.models.generate_content(**arguments)]
                            break
                        except httpx.ReadError, httpx.RemoteProtocolError:
                            if attempt or time.monotonic() - started >= self.timeout:
                                raise
                else:
                    self.transport_attempts = 1
                    chunks = client.models.generate_content_stream(**arguments)
                for chunk in chunks:
                    if chunk.usage_metadata:
                        self.last_usage = TokenUsage(
                            input_tokens=chunk.usage_metadata.prompt_token_count or 0,
                            output_tokens=chunk.usage_metadata.candidates_token_count
                            or 0,
                        )
                    if chunk.text:
                        yield chunk.text
        except Exception as error:
            raise safe_error(error) from None

    def embed_multimodal(
        self,
        model: str,
        inputs: list[EmbeddingInput],
        dimensions: int,
        *,
        before_send: Callable[[], None] | None = None,
    ) -> list[list[float]]:
        if "embedding-2" not in model:
            raise ProviderError(
                "MULTIMODAL_UNSUPPORTED", "Este perfil requiere Gemini Embedding 2."
            )
        result = []
        try:
            with self.client() as client:
                for item in inputs:
                    if before_send:
                        before_send()
                    parts = (
                        [types.Part.from_text(text=f"title: none | text: {item.text}")]
                        if item.text
                        else []
                    )
                    if item.image:
                        parts.append(
                            types.Part.from_bytes(
                                data=item.image, mime_type="image/png"
                            )
                        )
                    if item.media:
                        parts.append(
                            types.Part.from_bytes(
                                data=item.media.data, mime_type=item.media.mime_type
                            )
                        )
                    response = client.models.embed_content(
                        model=model,
                        contents=types.Content(role="user", parts=parts),
                        config=types.EmbedContentConfig(
                            output_dimensionality=dimensions
                        ),
                    )
                    result.extend(
                        normalized_vectors(
                            [
                                list(value.values or [])
                                for value in response.embeddings or []
                            ],
                            1,
                            dimensions,
                        )
                    )
            return normalized_vectors(result, len(inputs), dimensions)
        except Exception as error:
            raise safe_error(error) from None


class HttpProvider(BaseProvider):
    def __init__(self, endpoint: str | None, timeout: int | None = None):
        self.configured = bool(endpoint)
        self.endpoint = validate_endpoint(endpoint) if endpoint else None
        self.is_cloud = bool(
            endpoint
            and urlsplit(endpoint).hostname
            not in {"localhost", "127.0.0.1", "host.docker.internal"}
        )
        self.timeout = timeout or settings.PROVIDER_TIMEOUT_SECONDS

    def client(self) -> httpx.Client:
        if not self.endpoint:
            raise ProviderError(
                "NOT_CONFIGURED", "Configura el endpoint en el servidor."
            )
        return httpx.Client(
            base_url=self.endpoint + "/", timeout=self.timeout, follow_redirects=False
        )


class OllamaProvider(HttpProvider):
    name = "ollama"

    def __init__(self, timeout: int | None = None):
        super().__init__(settings.OLLAMA_BASE_URL, timeout)

    def discover(self) -> list[ModelDescriptor]:
        with self.client() as client:
            response = client.get("api/tags")
            response.raise_for_status()
            result = []
            for model in response.json().get("models", [])[:50]:
                detail = client.post("api/show", json={"model": model["name"]})
                detail.raise_for_status()
                capabilities = detail.json().get("capabilities", [])
                result.append(
                    ModelDescriptor(
                        id=model["name"],
                        provider=self.name,
                        version=model["digest"],
                        capabilities=ModelCapabilities(
                            text="declared"
                            if "completion" in capabilities
                            else "unsupported",
                            embeddings="declared"
                            if "embedding" in capabilities
                            else "unsupported",
                            vision="declared"
                            if "vision" in capabilities
                            else "unsupported",
                            streaming="declared"
                            if "completion" in capabilities
                            else "unsupported",
                            context_window=detail.json()
                            .get("model_info", {})
                            .get(
                                f"{model.get('details', {}).get('family', '')}.context_length"
                            ),
                            embedding_dimensions=detail.json()
                            .get("model_info", {})
                            .get(
                                f"{model.get('details', {}).get('family', '')}.embedding_length"
                            )
                            if "embedding" in capabilities
                            else None,
                        ),
                    )
                )
            return result

    def embed(
        self, model: str, texts: list[str], dimensions: int, *, query: bool = False
    ) -> list[list[float]]:
        try:
            with self.client() as client:
                response = client.post(
                    "api/embed",
                    json={
                        "model": model,
                        "input": retrieval_inputs(model, texts, query=query),
                        "truncate": False,
                        "keep_alive": "0s",
                        "options": {
                            "num_thread": settings.OLLAMA_NUM_THREADS,
                            "num_gpu": settings.OLLAMA_NUM_GPU,
                        },
                    },
                )
                response.raise_for_status()
                return normalized_vectors(
                    response.json().get("embeddings", []), len(texts), dimensions
                )
        except Exception as error:
            raise safe_error(error) from None

    def stream(self, request: InferenceRequest) -> Iterator[str]:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": request.system},
            {"role": "user", "content": request.prompt},
        ]
        if request.images:
            messages[-1]["images"] = [
                base64.b64encode(data).decode() for data in request.images
            ]  # type: ignore[assignment]
        try:
            with (
                self.client() as client,
                client.stream(
                    "POST",
                    "api/chat",
                    json={
                        "model": request.model,
                        "messages": messages,
                        "stream": True,
                        "keep_alive": "0s",
                        "think": False,
                        **(
                            {"format": request.json_schema}
                            if request.json_schema
                            else {}
                        ),
                        "options": {
                            "num_predict": request.max_tokens,
                            "temperature": 0,
                            "num_ctx": settings.OLLAMA_NUM_CTX,
                            "num_thread": settings.OLLAMA_NUM_THREADS,
                            "num_gpu": settings.OLLAMA_NUM_GPU,
                        },
                    },
                ) as response,
            ):
                response.raise_for_status()
                for line in response.iter_lines():
                    if line:
                        value = json.loads(line)
                        if value.get("done"):
                            self.last_finish_reason = value.get("done_reason")
                            self.last_usage = (
                                TokenUsage(
                                    input_tokens=value.get("prompt_eval_count", 0),
                                    output_tokens=value.get("eval_count", 0),
                                )
                                if "prompt_eval_count" in value
                                and "eval_count" in value
                                else None
                            )
                        if value.get("error"):
                            raise ProviderError(
                                "GENERATION_FAILED",
                                "Ollama no pudo generar la respuesta.",
                            )
                        if value.get("message", {}).get("content"):
                            yield value["message"]["content"]
        except Exception as error:
            raise safe_error(error) from None


class NativeEmbeddingProvider(HttpProvider):
    name = "embeddinggemma"

    def stream(self, request: InferenceRequest) -> Iterator[str]:
        raise ProviderError(
            "CHAT_UNSUPPORTED",
            "EmbeddingGemma crea embeddings; selecciona un modelo generativo para chat.",
        )

    def __init__(self, timeout: int | None = None):
        super().__init__(settings.EMBEDDINGGEMMA_BASE_URL, timeout or 300)
        if self.is_cloud:
            raise ProviderError(
                "LOCAL_ENDPOINT_REQUIRED",
                "EmbeddingGemma nativo requiere un endpoint local.",
            )

    def discover(self) -> list[ModelDescriptor]:
        try:
            return self._discover()
        except Exception as error:
            raise safe_error(error) from None

    def _discover(self) -> list[ModelDescriptor]:
        with self.client() as client:
            response = client.get("v1/models")
            response.raise_for_status()
            return [
                ModelDescriptor(
                    id=item["id"],
                    provider=self.name,
                    version=item["version"],
                    capabilities=ModelCapabilities(
                        text="unsupported",
                        streaming="unsupported",
                        embeddings="declared",
                        vision="declared",
                        audio="declared",
                        video="declared",
                        embedding_dimensions=768,
                        context_window=8192,
                    ),
                )
                for item in response.json()["data"]
            ]

    def embed(
        self, model: str, texts: list[str], dimensions: int, *, query: bool = False
    ) -> list[list[float]]:
        return self.embed_multimodal(
            model,
            [EmbeddingInput(text=value) for value in texts],
            dimensions,
            query=query,
        )

    def embed_multimodal(
        self,
        model: str,
        inputs: list[EmbeddingInput],
        dimensions: int,
        *,
        query: bool = False,
        before_send: Callable[[], None] | None = None,
    ) -> list[list[float]]:
        if before_send:
            before_send()
        values = [
            {
                "text": item.text,
                "image": base64.b64encode(item.image).decode() if item.image else None,
                "media": base64.b64encode(item.media.data).decode()
                if item.media
                else None,
                "mime_type": item.media.mime_type if item.media else None,
            }
            for item in inputs
        ]
        try:
            with self.client() as client:
                response = client.post(
                    "embed",
                    json={
                        "model": model,
                        "inputs": values,
                        "dimensions": dimensions,
                        "query": query,
                    },
                )
                response.raise_for_status()
                return normalized_vectors(
                    response.json()["embeddings"], len(inputs), dimensions
                )
        except Exception as error:
            raise safe_error(error) from None


class OpenAICompatibleProvider(HttpProvider):
    name = "openai-compatible"

    def __init__(self, name: str = "openai-compatible", timeout: int | None = None):
        self.name = name
        endpoint = (
            settings.LLAMACPP_BASE_URL
            if name == "llamacpp"
            else settings.OPENAI_COMPATIBLE_BASE_URL
        )
        super().__init__(endpoint, timeout)

    def client(self) -> httpx.Client:
        client = super().client()
        if self.name == "openai-compatible" and settings.OPENAI_COMPATIBLE_API_KEY:
            client.headers["Authorization"] = (
                f"Bearer {settings.OPENAI_COMPATIBLE_API_KEY}"
            )
        return client

    def discover(self) -> list[ModelDescriptor]:
        with self.client() as client:
            response = client.get("v1/models")
            response.raise_for_status()
            return [
                ModelDescriptor(
                    id=model["id"],
                    provider=self.name,
                    version=settings.LLAMACPP_MODEL_VERSION or model["id"]
                    if self.name == "llamacpp"
                    else model["id"],
                    capabilities=ModelCapabilities(
                        text="unsupported",
                        streaming="unsupported",
                        vision="unsupported",
                        embeddings="declared",
                        embedding_dimensions=settings.LLAMACPP_EMBEDDING_DIMENSIONS,
                        context_window=model.get("meta", {}).get("n_ctx"),
                    )
                    if self.name == "llamacpp"
                    and settings.LLAMACPP_MODE == "embeddings"
                    else ModelCapabilities(),
                )
                for model in response.json().get("data", [])
            ]

    def embed(
        self, model: str, texts: list[str], dimensions: int, *, query: bool = False
    ) -> list[list[float]]:
        try:
            with self.client() as client:
                response = client.post(
                    "v1/embeddings",
                    json={
                        "model": model,
                        "input": retrieval_inputs(model, texts, query=query),
                    },
                )
                response.raise_for_status()
                values = sorted(
                    response.json().get("data", []), key=lambda value: value["index"]
                )
                if [value["index"] for value in values] != list(range(len(texts))):
                    raise ProviderError(
                        "EMBEDDING_CARDINALITY", "Índices de embeddings incompatibles."
                    )
                return normalized_vectors(
                    [value["embedding"] for value in values], len(texts), dimensions
                )
        except Exception as error:
            raise safe_error(error) from None

    def stream(self, request: InferenceRequest) -> Iterator[str]:
        content: str | list[dict] = request.prompt
        if request.images:
            content = [{"type": "text", "text": request.prompt}] + [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,"
                        + base64.b64encode(data).decode()
                    },
                }
                for data in request.images
            ]
        try:
            with (
                self.client() as client,
                client.stream(
                    "POST",
                    "v1/chat/completions",
                    json={
                        "model": request.model,
                        "messages": [
                            {"role": "system", "content": request.system},
                            {"role": "user", "content": content},
                        ],
                        "stream": True,
                        "max_tokens": request.max_tokens,
                    },
                ) as response,
            ):
                response.raise_for_status()
                for line in response.iter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        value = json.loads(line[6:])
                        if value.get("usage"):
                            self.last_usage = TokenUsage(
                                input_tokens=value["usage"].get("prompt_tokens", 0),
                                output_tokens=value["usage"].get(
                                    "completion_tokens", 0
                                ),
                            )
                        for choice in value.get("choices", []):
                            token = choice.get("delta", {}).get("content")
                            if token:
                                yield token
        except Exception as error:
            raise safe_error(error) from None


def get_provider(
    name: str, timeout: int | None = None
) -> (
    GeminiProvider | OllamaProvider | OpenAICompatibleProvider | NativeEmbeddingProvider
):
    if name == "gemini":
        return GeminiProvider(timeout)
    if name == "ollama":
        return OllamaProvider(timeout)
    if name == "embeddinggemma":
        return NativeEmbeddingProvider(timeout)
    if name in {"llamacpp", "openai-compatible"}:
        return OpenAICompatibleProvider(name, timeout)
    raise ProviderError("UNKNOWN_PROVIDER", "Proveedor desconocido.")
