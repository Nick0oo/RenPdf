"""Automatic image context is bounded, sourced and opt-in through real MM indexes."""

import hashlib
import io
import json
import uuid
from pathlib import Path

import pymupdf
import pytest
from PIL import Image
from sqlmodel import Session, col, select

from app.core.db import engine
from app.domain import (
    Chunk,
    ChunkEmbedding,
    ChunkProvenance,
    Conversation,
    Document,
    DocumentElement,
    DocumentIndex,
    DocumentPage,
    DocumentVersion,
    EmbeddingProfile,
    Workspace,
    WorkspaceDocument,
)
from app.schemas.research import EvidencePublic
from app.services.models.contracts import ModelCapabilities, ModelDescriptor, TokenUsage
from app.services.parsing.geometry import normalize_bbox
from app.services.rag.visual_context import (
    MAX_IMAGE_BYTES,
    MAX_IMAGE_SIDE,
    render_visual_context,
    visual_context_candidates,
)
from app.services.storage.local import LocalStorage

FIXTURE = Path(__file__).parent / "fixtures" / "digital_es.pdf"


@pytest.fixture
def visual_document(client, superuser_token_headers, monkeypatch):
    monkeypatch.setattr("app.api.routes.documents.enqueue", lambda _job: None)
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={
            "file": (
                "visual-context.pdf",
                FIXTURE.read_bytes()
                + f"\n% visual-context-test-{uuid.uuid4()}".encode(),
                "application/pdf",
            )
        },
    )
    assert response.status_code == 200, response.text
    identifier = uuid.UUID(response.json()["id"])
    with Session(engine) as session:
        document = session.get(Document, identifier)
        with pymupdf.open(LocalStorage().path(document.storage_key)) as pdf:
            original = pdf[1]
            original.set_rotation(0)
            block = next(
                block
                for block in original.get_text("dict")["blocks"]
                if block["type"] == 1
            )
            width, height = original.rect.width, original.rect.height
            bbox = normalize_bbox(list(block["bbox"]), width, height)
            digest = hashlib.sha256(block["image"]).hexdigest()
        version = DocumentVersion(
            document_id=document.id, parser_name="fixture", status="EXTRACTED"
        )
        session.add(version)
        session.flush()
        page = DocumentPage(
            version_id=version.id, page_number=2, width=width, height=height
        )
        session.add(page)
        session.flush()
        source_rows = []
        for label in range(1, 4):
            element = DocumentElement(
                page_id=page.id,
                element_type="figure",
                text="",
                bbox=bbox,
                content_hash=digest,
            )
            session.add(element)
            session.flush()
            chunk = Chunk(
                version_id=version.id,
                text="Región visual aún no interpretada",
                contextualized_text="Región visual aún no interpretada",
                content_hash=digest,
                chunking_profile="visual-region-v1",
            )
            session.add(chunk)
            session.flush()
            session.add(
                ChunkProvenance(
                    chunk_id=chunk.id, element_id=element.id, span_end=len(chunk.text)
                )
            )
            source_rows.append((element, chunk, label))
        profile = EmbeddingProfile(
            provider="gemini",
            model="mechanics-only",
            model_version="fixture-v1",
            dimensions=768,
            modality="multimodal",
            fingerprint=str(uuid.uuid4()),
        )
        session.add(profile)
        session.flush()
        index = DocumentIndex(
            version_id=version.id, profile_id=profile.id, status="READY"
        )
        session.add(index)
        session.flush()
        for _element, chunk, _label in source_rows:
            session.add(
                ChunkEmbedding(
                    chunk_id=chunk.id, index_id=index.id, embedding=[1.0] + [0.0] * 767
                )
            )
        document.current_version_id = version.id
        document.active_index_id = index.id
        document.status = "READY"
        session.add(document)
        session.commit()
        sources = [
            EvidencePublic(
                chunk_id=chunk.id,
                element_id=element.id,
                document_id=document.id,
                version_id=version.id,
                document_title=document.title,
                page_number=2,
                text=chunk.text,
                bbox=bbox,
                rotation=0,
                label=label,
            )
            for element, chunk, label in source_rows
        ]
        diagnostics = {
            "used_profiles": [
                {
                    "profile_id": str(profile.id),
                    "provider": profile.provider,
                    "model": profile.model,
                    "modality": "multimodal",
                    "index_ids": [str(index.id)],
                }
            ]
        }
        owner_id = document.owner_id
    yield identifier, owner_id, sources, diagnostics
    with Session(engine) as session:
        document = session.get(Document, identifier)
        if document:
            key = document.storage_key
            session.delete(document)
            session.commit()
            LocalStorage().delete(key)
        profile = session.get(
            EmbeddingProfile, uuid.UUID(diagnostics["used_profiles"][0]["profile_id"])
        )
        if profile:
            session.delete(profile)
            session.commit()


