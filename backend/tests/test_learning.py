"""Research persistence and real source references, exclusively in the _test DB."""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pymupdf
import pytest
from sqlmodel import Session

from app.core.db import engine
from app.domain import (
    ChatMessage,
    Chunk,
    ChunkProvenance,
    Citation,
    Conversation,
    Document,
    DocumentElement,
    DocumentPage,
    DocumentVersion,
    Workspace,
    WorkspaceDocument,
)
from app.learning_domain import StudyCard, StudyReview

PREFIX = "/api/v1/learning"


@pytest.fixture
def sources(client, superuser_token_headers):
    owner = uuid.UUID(
        client.get("/api/v1/users/me", headers=superuser_token_headers).json()["id"]
    )
    with Session(engine) as session:
        space = Workspace(owner_id=owner, name="Learning synthetic sources")
        session.add(space)
        session.commit()
        identifiers, message_ids = [], []
        conversation = Conversation(
            workspace_id=space.id, title="Synthetic cited messages"
        )
        session.add(conversation)
        session.commit()
        for filename in ("digital_es.pdf", "english_conflict.pdf"):
            raw = (Path(__file__).parent / "fixtures" / filename).read_bytes()
            with pymupdf.open(stream=raw, filetype="pdf") as pdf:
                text = pdf[0].get_text()
                count = pdf.page_count
            document = Document(
                owner_id=owner,
                title=filename,
                original_filename=filename,
                sha256=hashlib.sha256(raw + uuid.uuid4().bytes).hexdigest(),
                storage_key=f"test-learning/{uuid.uuid4()}",
                file_size=len(raw),
                page_count=count,
                status="EXTRACTED",
            )
            session.add(document)
            session.commit()
            version = DocumentVersion(document_id=document.id, status="COMPLETE")
            session.add(version)
            session.commit()
            document.current_version_id = version.id
            page = DocumentPage(
                version_id=version.id, page_number=1, width=595, height=842
            )
            session.add_all(
                [
                    document,
                    page,
                    WorkspaceDocument(workspace_id=space.id, document_id=document.id),
                ]
            )
            session.commit()
            element = DocumentElement(
                page_id=page.id,
                text=text,
                bbox={"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.5},
                content_hash=hashlib.sha256(text.encode()).hexdigest(),
            )
            chunk = Chunk(
                version_id=version.id,
                text=text,
                contextualized_text=text,
                content_hash=element.content_hash,
            )
            session.add_all([element, chunk])
            session.commit()
            message = ChatMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=f"Synthetic test reference only: {text[:80]} [Fuente 1].",
                state="COMPLETE",
            )
            session.add_all(
                [
                    message,
                    ChunkProvenance(
                        chunk_id=chunk.id, element_id=element.id, span_end=len(text)
                    ),
                ]
            )
            session.commit()
            session.add(
                Citation(
                    message_id=message.id,
                    chunk_id=chunk.id,
                    element_id=element.id,
                    quote=text,
                    label=1,
                )
            )
            session.commit()
            identifiers.append(str(document.id))
            message_ids.append(str(message.id))
        result = {
            "workspace_id": str(space.id),
            "document_ids": identifiers,
            "source_message_ids": message_ids,
            "conversation_id": str(conversation.id),
        }
    yield result
    with Session(engine) as session:
        space = session.get(Workspace, uuid.UUID(result["workspace_id"]))
        if space:
            session.delete(space)
        for value in identifiers:
            row = session.get(Document, uuid.UUID(value))
            if row:
                session.delete(row)
        session.commit()


