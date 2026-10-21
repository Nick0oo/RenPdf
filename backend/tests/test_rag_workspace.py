"""Real PDF regions, PostgreSQL retrieval and owner-scoped RAG inspection."""

import hashlib
import io
import json
import uuid

import pymupdf
import pytest
from PIL import Image, ImageDraw
from sqlmodel import Session, col, select

from app.core.db import engine
from app.domain import (
    Chunk,
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentPage,
    DocumentVersion,
    Job,
)
from app.services.models.contracts import ModelCapabilities, ModelDescriptor
from app.services.rag.retrieval import retrieve
from app.workers.tasks import process_job


@pytest.fixture
def visual_pdf(client, superuser_token_headers, monkeypatch):
    monkeypatch.setattr("app.api.routes.documents.enqueue", lambda _job: None)
    image = Image.new("RGB", (160, 160), "white")
    ImageDraw.Draw(image).polygon([(80, 10), (10, 150), (150, 150)], fill="green")
    data = io.BytesIO()
    image.save(data, format="PNG")
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((40, 50), "Research figure A: visual evidence")
        page.insert_image(pymupdf.Rect(60, 100, 220, 260), stream=data.getvalue())
        page = pdf.new_page()
        page.insert_text((40, 50), "Research figure B: visual evidence")
        page.draw_circle(pymupdf.Point(160, 180), 60, color=(1, 0, 0), fill=(1, 0, 0))
        payload = pdf.tobytes()
    document = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": (f"regions-{uuid.uuid4()}.pdf", payload, "application/pdf")},
    ).json()
    identifier = uuid.UUID(document["id"])
    with Session(engine) as session:
        job = session.exec(
            select(Job).where(col(Job.document_id) == identifier)
        ).first()
        process_job(str(job.id))
        session.expire_all()
        assert session.get(Job, job.id).state == "SUCCEEDED"
    yield document
    client.delete(f"/api/v1/documents/{identifier}", headers=superuser_token_headers)


def test_raster_and_vector_figures_get_chunks_without_cloud_calls(
    visual_pdf, client, superuser_token_headers
):
    coverage = client.get(
        f"/api/v1/documents/{visual_pdf['id']}/coverage",
        headers=superuser_token_headers,
    )
    assert coverage.status_code == 200
    result = coverage.json()
    assert result["pages_extracted"] == result["pages_total"] == 2
    assert result["figures_total"] == result["figures_with_chunks"] == 2
    assert result["figures_multimodal_indexed"] == 0
    assert result["visual_status"] == "REGIONS_QUERYABLE"
    chunks = client.get(
        f"/api/v1/trace/documents/{visual_pdf['id']}/chunks?page=2",
        headers=superuser_token_headers,
    ).json()
    assert any(item["kind"] == "figure" for item in chunks["data"])
    assert all(item["page_number"] == 2 for item in chunks["data"])
    with Session(engine) as session:
        sources, mode = retrieve(
            session,
            [uuid.UUID(visual_pdf["id"])],
            "¿Qué color tiene la figura de la página 2?",
        )
        figures = [
            item
            for item in sources
            if session.get(DocumentElement, item.element_id).element_type == "figure"
        ]
        assert figures and all(item.page_number == 2 for item in figures)
        assert mode.startswith("lexical")


def test_text_retrieval_passes_real_pixels_to_chat_and_preserves_inspectable_context(
    visual_pdf, client, superuser_token_headers, monkeypatch, normal_user_token_headers
):
    captured = []

    class VisionProvider:
        is_cloud = False

        def discover(self):
            return [
                ModelDescriptor(
                    id="test-vision",
                    provider="ollama",
                    version="test",
                    capabilities=ModelCapabilities(text="declared", vision="declared"),
                )
            ]

        def stream(self, request):
            captured.append(request)
            assert len(request.images) == 1
            with Image.open(io.BytesIO(request.images[0])) as image:
                assert any(
                    r > 200 and g < 80 and b < 80
                    for r, g, b in image.convert("RGB").get_flattened_data()
                )
            context = json.loads(request.prompt)
            source_id = context["images"][0]["source_id"]
            yield f"La figura es un círculo rojo. [Fuente {source_id}]"

    monkeypatch.setattr(
        "app.services.rag.chat.get_provider", lambda *_args: VisionProvider()
    )
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Visual workspace acceptance"},
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{visual_pdf['id']}",
        headers=superuser_token_headers,
    )
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "ollama", "model": "test-vision"},
    ).json()
    try:
        question = "¿Qué color y forma tiene la figura de la página 2?"
        response = client.post(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
            json={"question": question, "document_ids": [visual_pdf["id"]]},
        )
        assert "event: done" in response.text, response.text
        assert len(captured) == 1
        answer = client.get(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
        ).json()[-1]
        assert answer["state"] == "COMPLETE"
        assert answer["citations"][0]["page_number"] == 2
        trace = answer["usage"]["trace"]
        assert trace["vision"]["selection"] == "retrieved_regions"
        assert trace["visual_coverage"]["sent"] == 1
        assert trace["document_coverage"]["with_evidence"] == 1
        assert trace["retrieval"]["ranking"]
        context = client.get(
            f"/api/v1/trace/responses/{answer['id']}/context",
            headers=superuser_token_headers,
        )
        assert context.status_code == 200, context.text
        assert context.json()["query"] == question
        assert any(
            source["kind"] == "figure" and source["page_number"] == 2
            for source in context.json()["sources"]
        )
        for endpoint in (
            f"trace/responses/{answer['id']}/context",
            f"trace/documents/{visual_pdf['id']}/chunks",
            f"documents/{visual_pdf['id']}/coverage",
        ):
            assert (
                client.get(
                    f"/api/v1/{endpoint}", headers=normal_user_token_headers
                ).status_code
                == 404
            )
    finally:
        client.delete(
            f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
        )


