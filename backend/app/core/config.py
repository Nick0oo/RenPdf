import warnings
from pathlib import Path
from typing import Literal, Self

from pydantic import (
    AliasChoices,
    EmailStr,
    Field,
    HttpUrl,
    PostgresDsn,
    computed_field,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file=Path(__file__).resolve().parents[3] / ".env",
        env_ignore_empty=True,
        extra="ignore",
        hide_input_in_errors=True,
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = Field(repr=False)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    FRONTEND_HOST: str = "http://localhost:5173"
    FASTAPI_ENV: Literal["development"] | None = None

    PROJECT_NAME: str = "RenPdf"
    SENTRY_DSN: HttpUrl | None = None
    DATABASE_URL: PostgresDsn = Field(repr=False)
    REDIS_URL: str = "redis://127.0.0.1:6380/0"
    STORAGE_ROOT: Path = Path(__file__).resolve().parents[3] / "storage"
    GEMINI_API_KEY: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"),
        repr=False,
    )
    GOOGLE_API_KEY: str | None = Field(default=None, repr=False)
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_NUM_CTX: int = Field(default=4096, ge=512, le=32768)
    OLLAMA_NUM_THREADS: int = Field(default=2, ge=1, le=16)
    OLLAMA_NUM_GPU: int = Field(default=0, ge=-1)
    LLAMACPP_BASE_URL: str | None = None
    LLAMACPP_MODE: Literal["unknown", "chat", "embeddings"] = "unknown"
    LLAMACPP_MODEL_VERSION: str | None = None
    LLAMACPP_EMBEDDING_DIMENSIONS: int = Field(default=768, ge=1, le=2000)
    OPENAI_COMPATIBLE_BASE_URL: str | None = None
    OPENAI_COMPATIBLE_API_KEY: str | None = Field(default=None, repr=False)
    PROVIDER_ALLOWED_HOSTS: list[str] = [
        "localhost",
        "127.0.0.1",
        "host.docker.internal",
        "generativelanguage.googleapis.com",
    ]
    DEFAULT_CHAT_PROVIDER: str = "gemini"
    DEFAULT_CHAT_MODEL: str = ""
    DEFAULT_EMBEDDING_PROVIDER: str = "gemini"
    DEFAULT_EMBEDDING_MODEL: str = "gemini-embedding-2"
    EMBEDDING_DIMENSIONS: int = 768
    MAX_UPLOAD_SIZE_MB: int = 50
    MAX_DOCUMENT_PAGES: int = 500
    MAX_CONCURRENT_DOCUMENT_JOBS: int = 1
    ENABLE_OCR: bool = True
    ENABLE_VISION: bool = False
    DOCLING_ARTIFACTS_PATH: Path | None = None
    DOCLING_TOKENIZER_PATH: Path | None = None
    PARSER_ENGINE: Literal["auto", "pymupdf", "docling", "docling-native"] = "auto"
    OCR_LANGUAGE: str = "eng+spa"
    RENDER_DPI: int = 110
    PARSER_PAGE_TIMEOUT_SECONDS: int = 90
    PARSER_MEMORY_LIMIT_MB: int = 1536
    PARSER_RECYCLE_PAGES: int = Field(default=8, ge=1, le=32)
    PROVIDER_TIMEOUT_SECONDS: int = 90
    MAX_CONTEXT_CHARS: int = 24000
    MAX_ANSWER_TOKENS: int = 2048
    CLOUD_PROCESSING_DEFAULT_DENY: bool = True
    COOKIE_SECURE: bool = False
    ALLOW_PUBLIC_SIGNUP: bool = False

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _use_psycopg_driver(cls, value: str | PostgresDsn) -> str:
        database_url = str(value)
        for scheme in ("postgres://", "postgresql://"):
            if database_url.startswith(scheme):
                return database_url.replace(scheme, "postgresql+psycopg://", 1)
        return database_url

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)

    EMAIL_TEST_USER: EmailStr = "test@example.com"
    FIRST_SUPERUSER: EmailStr
    FIRST_SUPERUSER_PASSWORD: str = Field(repr=False)

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.FASTAPI_ENV == "development":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        for host in self.DATABASE_URL.hosts():
            self._check_default_secret("DATABASE_URL password", host["password"])
        self._check_default_secret(
            "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
        )

        return self


settings = Settings()  # type: ignore # ty: ignore[unused-ignore-comment]
