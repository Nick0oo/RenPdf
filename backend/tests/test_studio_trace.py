"""Real local PDF transforms and owner boundaries, only in the isolated test DB."""

import hashlib
import uuid
from datetime import timedelta
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.db import engine
from app.domain import (
    ChatMessage,
    CloudConsent,
    Conversation,
    Document,
    Workspace,
    WorkspaceDocument,
    now,
)
from app.module_domain import StudioOperation
from app.services.storage.local import LocalStorage

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def local_sources(client: TestClient, superuser_token_headers, monkeypatch):
    monkeypatch.setattr("app.api.routes.documents.enqueue", lambda _job: None)
    monkeypatch.setattr("app.api.routes.studio.enqueue", lambda _job: None)
    owner_id = uuid.UUID(
        client.get("/api/v1/users/me", headers=superuser_token_headers).json()["id"]
    )
    with Session(engine) as session:
        before = set(
            session.exec(
                select(Document.id).where(col(Document.owner_id) == owner_id)
            ).all()
        )
    sources = []
    for filename in ("digital_es.pdf", "english_conflict.pdf", "crop_rotated.pdf"):
        response = client.post(
            "/api/v1/documents/",
            headers=superuser_token_headers,
            files={
                "file": (
                    filename,
                    (FIXTURES / filename).read_bytes()
                    + f"\n% studio-test-{uuid.uuid4()}".encode(),
                    "application/pdf",
                )
            },
        )
        assert response.status_code == 200, response.text
        sources.append(response.json())
    yield sources
    with Session(engine) as session:
        operations = session.exec(
            select(StudioOperation).where(col(StudioOperation.owner_id) == owner_id)
        ).all()
        for operation in operations:
            if operation.output_document_id not in before:
                session.delete(operation)
        for document in session.exec(
            select(Document).where(col(Document.owner_id) == owner_id)
        ).all():
            if document.id not in before:
                key = document.storage_key
                session.delete(document)
                LocalStorage().delete(key)
        session.commit()


def test_merge_order_originals_and_new_privacy(
    client, superuser_token_headers, local_sources
):
    spanish, english, _rotated = local_sources
    storage = LocalStorage()
    with Session(engine) as session:
        originals = [
            session.get(Document, uuid.UUID(item["id"])) for item in (english, spanish)
        ]
        original_hashes = [
            hashlib.sha256(storage.path(item.storage_key).read_bytes()).hexdigest()
            for item in originals
        ]
        original_keys = [item.storage_key for item in originals]
        session.add(
            CloudConsent(
                document_id=originals[0].id,
                owner_id=originals[0].owner_id,
                provider="gemini",
                scope="chat",
                expires_at=now() + timedelta(days=1),
            )
        )
        session.commit()
    result = client.post(
        "/api/v1/studio/operations",
        headers=superuser_token_headers,
        json={
            "kind": "merge",
            "output_name": "Combined research",
            "sources": [
                {"document_id": english["id"], "pages": [1]},
                {"document_id": spanish["id"], "pages": [1, 2]},
            ],
        },
    )
    assert result.status_code == 200, result.text
    data = result.json()
    assert data["document"]["page_count"] == 3
    assert data["document"]["title"] == "Combined research.pdf"
    assert data["job"]["kind"] == "extract"
    assert [item["document_id"] for item in data["operation"]["sources"]] == [
        english["id"],
        spanish["id"],
    ]
    copied = client.get(
        f"/api/v1/documents/{data['document']['id']}/file",
        headers=superuser_token_headers,
    )
    assert copied.status_code == 200
    with pymupdf.open(stream=copied.content, filetype="pdf") as pdf:
        assert "90 MWh" in pdf[0].get_text()
        assert "120" in pdf[1].get_text()
        assert "Producción por fuente" in pdf[2].get_text()
    with Session(engine) as session:
        assert (
            session.exec(
                select(CloudConsent).where(
                    col(CloudConsent.document_id) == uuid.UUID(data["document"]["id"])
                )
            ).first()
            is None
        )
        assert [
            hashlib.sha256(storage.path(key).read_bytes()).hexdigest()
            for key in original_keys
        ] == original_hashes
        assert (
            session.get(StudioOperation, uuid.UUID(data["operation"]["id"])) is not None
        )