def test_cross_document_retrieval_keeps_a_short_conflicting_source(
    client, superuser_token_headers, monkeypatch
):
    user = client.get("/api/v1/users/me", headers=superuser_token_headers).json()
    identifiers = []
    with Session(engine) as session:
        for name, count, value in (
            ("Long report", 40, 120),
            ("Short correction", 1, 90),
            ("Unselected report", 1, 999),
        ):
            document = Document(
                owner_id=uuid.UUID(user["id"]),
                title=name,
                original_filename="fixture.pdf",
                sha256=uuid.uuid4().hex,
                storage_key="not-read.pdf",
                file_size=1,
                page_count=1,
            )
            session.add(document)
            session.flush()
            identifiers.append(document.id)
            version = DocumentVersion(document_id=document.id, status="EXTRACTED")
            session.add(version)
            session.flush()
            document.current_version_id = version.id
            page = DocumentPage(
                version_id=version.id, page_number=1, width=600, height=800
            )
            session.add_all([document, page])
            session.flush()
            for position in range(count):
                content = (
                    f"La energía anual reportada es {value} MWh. Registro {position}."
                )
                digest = hashlib.sha256(content.encode()).hexdigest()
                element = DocumentElement(
                    page_id=page.id, text=content, content_hash=digest
                )
                chunk = Chunk(
                    version_id=version.id,
                    text=content,
                    contextualized_text=content,
                    content_hash=digest,
                )
                session.add_all([element, chunk])
                session.flush()
                session.add(
                    ChunkProvenance(
                        chunk_id=chunk.id, element_id=element.id, span_end=len(content)
                    )
                )
        session.commit()
        try:
            diagnostics = {}
            sources, _mode = retrieve(
                session,
                identifiers[:2],
                "Compara la energía anual reportada",
                diagnostics=diagnostics,
            )
            assert {source.document_id for source in sources} == set(identifiers[:2])
            assert any("90 MWh" in source.text for source in sources)
            assert all("999" not in source.text for source in sources)
            assert len({source.label for source in sources}) == len(sources)
            assert diagnostics["candidate_count"] >= 31
            assert diagnostics["strategy"] == "hybrid-document-balanced-v2"

            # A first dense index must not block comparing already extracted
            # text, including the short correction that could otherwise vanish.
            for identifier in identifiers[:2]:
                document = session.get(Document, identifier)
                document.status = "INDEXING"
                session.add(document)
            session.commit()

            class TextChat:
                is_cloud = False

                def discover(self):
                    return [
                        ModelDescriptor(
                            id="test-chat",
                            provider="ollama",
                            version="v1",
                            capabilities=ModelCapabilities(text="declared"),
                        )
                    ]

                def stream(self, request):
                    context = json.loads(request.prompt)
                    sources = context["evidence"]
                    assert any("120 MWh" in source["text"] for source in sources)
                    assert any("90 MWh" in source["text"] for source in sources)
                    labels = [
                        next(
                            source["source_id"]
                            for source in sources
                            if value in source["text"]
                        )
                        for value in ["120 MWh", "90 MWh"]
                    ]
                    yield f"El informe dice 120 MWh [Fuente {labels[0]}]; la corrección dice 90 MWh [Fuente {labels[1]}]."

            monkeypatch.setattr(
                "app.services.rag.chat.get_provider", lambda *_args: TextChat()
            )
            workspace = client.post(
                "/api/v1/workspaces/",
                headers=superuser_token_headers,
                json={"name": "Query while indexing"},
            ).json()
            try:
                for identifier in identifiers[:2]:
                    client.put(
                        f"/api/v1/workspaces/{workspace['id']}/documents/{identifier}",
                        headers=superuser_token_headers,
                    ).raise_for_status()
                conversation = client.post(
                    f"/api/v1/workspaces/{workspace['id']}/conversations",
                    headers=superuser_token_headers,
                    json={"provider": "ollama", "model": "test-chat"},
                ).json()
                response = client.post(
                    f"/api/v1/conversations/{conversation['id']}/messages",
                    headers=superuser_token_headers,
                    json={
                        "question": "Compara la energía anual reportada",
                        "document_ids": [
                            str(identifier) for identifier in identifiers[:2]
                        ],
                    },
                )
                assert "event: done" in response.text
                answer = client.get(
                    f"/api/v1/conversations/{conversation['id']}/messages",
                    headers=superuser_token_headers,
                ).json()[-1]
                assert {source["document_id"] for source in answer["citations"]} == {
                    str(identifier) for identifier in identifiers[:2]
                }
                assert set(answer["usage"]["trace"]["indexes_pending"]) == {
                    str(identifier) for identifier in identifiers[:2]
                }
            finally:
                client.delete(
                    f"/api/v1/workspaces/{workspace['id']}",
                    headers=superuser_token_headers,
                )
        finally:
            for identifier in identifiers:
                session.delete(session.get(Document, identifier))
            session.commit()