def candidates(session, fixture, **kwargs):
    identifier, owner_id, sources, diagnostics = fixture
    return visual_context_candidates(
        session, sources, [identifier], diagnostics, owner_id=owner_id, **kwargs
    )


def test_only_real_retrieved_mm_figures_are_selected_and_bounded(visual_document):
    identifier, owner_id, sources, diagnostics = visual_document
    with Session(engine) as session:
        selected = visual_context_candidates(
            session,
            [sources[0], sources[0], sources[1], sources[2]],
            [identifier],
            diagnostics,
            owner_id=owner_id,
            limit=99,
        )
        assert len(selected) == 2
        assert [region.source.label for region in selected] == [1, 2]
        assert candidates(session, visual_document, limit=0) == []
        assert selected[0].source.chunk_id == sources[0].chunk_id


def test_text_profiles_and_foreign_scope_never_attach_page_logos(visual_document):
    identifier, owner_id, sources, diagnostics = visual_document
    with Session(engine) as session:
        text = {
            "used_profiles": [{**diagnostics["used_profiles"][0], "modality": "text"}]
        }
        assert (
            visual_context_candidates(
                session, sources, [identifier], text, owner_id=owner_id
            )
            == []
        )
        assert (
            visual_context_candidates(
                session, sources, [], diagnostics, owner_id=owner_id
            )
            == []
        )
        assert (
            visual_context_candidates(
                session, sources, [identifier], diagnostics, owner_id=uuid.uuid4()
            )
            == []
        )
        wrong_index = {
            "used_profiles": [
                {**diagnostics["used_profiles"][0], "index_ids": [str(uuid.uuid4())]}
            ]
        }
        assert (
            visual_context_candidates(
                session, sources, [identifier], wrong_index, owner_id=owner_id
            )
            == []
        )
        wrong_profile = {
            "used_profiles": [
                {**diagnostics["used_profiles"][0], "profile_id": str(uuid.uuid4())}
            ]
        }
        assert (
            visual_context_candidates(
                session, sources, [identifier], wrong_profile, owner_id=owner_id
            )
            == []
        )


def test_stale_versions_and_unindexed_regions_are_not_sent(visual_document):
    identifier, _owner_id, sources, _diagnostics = visual_document
    with Session(engine) as session:
        document = session.get(Document, identifier)
        current = document.current_version_id
        document.current_version_id = uuid.uuid4()
        session.add(document)
        session.flush()
        assert candidates(session, visual_document) == []
        document.current_version_id = current
        index = session.get(DocumentIndex, document.active_index_id)
        index.status = "BUILDING"
        session.add(index)
        session.flush()
        assert candidates(session, visual_document) == []
        index.status = "READY"
        for source in sources:
            session.delete(session.get(ChunkEmbedding, (source.chunk_id, index.id)))
        session.flush()
        assert candidates(session, visual_document) == []
        session.rollback()


def test_triangle_png_is_real_bounded_and_does_not_change_index(visual_document):
    identifier, _owner_id, _sources, _diagnostics = visual_document
    with Session(engine) as session:
        document = session.get(Document, identifier)
        index_id = document.active_index_id
        before = len(
            session.exec(
                select(Chunk).where(
                    col(Chunk.version_id) == document.current_version_id
                )
            ).all()
        )
        regions = candidates(session, visual_document)
        images, metadata = render_visual_context(regions)
        assert len(images) == len(metadata) == 2
        for image, record in zip(images, metadata, strict=True):
            assert image.startswith(b"\x89PNG") and len(image) <= MAX_IMAGE_BYTES
            assert record["region_sha256"] == hashlib.sha256(image).hexdigest()
            assert record["page_number"] == 2
            with Image.open(io.BytesIO(image)) as rendered:
                assert max(rendered.size) <= MAX_IMAGE_SIDE
                pixels = list(rendered.get_flattened_data())
                assert any(
                    green > red + 20 and green > blue + 10
                    for red, green, blue in pixels
                )
        session.refresh(document)
        assert document.active_index_id == index_id
        assert (
            len(
                session.exec(
                    select(Chunk).where(
                        col(Chunk.version_id) == document.current_version_id
                    )
                ).all()
            )
            == before
        )


