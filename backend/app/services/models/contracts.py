from collections.abc import Iterator
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field


class ModelCapabilities(BaseModel):
    text: Literal["declared", "verified", "unknown", "unsupported"] = "unknown"
    vision: Literal["declared", "verified", "unknown", "unsupported"] = "unknown"
    audio: Literal["declared", "verified", "unknown", "unsupported"] = "unknown"
    video: Literal["declared", "verified", "unknown", "unsupported"] = "unknown"
    embeddings: Literal["declared", "verified", "unknown", "unsupported"] = "unknown"
    streaming: Literal["declared", "verified", "unknown", "unsupported"] = "unknown"
    reranking: Literal["declared", "verified", "unknown", "unsupported"] = "unknown"
    structured_output: Literal["declared", "verified", "unknown", "unsupported"] = (
        "unknown"
    )
    context_window: int | None = None
    embedding_dimensions: int | None = None


class ModelDescriptor(BaseModel):
    id: str
    provider: str
    version: str
    capabilities: ModelCapabilities = Field(default_factory=ModelCapabilities)


class ProviderConfig(BaseModel):
    name: str
    endpoint: str | None
    is_cloud: bool
    status: str
    models: list[ModelDescriptor] = Field(default_factory=list)
    checked_at: str
    error_code: str | None = None


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0


class MediaInput(BaseModel):
    data: bytes
    mime_type: Literal["audio/wav", "audio/mpeg", "video/mp4"]


class InferenceRequest(BaseModel):
    model: str
    system: str
    prompt: str
    max_tokens: int = 2048
    images: list[bytes] = Field(default_factory=list)
    media: list[MediaInput] = Field(default_factory=list)
    json_schema: dict[str, Any] | None = None


class InferenceResponse(BaseModel):
    text: str
    usage: TokenUsage = Field(default_factory=TokenUsage)


class EmbeddingInput(BaseModel):
    text: str = ""
    image: bytes | None = None
    media: MediaInput | None = None


class ModelRoutingPolicy(BaseModel):
    provider: str
    model: str
    timeout_seconds: int = 90
    max_tokens: int = 2048
    retries: int = 0
    # No implicit fallbacks. An alternative requires a new explicit selection.
    alternatives: list[str] = Field(default_factory=list)


class ProviderError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        retryable: bool = False,
        *,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details or {}


class ChatProvider(Protocol):
    name: str
    is_cloud: bool

    def stream(self, request: InferenceRequest) -> Iterator[str]: ...


class EmbeddingProvider(Protocol):
    def embed(
        self, model: str, texts: list[str], dimensions: int, *, query: bool = False
    ) -> list[list[float]]: ...


class VisionProvider(ChatProvider, Protocol):
    pass


class RerankProvider(Protocol):
    def rerank(self, query: str, texts: list[str]) -> list[float]: ...


class ModelDiscoveryProvider(Protocol):
    def discover(self) -> list[ModelDescriptor]: ...


class ProviderHealthService(Protocol):
    def health(self) -> ProviderConfig: ...
