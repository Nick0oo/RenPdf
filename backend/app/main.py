from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy import update
from sqlmodel import Session, col
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.core.config import settings
from app.core.db import engine
from app.core.logging import configure_logging
from app.domain import ChatMessage
from app.services.models.contracts import ProviderError

FRONTEND_DIR = Path(__file__).parent / "frontend"
configure_logging()


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


@asynccontextmanager
async def lifespan(_application: FastAPI):
    # One API process is configured. A fresh process cannot own an old stream.
    with Session(engine) as session:
        session.connection().execute(
            update(ChatMessage)
            .where(col(ChatMessage.state) == "GENERATING")
            .values(
                state="INTERRUPTED",
                content="La generación se interrumpió al reiniciar. Puedes volver a preguntar.",
            )
        )
        session.commit()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_HOST],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.exception_handler(ProviderError)
async def provider_error_handler(
    _request: Request, error: ProviderError
) -> JSONResponse:
    return JSONResponse(
        status_code=409 if error.code == "CONSENT_REQUIRED" else 503,
        content={"detail": error.message, "code": error.code},
    )


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    return response


app.frontend("/", directory=FRONTEND_DIR)