def test_regular_text_evidence_never_turns_into_an_image(visual_document):
    identifier, owner_id, sources, diagnostics = visual_document
    with Session(engine) as session:
        element = session.get(DocumentElement, sources[0].element_id)
        element.element_type = "text"
        element.text = "Figura A: triángulo verde."
        session.add(element)
        session.flush()
        result = visual_context_candidates(
            session, [sources[0]], [identifier], diagnostics, owner_id=owner_id
        )
        assert result == []
        session.rollback()


@pytest.mark.parametrize("vision_allowed", [False, True])
def test_chat_uses_retrieved_figure_automatically_and_checks_vision_before_render(
    visual_document, client, superuser_token_headers, monkeypatch, vision_allowed
):
    identifier, owner_id, sources, diagnostics = visual_document
    model = "controlled-vision-contract"
    captured, rendered = [], []

    class ControlledProvider:
        is_cloud = True
        last_usage = TokenUsage(input_tokens=15, output_tokens=8)
        last_finish_reason = "stop"

        def discover(self):
            return [
                ModelDescriptor(
                    id=model,
                    provider="gemini",
                    version="fixture-v1",
                    capabilities=ModelCapabilities(
                        text="declared", vision="declared", context_window=4096
                    ),
                )
            ]

        def stream(self, request):
            captured.append(request)
            assert len(request.images) == 1 and request.images[0].startswith(b"\x89PNG")
            context = json.loads(request.prompt)
            assert context["images"] == [{"image": 1, "source_id": 1}]
            yield "El triángulo es verde. [Fuente 1]"

    provider = ControlledProvider()
    monkeypatch.setattr("app.services.rag.chat.get_provider", lambda *_args: provider)
    monkeypatch.setattr(
        "app.services.privacy.consent.get_provider", lambda *_args: provider
    )

    def retrieval(_session, _ids, _question, **kwargs):
        kwargs["diagnostics"].update(diagnostics)
        return [sources[0].model_copy()], "hybrid"

    monkeypatch.setattr("app.services.rag.chat.retrieve", retrieval)

    def renderer(regions):
        rendered.append(regions)
        return render_visual_context(regions)

    monkeypatch.setattr(
        "app.services.rag.visual_context.render_visual_context", renderer
    )
    with Session(engine) as session:
        workspace = Workspace(
            owner_id=owner_id, name="Automatic visual context contract"
        )
        session.add(workspace)
        session.flush()
        session.add(
            WorkspaceDocument(workspace_id=workspace.id, document_id=identifier)
        )
        conversation = Conversation(
            workspace_id=workspace.id, provider="gemini", model=model
        )
        session.add(conversation)
        session.commit()
        workspace_id, conversation_id = str(workspace.id), str(conversation.id)
    try:
        for scope in ["chat"] + (["vision"] if vision_allowed else []):
            response = client.post(
                f"/api/v1/documents/{identifier}/consents",
                headers=superuser_token_headers,
                json={"provider": "gemini", "scope": scope, "expires_in_days": 1},
            )
            assert response.status_code == 200
        response = client.post(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=superuser_token_headers,
            json={
                "question": "¿Qué muestra la figura recuperada?",
                "document_ids": [str(identifier)],
            },
        )
        rows = client.get(
            f"/api/v1/conversations/{conversation_id}/messages",
            headers=superuser_token_headers,
        ).json()
        answer = rows[-1]
        if vision_allowed:
            assert "event: done" in response.text, response.text
            assert len(captured) == len(rendered) == 1
            assert answer["state"] == "COMPLETE"
            assert answer["provider"] == "gemini" and answer["model"] == model
            assert answer["citations"][0]["element_id"] == str(sources[0].element_id)
            trace = answer["usage"]["trace"]
            assert trace["vision"]["selection"] == "retrieved_multimodal"
            assert trace["vision"]["image_count"] == 1
            assert trace["vision"]["regions"][0]["source_label"] == 1
            assert trace["inference_attempted"] and trace["consent_verified"]
        else:
            assert "CONSENT_REQUIRED" in response.text
            assert not captured and not rendered
            assert answer["state"] == "FAILED"
            assert answer["usage"]["trace"]["error_code"] == "CONSENT_REQUIRED"
    finally:
        client.delete(
            f"/api/v1/workspaces/{workspace_id}", headers=superuser_token_headers
        )
