"""Real RAG/persistence boundaries with a controlled model, no cloud transfer."""
# ruff: noqa: F811 -- shared source fixture is registered by pytest.

import json
import uuid

import pytest
from sqlmodel import Session, col, select

from app.core.db import engine
from app.domain import ChatMessage, Document, DocumentElement, DocumentPage
from app.learning_domain import ResearchEntry, StudyDeck
from app.services.models.contracts import (
    ModelCapabilities,
    ModelDescriptor,
    ProviderError,
)
from tests.test_learning import PREFIX, sources  # noqa: F401


class StudyModel:
    is_cloud = False

    def __init__(self, invalid=None):
        self.requests = []
        self.invalid = invalid

    def discover(self):
        return [
            ModelDescriptor(
                id="study-test",
                provider="ollama",
                version="v1",
                capabilities=ModelCapabilities(
                    text="declared", structured_output="declared"
                ),
            )
        ]

    def stream(self, request):
        self.requests.append(request)
        context = json.loads(request.prompt)
        evidence = context["evidence"]
        assert len({source["document"] for source in evidence}) == 2
        if not request.json_schema:
            yield "## Ideas para repasar\n\n" + "\n\n".join(
                f"{source['text'].strip()} [Fuente {source['source_id']}]"
                for source in evidence
            )
            return
        count = request.json_schema["properties"]["items"]["minItems"]
        items = [
            {
                "question": f"¿Qué dato energético permite revisar el concepto {index + 1}?",
                "answer": evidence[index % len(evidence)]["text"].strip(),
                "source_ids": [evidence[index % len(evidence)]["source_id"]],
            }
            for index in range(count)
        ]
        if self.invalid == "source":
            items[0]["source_ids"] = [999]
        elif self.invalid == "duplicate":
            items[1]["question"] = items[0]["question"]
        elif self.invalid == "count":
            items.pop()
        elif self.invalid == "marker":
            items[0]["answer"] += " [Fuente 999]"
        elif self.invalid == "transport":
            raise ProviderError("PROVIDER_UNAVAILABLE", "Synthetic provider failure")
        yield json.dumps({"title": "Conceptos de energía", "items": items})


def setup_model(monkeypatch, invalid=None):
    model = StudyModel(invalid)
    monkeypatch.setattr("app.services.rag.chat.get_provider", lambda *_args: model)
    return model


def body(sources, kind="questions", **kwargs):
    return {
        "workspace_id": sources["workspace_id"],
        "document_ids": sources["document_ids"],
        "kind": kind,
        "provider": "ollama",
        "model": "study-test",
        "count": 3,
        **kwargs,
    }


def test_ai_summary_questions_and_deck_persist_with_inspectable_sources(
    client, superuser_token_headers, sources, monkeypatch
):
    model = setup_model(monkeypatch)
    summary = client.post(
        f"{PREFIX}/generate",
        headers=superuser_token_headers,
        json=body(sources, "summary"),
    )
    assert summary.status_code == 200, summary.text
    report = summary.json()
    assert len(report["research"]) == 1 and report["deck"] is None
    entry = report["research"][0]
    assert entry["kind"] == "summary" and entry["answers"][0]["citations"]
    assert entry["answers"][0]["usage"]["trace"]["learning"]["storage_state"] == "saved"
    assert model.requests[-1].json_schema is None

    generated = client.post(
        f"{PREFIX}/generate", headers=superuser_token_headers, json=body(sources)
    )
    assert generated.status_code == 200, generated.text
    result = generated.json()
    assert result["deck"]["cards"] == len(result["cards"]) == 3
    assert len(result["research"]) == 1 and result["research"][0]["kind"] == "question"
    assert {card["document_id"] for card in result["cards"]} == set(
        sources["document_ids"]
    )
    assert all(
        card["source_message_id"] == result["message_id"] and card["evidences"]
        for card in result["cards"]
    )
    assert all(
        card["evidence"]["version_id"] == card["version_id"] for card in result["cards"]
    )
    trace = client.get(
        f"/api/v1/trace/responses/{result['message_id']}/context",
        headers=superuser_token_headers,
    )
    assert trace.status_code == 200 and len(trace.json()["sources"]) >= 2
    usage = result["research"][0]["answers"][0]["usage"]["trace"]
    assert usage["learning"]["generated_items"] == 3
    assert usage["learning"]["deck_id"] == result["deck"]["id"]
    assert usage["prompt_template_version"] == "learning-rag-v1"

    added = client.post(
        f"{PREFIX}/generate",
        headers=superuser_token_headers,
        json=body(sources, "deck", deck_id=result["deck"]["id"]),
    )
    assert added.status_code == 200, added.text
    assert added.json()["deck"]["cards"] == 6 and added.json()["research"] == []
    persisted = client.get(
        f"{PREFIX}/decks/{result['deck']['id']}/cards", headers=superuser_token_headers
    ).json()
    assert len(persisted) == 6
    reviewed = client.post(
        f"{PREFIX}/cards/{persisted[0]['id']}/reviews",
        headers=superuser_token_headers,
        json={"rating": "good", "response": "Mi respuesta"},
    )
    assert reviewed.status_code == 200
    progress = client.get(
        f"{PREFIX}/decks/{result['deck']['id']}/progress",
        headers=superuser_token_headers,
    ).json()
    assert progress["reviews"] == 1 and progress["assessment"] == "self_reported"


