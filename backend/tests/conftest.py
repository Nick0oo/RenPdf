import os

# ruff: noqa: E402 -- set the isolated test environment before importing app settings.
from collections.abc import Generator
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy.engine import make_url

# Never run the template's cleanup fixture against a personal database.
local = dotenv_values(Path(__file__).resolve().parents[2] / ".env")
test_url = os.environ.get("TEST_DATABASE_URL") or str(
    make_url(local["DATABASE_URL"]).set(database="renpdf_chat_test")
)
if not make_url(test_url).database.endswith("_test"):
    raise RuntimeError("Tests require a dedicated database ending in _test")
# render_as_string is required: str(URL) masks the password.
if not os.environ.get("TEST_DATABASE_URL"):
    test_url = (
        make_url(local["DATABASE_URL"])
        .set(database="renpdf_chat_test")
        .render_as_string(hide_password=False)
    )
os.environ["DATABASE_URL"] = test_url
# Ordinary suites must never dispatch hundreds of real local model requests.
# Automatic-index tests enable this explicitly and replace the embedding adapter.
os.environ["AUTO_INDEX_LOCAL"] = "false"
os.environ["STORAGE_ROOT"] = str(
    Path(__file__).resolve().parents[2] / "tmp" / "test-storage"
)

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import Item, User
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session]:
    from alembic import command
    from alembic.config import Config

    command.upgrade(Config("alembic.ini"), "head")
    with Session(engine) as session:
        init_db(session)
        yield session
        statement = delete(Item)
        session.execute(statement)
        statement = delete(User)
        session.execute(statement)
        session.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