def test_page_order_and_rotation_crop_are_real(
    client, superuser_token_headers, local_sources
):
    spanish, _english, rotated = local_sources
    response = client.post(
        "/api/v1/studio/operations",
        headers=superuser_token_headers,
        json={
            "kind": "pages",
            "output_name": "Reordered",
            "sources": [{"document_id": spanish["id"], "pages": [2, 1, 2]}],
        },
    )
    assert response.status_code == 200, response.text
    identifier = response.json()["document"]["id"]
    contents = client.get(
        f"/api/v1/documents/{identifier}/file", headers=superuser_token_headers
    ).content
    with pymupdf.open(stream=contents, filetype="pdf") as pdf:
        assert len(pdf) == 3
        assert "Producción por fuente" in pdf[0].get_text()
        assert "Proyecto Aurora" in pdf[1].get_text()
        assert pdf[0].get_text() == pdf[2].get_text()
    with Session(engine) as session:
        document = session.get(Document, uuid.UUID(rotated["id"]))
        with pymupdf.open(LocalStorage().path(document.storage_key)) as original:
            width, height = original[0].cropbox.width, original[0].cropbox.height
            original_rotation = original[0].rotation
    transformed = client.post(
        "/api/v1/studio/operations",
        headers=superuser_token_headers,
        json={
            "kind": "transform",
            "output_name": "Cropped rotated",
            "sources": [
                {
                    "document_id": rotated["id"],
                    "rotation": 90,
                    "crop": {"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.7},
                }
            ],
        },
    )
    assert transformed.status_code == 200, transformed.text
    data = client.get(
        f"/api/v1/documents/{transformed.json()['document']['id']}/file",
        headers=superuser_token_headers,
    ).content
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        assert pdf[0].rotation == (original_rotation + 90) % 360
        assert pdf[0].cropbox.width == pytest.approx(width * 0.8)
        assert pdf[0].cropbox.height == pytest.approx(height * 0.7)


def test_invalid_pages_and_limits_do_not_create_output(
    client, superuser_token_headers, local_sources
):
    spanish = local_sources[0]
    for source in (
        {"document_id": spanish["id"], "pages": [999]},
        {"document_id": spanish["id"], "pages": []},
        {
            "document_id": spanish["id"],
            "crop": {"x": 0.8, "y": 0, "width": 0.5, "height": 1},
        },
        {"document_id": spanish["id"], "rotation": 45},
    ):
        response = client.post(
            "/api/v1/studio/operations",
            headers=superuser_token_headers,
            json={"kind": "pages", "output_name": "Invalid", "sources": [source]},
        )
        assert response.status_code == 422
    too_many = client.post(
        "/api/v1/studio/operations",
        headers=superuser_token_headers,
        json={
            "kind": "merge",
            "output_name": "Too many",
            "sources": [
                {"document_id": spanish["id"], "pages": [1] * 300},
                {"document_id": spanish["id"], "pages": [1] * 300},
            ],
        },
    )
    assert too_many.status_code == 422
    assert "500" in too_many.text


def test_studio_preview_and_owner_boundaries(
    client, superuser_token_headers, normal_user_token_headers, local_sources
):
    identifier = local_sources[0]["id"]
    preview = client.get(
        f"/api/v1/studio/documents/{identifier}/pages/1/preview",
        headers=superuser_token_headers,
    )
    assert preview.status_code == 200 and preview.content.startswith(b"\x89PNG")
    assert preview.headers["cache-control"] == "private, no-store"
    for path in (
        f"/api/v1/studio/documents/{identifier}/pages/1/preview",
        f"/api/v1/trace/documents/{identifier}",
        f"/api/v1/trace/permissions?document_id={identifier}",
    ):
        assert client.get(path, headers=normal_user_token_headers).status_code == 404
    response = client.post(
        "/api/v1/studio/operations",
        headers=normal_user_token_headers,
        json={
            "kind": "pages",
            "output_name": "Foreign",
            "sources": [{"document_id": identifier}],
        },
    )
    assert response.status_code == 404


def test_trace_response_filter_and_metadata_redaction(
    client, superuser_token_headers, normal_user_token_headers, local_sources
):
    with Session(engine) as session:
        document = session.get(Document, uuid.UUID(local_sources[0]["id"]))
        workspace = Workspace(owner_id=document.owner_id, name="Trace research")
        session.add(workspace)
        session.flush()
        conversation = Conversation(
            workspace_id=workspace.id,
            title="Bounded investigation",
            provider="ollama",
            model="local",
        )
        session.add(conversation)
        session.flush()
        message = ChatMessage(
            conversation_id=conversation.id,
            role="assistant",
            content="Only the owner may read this answer",
            provider="ollama",
            model="local",
            retrieval_mode="lexical",
            usage={
                "input_tokens": 12,
                "output_tokens": 8,
                "api_key": "never-return",
                "prompt": "never-return",
            },
        )
        session.add(message)
        session.commit()
        identifier, workspace_id = str(message.id), str(workspace.id)
    try:
        activity = client.get(
            f"/api/v1/trace/activity?kind=chat&workspace_id={workspace_id}",
            headers=superuser_token_headers,
        )
        assert activity.status_code == 200, activity.text
        data = activity.json()
        assert data["total"] == 1 and data["data"][0]["id"] == identifier
        assert (
            "Only the owner" not in activity.text
            and "never-return" not in activity.text
        )
        assert data["data"][0]["usage"] == {"input_tokens": 12, "output_tokens": 8}
        details = client.get(
            f"/api/v1/trace/responses/{identifier}", headers=superuser_token_headers
        )
        assert details.status_code == 200
        assert details.json()["message"]["content"].startswith("Only the owner")
        assert "never-return" not in details.text
        assert (
            client.get(
                f"/api/v1/trace/responses/{identifier}",
                headers=normal_user_token_headers,
            ).status_code
            == 404
        )
        assert (
            client.get(
                f"/api/v1/trace/activity?workspace_id={workspace_id}",
                headers=normal_user_token_headers,
            ).status_code
            == 404
        )
    finally:
        with Session(engine) as session:
            session.delete(session.get(Workspace, uuid.UUID(workspace_id)))
            session.commit()


def test_derivative_workspace_and_durable_deleted_copy_lineage(
    client, superuser_token_headers, local_sources
):
    with Session(engine) as session:
        document = session.get(Document, uuid.UUID(local_sources[0]["id"]))
        workspace = Workspace(owner_id=document.owner_id, name="Studio research")
        session.add(workspace)
        session.commit()
        workspace_id = str(workspace.id)
    try:
        response = client.post(
            "/api/v1/studio/operations",
            headers=superuser_token_headers,
            json={
                "kind": "pages",
                "workspace_id": workspace_id,
                "output_name": "Workspace copy",
                "sources": [{"document_id": local_sources[0]["id"], "pages": [1]}],
            },
        )
        assert response.status_code == 200, response.text
        data = response.json()
        output_id = uuid.UUID(data["document"]["id"])
        operation_id = uuid.UUID(data["operation"]["id"])
        with Session(engine) as session:
            assert session.get(WorkspaceDocument, (uuid.UUID(workspace_id), output_id))
            session.delete(session.get(Document, output_id))
            session.commit()

            assert session.get(StudioOperation, operation_id).output_document_id is None
        history = client.get(
            f"/api/v1/trace/documents/{local_sources[0]['id']}",
            headers=superuser_token_headers,
        )
        assert history.status_code == 200, history.text
        assert any(
            item["id"] == str(operation_id) for item in history.json()["lineage"]
        )
        assert "storage_key" not in history.text
    finally:
        with Session(engine) as session:
            session.delete(session.get(Workspace, uuid.UUID(workspace_id)))
            session.commit()


def test_trace_permissions_states_and_overview(
    client, superuser_token_headers, local_sources
):
    with Session(engine) as session:
        document = session.get(Document, uuid.UUID(local_sources[0]["id"]))
        for scope, expires, revoked in (
            ("chat", now() + timedelta(days=1), None),
            ("vision", now() - timedelta(days=1), None),
            ("embeddings", now() + timedelta(days=1), now()),
        ):
            session.add(
                CloudConsent(
                    document_id=document.id,
                    owner_id=document.owner_id,
                    provider="gemini",
                    scope=scope,
                    expires_at=expires,
                    revoked_at=revoked,
                )
            )
        session.commit()
    response = client.get(
        f"/api/v1/trace/permissions?document_id={local_sources[0]['id']}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 200, response.text
    assert {item["state"] for item in response.json()["data"]} == {
        "ACTIVE",
        "REVOKED",
        "EXPIRED",
    }
    assert response.json()["default_policy"] == "DENY"
    overview = client.get("/api/v1/trace/overview", headers=superuser_token_headers)
    assert overview.status_code == 200, overview.text
    assert overview.json()["documents"] >= 3
    assert overview.json()["active_consents"] >= 1
