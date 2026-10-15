from fastapi import APIRouter

from app.api.routes import (
    chat,
    documents,
    items,
    learning,
    login,
    providers,
    studio,
    trace,
    users,
    utils,
    workspaces,
)

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(documents.router)
api_router.include_router(workspaces.router)
api_router.include_router(providers.router)
api_router.include_router(chat.router)
api_router.include_router(studio.router)
api_router.include_router(trace.router)
api_router.include_router(learning.router)


# The template's unauthenticated test-only user bootstrap is intentionally disabled.