@pytest.mark.parametrize(
    "invalid", ["source", "duplicate", "count", "marker", "transport"]
)
def test_bad_model_output_creates_no_partial_deck_or_research(
    client, superuser_token_headers, sources, monkeypatch, invalid
):
    setup_model(monkeypatch, invalid)
    response = client.post(
        f"{PREFIX}/generate", headers=superuser_token_headers, json=body(sources)
    )
    assert response.status_code == (503 if invalid == "transport" else 422), (
        response.text
    )
    with Session(engine) as session:
        assert not session.exec(
            select(StudyDeck).where(
                col(StudyDeck.workspace_id) == uuid.UUID(sources["workspace_id"])
            )
        ).all()
        assert not session.exec(
            select(ResearchEntry).where(
                col(ResearchEntry.workspace_id) == uuid.UUID(sources["workspace_id"])
            )
        ).all()
        latest = session.exec(
            select(ChatMessage)
            .where(
                col(ChatMessage.role) == "assistant",
                col(ChatMessage.model) == "study-test",
            )
            .order_by(col(ChatMessage.created_at).desc())
        ).first()
        assert latest.state == "FAILED"
        assert latest.usage["trace"]["learning"]["kind"] == "questions"


def test_generation_enforces_owner_workspace_and_cloud_consent(
    client, superuser_token_headers, normal_user_token_headers, sources, monkeypatch
):
    model = setup_model(monkeypatch)
    assert (
        client.post(
            f"{PREFIX}/generate", headers=normal_user_token_headers, json=body(sources)
        ).status_code
        == 404
    )
    outside = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Other workspace"},
    ).json()
    try:
        assert (
            client.post(
                f"{PREFIX}/generate",
                headers=superuser_token_headers,
                json=body(sources, workspace_id=outside["id"]),
            ).status_code
            == 404
        )
        deck = client.post(
            f"{PREFIX}/decks",
            headers=superuser_token_headers,
            json={"workspace_id": outside["id"], "name": "Other deck"},
        ).json()
        assert (
            client.post(
                f"{PREFIX}/generate",
                headers=superuser_token_headers,
                json=body(sources, deck_id=deck["id"]),
            ).status_code
            == 422
        )
        denied = client.post(
            f"{PREFIX}/generate",
            headers=superuser_token_headers,
            json=body(sources, provider="gemini", model="gemini-test"),
        )
        assert denied.status_code == 409 and denied.json()["code"] == "CONSENT_REQUIRED"
        assert not model.requests
        with Session(engine) as session:
            document = session.get(Document, uuid.UUID(sources["document_ids"][0]))
            document.current_version_id = None
            session.add(document)
            session.commit()
        assert (
            client.post(
                f"{PREFIX}/generate",
                headers=superuser_token_headers,
                json=body(sources),
            ).status_code
            == 409
        )
    finally:
        client.delete(
            f"/api/v1/workspaces/{outside['id']}", headers=superuser_token_headers
        )


@pytest.mark.parametrize("source_type", ["audio", "spreadsheet"])
def test_generated_cards_keep_temporal_and_cell_locations(
    client, superuser_token_headers, sources, monkeypatch, source_type
):
    setup_model(monkeypatch)
    with Session(engine) as session:
        document = session.get(Document, uuid.UUID(sources["document_ids"][0]))
        document.source_type = source_type
        document.duration_seconds = 20 if source_type == "audio" else None
        page = session.exec(
            select(DocumentPage).where(
                col(DocumentPage.version_id) == document.current_version_id
            )
        ).one()
        page.unit_kind = "segment" if source_type == "audio" else "sheet"
        element = session.exec(
            select(DocumentElement).where(col(DocumentElement.page_id) == page.id)
        ).one()
        if source_type == "audio":
            element.start_seconds, element.end_seconds = 10, 20
        else:
            element.sheet_name, element.cell_range = "Energía", "B2"
        session.add_all([document, page, element])
        session.commit()
    response = client.post(
        f"{PREFIX}/generate",
        headers=superuser_token_headers,
        json=body(sources, "deck"),
    )
    assert response.status_code == 200, response.text
    card = next(
        card
        for card in response.json()["cards"]
        if card["document_id"] == sources["document_ids"][0]
    )
    assert card["evidence"]["page_number"] is None
    if source_type == "audio":
        assert (
            card["evidence"]["start_seconds"] == 10
            and card["evidence"]["end_seconds"] == 20
        )
    else:
        assert (
            card["evidence"]["sheet_name"] == "Energía"
            and card["evidence"]["cell_range"] == "B2"
        )
