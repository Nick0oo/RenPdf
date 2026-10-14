from fastapi import APIRouter

from app.api.routes import (
    chat,
    documents,
    items,
    login,
    providers,
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


# The template's unauthenticated test-only user bootstrap is intentionally disabled.