def deck(client, headers, sources):
    response = client.post(
        f"{PREFIX}/decks",
        headers=headers,
        json={
            "workspace_id": sources["workspace_id"],
            "name": "Energy facts",
            "description": "Synthetic source study",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_saved_research_keeps_two_real_sources_and_edits_question(
    client, superuser_token_headers, sources
):
    body = {
        **{
            key: sources[key]
            for key in ("workspace_id", "document_ids", "source_message_ids")
        },
        "kind": "comparison",
        "title": "Energy comparison",
        "question": "Solar capacity",
        "notes": "Different source values",
    }
    response = client.post(
        f"{PREFIX}/research", headers=superuser_token_headers, json=body
    )
    assert response.status_code == 200, response.text
    comparison = response.json()
    assert {
        answer["citations"][0]["document_id"] for answer in comparison["answers"]
    } == set(sources["document_ids"])
    assert "120" in comparison["answers"][0]["citations"][0]["text"]
    assert all(answer["available"] for answer in comparison["answers"])
    loaded = client.get(
        f"{PREFIX}/research?workspace_id={sources['workspace_id']}",
        headers=superuser_token_headers,
    ).json()
    assert loaded[0] == comparison
    pending = client.post(
        f"{PREFIX}/research",
        headers=superuser_token_headers,
        json={
            "workspace_id": sources["workspace_id"],
            "kind": "question",
            "title": "Pending question",
            "question": "Which value?",
        },
    ).json()
    assert not pending["answers"]
    answered = client.patch(
        f"{PREFIX}/research/{pending['id']}",
        headers=superuser_token_headers,
        json={
            "workspace_id": sources["workspace_id"],
            "kind": "question",
            "title": "Answered question",
            "question": "Which value?",
            "source_message_ids": [sources["source_message_ids"][0]],
        },
    )
    assert answered.status_code == 200
    assert len(answered.json()["answers"]) == 1


def test_research_rejects_uncited_failed_and_single_source_comparison(
    client, superuser_token_headers, sources
):
    common = {
        "workspace_id": sources["workspace_id"],
        "kind": "summary",
        "title": "No invented evidence",
    }
    assert (
        client.post(
            f"{PREFIX}/research", headers=superuser_token_headers, json=common
        ).status_code
        == 422
    )
    with Session(engine) as session:
        message = ChatMessage(
            conversation_id=uuid.UUID(sources["conversation_id"]),
            role="assistant",
            content="Uncited",
            state="COMPLETE",
        )
        session.add(message)
        session.commit()
        identifier = str(message.id)
    assert (
        client.post(
            f"{PREFIX}/research",
            headers=superuser_token_headers,
            json={**common, "source_message_ids": [identifier]},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"{PREFIX}/research",
            headers=superuser_token_headers,
            json={
                **common,
                "kind": "comparison",
                "source_message_ids": [sources["source_message_ids"][0]],
            },
        ).status_code
        == 422
    )


def test_manual_and_cited_cards_bind_valid_pages_and_source_deletion_is_honest(
    client, superuser_token_headers, sources
):
    created_deck = deck(client, superuser_token_headers, sources)
    body = {
        "deck_id": created_deck["id"],
        "question": "How much solar?",
        "answer": "120 MWh",
        "document_id": sources["document_ids"][0],
        "page_number": 1,
    }
    manual = client.post(f"{PREFIX}/cards", headers=superuser_token_headers, json=body)
    assert manual.status_code == 200, manual.text
    assert manual.json()["source_available"] and manual.json()["evidence"] is None
    assert (
        client.post(
            f"{PREFIX}/cards",
            headers=superuser_token_headers,
            json={**body, "page_number": 999},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{PREFIX}/cards",
            headers=superuser_token_headers,
            json={
                "deck_id": created_deck["id"],
                "question": "Unlinked",
                "answer": "Unlinked",
            },
        ).status_code
        == 422
    )
    cited = client.post(
        f"{PREFIX}/cards",
        headers=superuser_token_headers,
        json={
            "deck_id": created_deck["id"],
            "question": "Evidence card",
            "answer": "Solar 120",
            "source_message_id": sources["source_message_ids"][0],
            "citation_label": 1,
        },
    )
    assert cited.status_code == 200, cited.text
    assert cited.json()["document_id"] == sources["document_ids"][0]
    assert "120" in cited.json()["evidence"]["text"]
    assert (
        client.post(
            f"{PREFIX}/cards",
            headers=superuser_token_headers,
            json={
                "deck_id": created_deck["id"],
                "question": "Wrong citation",
                "answer": "Solar",
                "source_message_id": sources["source_message_ids"][0],
                "citation_label": 12,
            },
        ).status_code
        == 422
    )
    with Session(engine) as session:
        session.delete(session.get(Document, uuid.UUID(sources["document_ids"][0])))
        session.commit()
    remaining = client.get(
        f"{PREFIX}/decks/{created_deck['id']}/cards", headers=superuser_token_headers
    ).json()
    assert len(remaining) == 2
    assert all(
        not item["source_available"] and item["evidence"] is None for item in remaining
    )
    assert {item["answer"] for item in remaining} == {"120 MWh", "Solar 120"}


def test_review_persists_self_assessment_schedule_and_deck_delete_cascades(
    client, superuser_token_headers, sources
):
    created_deck = deck(client, superuser_token_headers, sources)
    card = client.post(
        f"{PREFIX}/cards",
        headers=superuser_token_headers,
        json={
            "deck_id": created_deck["id"],
            "question": "How much?",
            "answer": "120",
            "document_id": sources["document_ids"][0],
        },
    ).json()
    review = client.post(
        f"{PREFIX}/cards/{card['id']}/reviews",
        headers=superuser_token_headers,
        json={"rating": "good", "response": "120 MWh"},
    )
    assert review.status_code == 200, review.text
    next_due = datetime.fromisoformat(review.json()["next_due_at"])
    assert (
        timedelta(days=2, hours=23)
        < next_due - datetime.now(UTC)
        < timedelta(days=3, minutes=1)
    )
    progress = client.get(
        f"{PREFIX}/decks/{created_deck['id']}/progress", headers=superuser_token_headers
    ).json()
    assert progress == {
        "cards": 1,
        "due_cards": 0,
        "reviewed_cards": 1,
        "reviews": 1,
        "ratings": {"again": 0, "hard": 0, "good": 1, "easy": 0},
        "assessment": "self_reported",
    }
    history = client.get(
        f"{PREFIX}/decks/{created_deck['id']}/reviews", headers=superuser_token_headers
    ).json()
    assert history[0]["response"] == "120 MWh"
    assert (
        client.post(
            f"{PREFIX}/cards/{card['id']}/reviews",
            headers=superuser_token_headers,
            json={"rating": "automatic_ai_pass"},
        ).status_code
        == 422
    )
    assert (
        client.delete(
            f"{PREFIX}/decks/{created_deck['id']}", headers=superuser_token_headers
        ).status_code
        == 200
    )
    with Session(engine) as session:
        assert session.get(StudyCard, uuid.UUID(card["id"])) is None
        assert session.get(StudyReview, uuid.UUID(review.json()["id"])) is None


def test_other_owner_cannot_read_or_modify_research_deck_card_review(
    client, superuser_token_headers, normal_user_token_headers, sources
):
    created_deck = deck(client, superuser_token_headers, sources)
    card = client.post(
        f"{PREFIX}/cards",
        headers=superuser_token_headers,
        json={
            "deck_id": created_deck["id"],
            "question": "Private card",
            "answer": "120",
            "document_id": sources["document_ids"][0],
        },
    ).json()
    research = client.post(
        f"{PREFIX}/research",
        headers=superuser_token_headers,
        json={
            "workspace_id": sources["workspace_id"],
            "kind": "question",
            "title": "Private question",
            "question": "Private?",
        },
    ).json()
    for suffix in (
        f"/decks/{created_deck['id']}/cards",
        f"/decks/{created_deck['id']}/progress",
        f"/decks/{created_deck['id']}/reviews",
        f"/research?workspace_id={sources['workspace_id']}",
    ):
        assert (
            client.get(
                f"{PREFIX}{suffix}", headers=normal_user_token_headers
            ).status_code
            == 404
        )
    assert client.get(f"{PREFIX}/decks", headers=normal_user_token_headers).json() == []
    assert (
        client.get(f"{PREFIX}/research", headers=normal_user_token_headers).json() == []
    )
    assert (
        client.delete(
            f"{PREFIX}/research/{research['id']}", headers=normal_user_token_headers
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"{PREFIX}/cards/{card['id']}", headers=normal_user_token_headers
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{PREFIX}/cards/{card['id']}/reviews",
            headers=normal_user_token_headers,
            json={"rating": "easy"},
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"{PREFIX}/research",
            headers=normal_user_token_headers,
            json={
                "workspace_id": sources["workspace_id"],
                "kind": "summary",
                "title": "Wrong owner",
                "source_message_ids": sources["source_message_ids"],
            },
        ).status_code
        == 404
    )


def test_cross_workspace_sources_cannot_be_attached(
    client, superuser_token_headers, sources
):
    other = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Isolated workspace"},
    ).json()
    try:
        assert (
            client.post(
                f"{PREFIX}/research",
                headers=superuser_token_headers,
                json={
                    "workspace_id": other["id"],
                    "kind": "summary",
                    "title": "Wrong workspace",
                    "source_message_ids": sources["source_message_ids"],
                },
            ).status_code
            == 404
        )
        created_deck = deck(
            client, superuser_token_headers, {"workspace_id": other["id"]}
        )
        assert (
            client.post(
                f"{PREFIX}/cards",
                headers=superuser_token_headers,
                json={
                    "deck_id": created_deck["id"],
                    "question": "Wrong workspace",
                    "answer": "120",
                    "document_id": sources["document_ids"][0],
                },
            ).status_code
            == 404
        )
    finally:
        client.delete(
            f"/api/v1/workspaces/{other['id']}", headers=superuser_token_headers
        )
