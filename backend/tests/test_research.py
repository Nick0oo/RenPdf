import io
import json
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.db import engine
from app.domain import (
    Chunk,
    ChunkEmbedding,
    ChunkProvenance,
    CloudConsent,
    Document,
    DocumentElement,
    DocumentIndex,
    DocumentPage,
    EmbeddingProfile,
    Job,
    now,
)
from app.services.models.contracts import (
    ModelCapabilities,
    ModelDescriptor,
    ProviderError,
)
from app.services.models.providers import normalized_vectors
from app.services.parsing.geometry import normalize_bbox, rotate_bbox
from app.services.parsing.pdf import inspect_pdf, page_elements, structural_chunks
from app.services.privacy.consent import require_consent
from app.services.rag.retrieval import is_document_overview, retrieve
from app.services.storage.local import LocalStorage
from app.workers.tasks import process_job

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def no_broker(monkeypatch):
    # Unit/integration tests execute the real pipeline explicitly. No dev queue writes.
    monkeypatch.setattr("app.api.routes.documents.enqueue", lambda _job: None)


@pytest.fixture
def document(client: TestClient, superuser_token_headers):
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={
            "file": (
                "digital_es.pdf",
                (FIXTURES / "digital_es.pdf").read_bytes(),
                "application/pdf",
            )
        },
    )
    assert response.status_code == 200, response.text
    identifier = uuid.UUID(response.json()["id"])
    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.document_id == identifier)).first()
        process_job(str(job.id))
        session.expire_all()
        doc = session.get(Document, identifier)
        assert doc.status == "EXTRACTED", session.get(Job, job.id).error_message
    yield identifier
    client.delete(f"/api/v1/documents/{identifier}", headers=superuser_token_headers)


class ContractProvider:
    """Only a test double: production registry never registers this class."""

    is_cloud = True
    name = "gemini"
    calls = 0
    version = "test-v1"

    def discover(self):
        return [
            ModelDescriptor(
                id="contract-embedding",
                provider="gemini",
                version=self.version,
                capabilities=ModelCapabilities(embeddings="declared"),
            )
        ]

    def embed(self, _model, texts, dimensions, *, query=False):
        self.calls += 1
        vectors = []
        for value in texts:
            value = value.lower()
            vector = [
                1.0 if "solar" in value else 0.01,
                1.0 if "emisiones" in value else 0.01,
                1.0 if "producción" in value else 0.01,
            ]
            vectors.append(vector[:dimensions])
        return normalized_vectors(vectors, len(texts), dimensions)


def grant(session, identifier, scope):
    document = session.get(Document, identifier)
    consent = CloudConsent(
        document_id=identifier,
        owner_id=document.owner_id,
        provider="gemini",
        scope=scope,
        expires_at=now() + timedelta(days=1),
    )
    session.add(consent)
    session.commit()
    return consent


def test_safe_upload_real_extraction_and_dedup(
    document, client, superuser_token_headers
):
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={
            "file": ("../../escape.pdf", (FIXTURES / "digital_es.pdf").read_bytes())
        },
    )
    assert response.json()["id"] == str(document)
    assert "storage_key" not in response.json()
    original = client.get(
        f"/api/v1/documents/{document}/file", headers=superuser_token_headers
    )
    assert original.content == (FIXTURES / "digital_es.pdf").read_bytes()
    assert original.headers["content-type"] == "application/pdf"
    with Session(engine) as session:
        doc = session.get(Document, document)
        pages = session.exec(
            select(DocumentPage).where(
                DocumentPage.version_id == doc.current_version_id
            )
        ).all()
        assert len(pages) == 2
        assert session.exec(
            select(Chunk).where(Chunk.version_id == doc.current_version_id)
        ).first()
    table = client.get(
        f"/api/v1/documents/{document}/pages/2/elements",
        headers=superuser_token_headers,
    )
    assert any(
        element["structured_content"].get("rows", [])[1:]
        == [["Solar", "120"], ["Eólica", "80"], ["Total", "200"]]
        for element in table.json()
        if element["element_type"] == "table"
    )


def test_invalid_upload_is_not_persisted(client, superuser_token_headers):
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": ("fake.pdf", b"not a pdf", "application/pdf")},
    )
    assert response.status_code == 422


def test_failed_page_checkpoint_resumes_without_duplicate_pages(
    client, superuser_token_headers, monkeypatch
):
    source = (FIXTURES / "digital_es.pdf").read_bytes() + b"\n% checkpoint-contract"
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": ("checkpoint.pdf", source)},
    )
    identifier = uuid.UUID(response.json()["id"])
    from app.services.parsing.isolated import PageParser

    original_elements = PageParser.elements

    def fail_second_page(parser, number):
        if number == 2:
            raise ProviderError("PARSER_TIMEOUT", "Contract interrupted page")
        return original_elements(parser, number)

    monkeypatch.setattr("app.workers.tasks.PageParser.elements", fail_second_page)
    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.document_id == identifier)).first()
        process_job(str(job.id))
        session.expire_all()
        job = session.get(Job, job.id)
        assert job.state == "FAILED" and job.checkpoint == 1
        assert session.get(Document, identifier).status != "READY"
        monkeypatch.setattr("app.workers.tasks.PageParser.elements", original_elements)
        job.state = "QUEUED"
        session.add(job)
        session.commit()
        process_job(str(job.id))
        session.expire_all()
        assert session.get(Job, job.id).state == "SUCCEEDED"
        assert (
            len(
                session.exec(
                    select(DocumentPage).where(
                        DocumentPage.version_id == job.version_id
                    )
                ).all()
            )
            == 2
        )
    client.delete(f"/api/v1/documents/{identifier}", headers=superuser_token_headers)


def test_public_signup_disabled(client):
    response = client.post(
        "/api/v1/users/signup",
        json={"email": "outsider@example.com", "password": "secure-test-password"},
    )
    assert response.status_code == 403


def test_cookie_auth_and_origin_guard(client):
    from app.core.config import settings

    response = client.post(
        "/api/v1/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]
    assert client.get("/api/v1/documents/").status_code == 200
    assert (
        client.post(
            "/api/v1/workspaces/",
            headers={"Origin": "https://attacker.example"},
            json={"name": "bad"},
        ).status_code
        == 403
    )
    client.cookies.clear()


def test_filtered_spanish_lexical_retrieval(document):
    with Session(engine) as session:
        sources, mode = retrieve(session, [document], "capacidad solar instalada")
        assert mode == "lexical"
        assert sources[0].page_number == 1
        assert "120" in sources[0].text
        assert sources[0].bbox is not None
        assert {source.document_id for source in sources} == {document}
        absent, _mode = retrieve(session, [document], "quasar plutonio")
        assert absent == []


@pytest.mark.parametrize(
    "question",
    [
        "¿Puedes explicarme cuál es la capacidad solar instalada según este documento?",
        "Could you please tell me what installed solar capacity this PDF reports?",
    ],
)
def test_natural_language_queries_recover_topic_without_embeddings(document, question):
    with Session(engine) as session:
        assert session.get(Document, document).active_index_id is None
        sources, mode = retrieve(session, [document], question)
        assert mode == "lexical_relaxed"
        assert any(
            "120" in source.text and source.page_number == 1 for source in sources
        )
        assert {source.document_id for source in sources} == {document}
        absent, _mode = retrieve(
            session,
            [document],
            "¿Puedes explicarme qué dice este documento sobre quasar plutonio?",
        )
        assert absent == []


def test_natural_question_requires_cloud_consent_instead_of_false_abstention(
    document, client, superuser_token_headers, monkeypatch
):
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Natural query consent regression"},
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{document}",
        headers=superuser_token_headers,
    )
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "gemini", "model": "contract-chat"},
    ).json()

    def unexpected_model_call(*_args):
        raise AssertionError("Private evidence must not reach a model without consent")

    monkeypatch.setattr("app.services.rag.chat.get_provider", unexpected_model_call)
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
        json={"question": "¿Puedes decirme cuál es la capacidad solar del documento?"},
    )
    assert '"code": "CONSENT_REQUIRED"' in response.text, response.text
    rows = client.get(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
    ).json()
    assert rows[-1]["state"] == "FAILED" and not rows[-1]["citations"]
    client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
    )


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("Resume los puntos principales con sus fuentes.", True),
        ("¿De qué trata este PDF?", True),
        ("What are the main points of this document?", True),
        ("Resume lo que dice el documento sobre quasar plutonio.", False),
        ("¿Cuál es la capacidad solar instalada?", False),
    ],
)
def test_general_summary_intent_preserves_topic_question_boundaries(question, expected):
    assert is_document_overview(question) is expected


def test_generic_summary_uses_real_pages_without_cloud_or_embeddings(
    document, client, superuser_token_headers, monkeypatch
):
    with Session(engine) as session:
        sources, mode = retrieve(
            session, [document], "Resume los puntos principales con sus fuentes."
        )
        assert mode == "document_overview" and sources
        assert {source.page_number for source in sources} == {1, 2}
        assert {source.document_id for source in sources} == {document}
        assert len({source.label for source in sources}) == len(sources)
        for source in sources:
            origin = session.get(DocumentElement, source.element_id)
            assert source.text in origin.text
            assert (source.bbox.model_dump() if source.bbox else None) == origin.bbox
        absent, mode = retrieve(
            session,
            [document],
            "Resume lo que dice el documento sobre quasar plutonio.",
        )
        assert not absent and mode != "document_overview"
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "General overview regression"},
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{document}",
        headers=superuser_token_headers,
    )
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "ollama", "model": "local-contract"},
    ).json()

    class LocalOverviewProvider:
        def discover(self):
            return [
                ModelDescriptor(id="local-contract", provider="ollama", version="test")
            ]

        def stream(self, request):
            context = json.loads(request.prompt)
            assert context["coverage"] == "sampled_pages_partial"
            assert "muestra" in request.system and "todo el PDF" in request.system
            assert all(
                item["document"] and item["page_number"] for item in context["evidence"]
            )
            supporting = next(
                item for item in context["evidence"] if "120" in item["text"]
            )
            yield f"La evidencia informa 120 MWh de capacidad solar. [Fuente {supporting['source_id']}]"

    monkeypatch.setattr(
        "app.services.rag.chat.get_provider", lambda *_args: LocalOverviewProvider()
    )
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
        json={"question": "Resume los puntos principales con sus fuentes."},
    )
    assert "event: done" in response.text, response.text
    rows = client.get(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
    ).json()
    answer = rows[-1]
    assert (
        answer["state"] == "COMPLETE"
        and answer["retrieval_mode"] == "document_overview"
    )
    assert "cobertura es parcial" in answer["content"]
    assert "2 de 2 páginas" in answer["content"]
    assert answer["citations"] and "120" in answer["citations"][0]["text"]
    with Session(engine) as session:
        assert not session.exec(
            select(CloudConsent).where(CloudConsent.document_id == document)
        ).first()
    client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
    )


def test_overview_recovers_adjacent_short_lines_with_exact_sources(
    client, superuser_token_headers
):
    import pymupdf

    pdf = pymupdf.open()
    page = pdf.new_page()
    lines = [
        "Resumen del experimento contextual",
        "El prototipo usa reglas explicitas.",
        "Se registraron 42 observaciones.",
        "La entrada aporta 120 unidades.",
        "El segundo flujo aporta 80 unidades.",
        "El acumulador obtiene 200 unidades verificadas.",
        "Cada decision guarda su regla de origen.",
        "Los resultados se pueden revisar por pagina.",
        "Ejecucion en CPU del equipo.",
    ]
    for index, line in enumerate(lines):
        page.insert_text((40, 60 + index * 45), line, fontsize=11)
    page.insert_text(
        (40, 790),
        "Informacion editorial complementaria: referencia institucional y derechos de publicacion.",
        fontsize=9,
    )
    source = pdf.tobytes()
    pdf.close()
    uploaded = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": ("short-line-window.pdf", source, "application/pdf")},
    ).json()
    identifier = uuid.UUID(uploaded["id"])
    try:
        with Session(engine) as session:
            job = session.exec(select(Job).where(Job.document_id == identifier)).first()
            process_job(str(job.id))
            session.expire_all()
            assert session.get(Job, job.id).state == "SUCCEEDED"
            evidence, mode = retrieve(
                session, [identifier], "Resume los puntos principales con sus fuentes."
            )
            assert mode == "document_overview" and 3 <= len(evidence) <= 48
            assert sum(len(item.text) for item in evidence) <= 6000
            assert len({item.label for item in evidence}) == len(evidence)
            assert [item.bbox.y for item in evidence] == sorted(
                item.bbox.y for item in evidence
            )
            for amount in ("120", "80", "200"):
                assert any(amount in item.text for item in evidence)
            assert not any("Informacion editorial" in item.text for item in evidence)
            for item in evidence:
                origin = session.get(DocumentElement, item.element_id)
                assert item.text in origin.text
                assert item.bbox.model_dump() == origin.bbox
                assert item.document_id == identifier
    finally:
        client.delete(
            f"/api/v1/documents/{identifier}", headers=superuser_token_headers
        )


def test_empty_or_unprocessed_chat_reports_actionable_error(
    client, superuser_token_headers
):
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Readiness regression"},
    ).json()
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "ollama", "model": "unused-model"},
    ).json()
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
        json={"question": "capacidad solar"},
    )
    assert '"code": "NO_DOCUMENTS_SELECTED"' in response.text
    pending = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={
            "file": (
                "pending.pdf",
                (FIXTURES / "digital_es.pdf").read_bytes() + b"\n% readiness",
            )
        },
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{pending['id']}",
        headers=superuser_token_headers,
    )
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
        json={"question": "capacidad solar"},
    )
    assert '"code": "DOCUMENT_NOT_READY"' in response.text
    client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
    )
    client.delete(f"/api/v1/documents/{pending['id']}", headers=superuser_token_headers)


def test_processed_pdf_without_chunks_reports_ocr_action(
    document, client, superuser_token_headers
):
    from sqlmodel import delete

    with Session(engine) as session:
        doc = session.get(Document, document)
        identifiers = list(
            session.exec(
                select(Chunk.id).where(Chunk.version_id == doc.current_version_id)
            ).all()
        )
        session.exec(
            delete(ChunkProvenance).where(ChunkProvenance.chunk_id.in_(identifiers))
        )
        session.exec(delete(Chunk).where(Chunk.version_id == doc.current_version_id))
        session.commit()
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "OCR readiness"},
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{document}",
        headers=superuser_token_headers,
    )
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "ollama", "model": "unused-model"},
    ).json()
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
        json={"question": "capacidad solar"},
    )
    assert '"code": "DOCUMENT_HAS_NO_TEXT"' in response.text
    client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
    )


def test_merged_chunk_cites_supporting_element_not_its_heading(
    document, client, superuser_token_headers, monkeypatch
):
    with Session(engine) as session:
        doc = session.get(Document, document)
        page = session.exec(
            select(DocumentPage).where(
                DocumentPage.version_id == doc.current_version_id
            )
        ).first()
        heading = DocumentElement(
            page_id=page.id,
            text="Resultados del experimento",
            content_hash="test-heading",
            bbox={"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.05},
        )
        body = DocumentElement(
            page_id=page.id,
            text="El prototipo zafiro produjo 731 unidades.",
            content_hash="test-body",
            bbox={"x": 0.1, "y": 0.2, "width": 0.8, "height": 0.1},
        )
        session.add_all([heading, body])
        session.flush()
        chunk = Chunk(
            version_id=doc.current_version_id,
            text=heading.text + "\n" + body.text,
            contextualized_text=heading.text + "\n" + body.text,
            content_hash="test-merged",
            chunking_profile="docling-hybrid-v1",
        )
        session.add(chunk)
        session.flush()
        session.add_all(
            [
                ChunkProvenance(
                    chunk_id=chunk.id, element_id=element.id, span_end=len(element.text)
                )
                for element in (heading, body)
            ]
        )
        session.commit()
        body_id, body_bbox = body.id, body.bbox
        sources, _mode = retrieve(session, [document], "prototipo zafiro")
        assert len({source.label for source in sources}) == len(sources)
        assert {source.element_id for source in sources} == {heading.id, body.id}
        grant(session, document, "chat")
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Merged provenance"},
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{document}",
        headers=superuser_token_headers,
    )
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "gemini", "model": "contract-chat"},
    ).json()

    class SupportingElementProvider:
        def discover(self):
            return [
                ModelDescriptor(id="contract-chat", provider="gemini", version="test")
            ]

        def stream(self, request):
            sources = json.loads(request.prompt)["evidence"]
            supporting = next(source for source in sources if "731" in source["text"])
            yield f"El prototipo produjo 731 unidades. [Fuente {supporting['source_id']}]"

    monkeypatch.setattr(
        "app.services.rag.chat.get_provider", lambda *_args: SupportingElementProvider()
    )
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
        json={"question": "prototipo zafiro"},
    )
    assert "event: done" in response.text, response.text
    rows = client.get(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
    ).json()
    source = rows[-1]["citations"][0]
    assert source["element_id"] == str(body_id)
    assert source["bbox"] == body_bbox
    assert (
        "731" in source["text"] and "Resultados del experimento" not in source["text"]
    )
    client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
    )


def test_cloud_consent_revocation_and_scope(document):
    with Session(engine) as session:
        with pytest.raises(ProviderError, match="Autoriza"):
            require_consent(session, [document], "gemini", "embeddings")
        consent = grant(session, document, "embeddings")
        require_consent(session, [document], "gemini", "embeddings")
        with pytest.raises(ProviderError):
            require_consent(session, [document], "gemini", "chat")
        consent.revoked_at = now()
        session.add(consent)
        session.commit()
        with pytest.raises(ProviderError):
            require_consent(session, [document], "gemini", "embeddings")
        require_consent(session, [document], "ollama", "chat")


def test_index_is_not_activated_without_consent(document, monkeypatch):
    provider = ContractProvider()
    monkeypatch.setattr("app.workers.tasks.get_provider", lambda _name: provider)
    with Session(engine) as session:
        job = Job(
            document_id=document,
            kind="index",
            parameters={
                "provider": "gemini",
                "model": "contract-embedding",
                "dimensions": 3,
            },
        )
        session.add(job)
        session.commit()
        process_job(str(job.id))
        session.expire_all()
        assert session.get(Job, job.id).state == "FAILED"
        assert session.get(Job, job.id).error_code == "CONSENT_REQUIRED"
        assert session.get(Document, document).active_index_id is None
        assert provider.calls == 0


def test_pgvector_hybrid_index_profiles_and_atomic_activation(document, monkeypatch):
    provider = ContractProvider()
    monkeypatch.setattr("app.workers.tasks.get_provider", lambda _name: provider)
    monkeypatch.setattr(
        "app.services.rag.retrieval.get_provider", lambda _name: provider
    )
    with Session(engine) as session:
        grant(session, document, "embeddings")
        job = Job(
            document_id=document,
            kind="index",
            parameters={
                "provider": "gemini",
                "model": "contract-embedding",
                "dimensions": 3,
            },
        )
        session.add(job)
        session.commit()
        process_job(str(job.id))
        session.expire_all()
        assert session.get(Job, job.id).state == "SUCCEEDED", session.get(
            Job, job.id
        ).error_message
        doc = session.get(Document, document)
        original_index = doc.active_index_id
        assert doc.status == "READY"
        vectors = session.exec(
            select(ChunkEmbedding).where(ChunkEmbedding.index_id == original_index)
        ).all()
        assert vectors and all(len(row.embedding) == 3 for row in vectors)
        sources, mode = retrieve(session, [document], "solar")
        assert mode == "hybrid" and sources
        provider.version = "test-v2"
        sources, mode = retrieve(session, [document], "solar")
        assert mode == "lexical"  # No comparison against another version's query space.
        new_job = Job(
            document_id=document,
            kind="index",
            parameters={
                "provider": "gemini",
                "model": "contract-embedding",
                "dimensions": 2,
            },
        )
        session.add(new_job)
        session.commit()
        process_job(str(new_job.id))
        session.expire_all()
        new_index = session.get(Document, document).active_index_id
        assert new_index != original_index
        assert session.get(DocumentIndex, original_index).status == "READY"
        assert (
            session.get(DocumentIndex, original_index).profile_id
            != session.get(DocumentIndex, new_index).profile_id
        )


def test_multimodal_retrieval_requires_its_own_scope_and_honors_revocation(
    document, monkeypatch
):
    provider = ContractProvider()
    monkeypatch.setattr(
        "app.services.rag.retrieval.get_provider", lambda _name: provider
    )
    with Session(engine) as session:
        doc = session.get(Document, document)
        profile = EmbeddingProfile(
            provider="gemini",
            model="contract-embedding",
            model_version=provider.version,
            dimensions=3,
            modality="multimodal",
            fingerprint=f"scope-contract-{uuid.uuid4()}",
        )
        session.add(profile)
        session.flush()
        index = DocumentIndex(
            version_id=doc.current_version_id, profile_id=profile.id, status="READY"
        )
        session.add(index)
        session.flush()
        chunks = session.exec(
            select(Chunk).where(Chunk.version_id == doc.current_version_id)
        ).all()
        vectors = provider.embed(profile.model, [row.text for row in chunks], 3)
        for chunk, vector in zip(chunks, vectors, strict=True):
            session.add(
                ChunkEmbedding(chunk_id=chunk.id, index_id=index.id, embedding=vector)
            )
        doc.active_index_id = index.id
        session.add(doc)
        consent = grant(session, document, "multimodal_embeddings")
        diagnostics = {}
        evidence, mode = retrieve(session, [document], "solar", diagnostics=diagnostics)
        assert evidence and mode == "hybrid"
        assert diagnostics["used_profiles"][0]["modality"] == "multimodal"
        consent.revoked_at = now()
        session.add(consent)
        grant(
            session, document, "embeddings"
        )  # Ordinary permission cannot replace revoked multimodal permission.
        calls = provider.calls
        diagnostics = {}
        evidence, mode = retrieve(session, [document], "solar", diagnostics=diagnostics)
        assert evidence and mode == "lexical"
        assert provider.calls == calls
        assert diagnostics["semantic_failures"][0]["error_code"] == "CONSENT_REQUIRED"


def test_chat_verified_citations_and_persistence(
    document, client, superuser_token_headers, monkeypatch
):
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Contract research"},
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{document}",
        headers=superuser_token_headers,
    )
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "gemini", "model": "contract-chat"},
    ).json()

    class ChatDouble:
        def discover(self):
            return [
                ModelDescriptor(id="contract-chat", provider="gemini", version="test")
            ]

        def stream(self, request):
            assert "NO CONFIABLES" in request.system
            assert "source_id" in request.prompt
            yield "La capacidad solar es 120 MWh. "
            yield "[Fuente 1]"

    monkeypatch.setattr(
        "app.services.rag.chat.get_provider", lambda *_args: ChatDouble()
    )
    with Session(engine) as session:
        grant(session, document, "chat")
    response = client.post(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
        json={"question": "capacidad solar instalada"},
    )
    assert "event: token" in response.text
    assert "event: done" in response.text, response.text
    rows = client.get(
        f"/api/v1/conversations/{conversation['id']}/messages",
        headers=superuser_token_headers,
    ).json()
    assert rows[-1]["state"] == "COMPLETE"
    assert rows[-1]["citations"][0]["page_number"] == 1
    assert rows[-1]["citations"][0]["element_id"]
    trace = rows[-1]["usage"]["trace"]
    assert trace["outcome"] == "complete" and trace["inference_attempted"]
    assert trace["evidence_count"] == len(trace["sources"]) > 0
    assert trace["policy"]["model"] == "contract-chat"
    assert trace["cited_labels"] and trace["document_snapshots"][0][
        "document_id"
    ] == str(document)
    assert trace["retrieval"]["used_profiles"] == []
    assert all("text" not in source for source in trace["sources"])
    exported = client.get(
        f"/api/v1/conversations/{conversation['id']}/export?format=json",
        headers=superuser_token_headers,
    )
    assert exported.json()[-1]["citations"][0]["document_id"] == str(document)
    client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
    )


def test_scan_degrades_honestly():
    metadata, elements = page_elements(FIXTURES / "scanned.pdf", 1)
    assert metadata["extraction_status"] in {
        "OCR_EXTRACTED",
        "OCR_UNAVAILABLE",
        "OCR_REQUIRED",
    }
    if metadata["extraction_status"] == "OCR_EXTRACTED":
        assert any("LUNA" in element.text for element in elements)
    else:
        assert not any(element.text.strip() for element in elements)


def test_encrypted_pdf_is_rejected(tmp_path):
    import pymupdf

    source = pymupdf.open(FIXTURES / "digital_es.pdf")
    target = tmp_path / "encrypted.pdf"
    source.save(
        target,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw="owner",
        user_pw="password",
    )
    source.close()
    with pytest.raises(ValueError, match="ENCRYPTED"):
        inspect_pdf(target)


def test_chunking_preserves_exact_spans_and_handles_long_text():
    text = "Encabezado: energía solar. " * 500
    chunks = list(structural_chunks(text))
    assert len(chunks) > 1
    assert all(
        text[start:end] == fragment and len(fragment) <= 1600
        for fragment, start, end in chunks
    )
    assert chunks[-1][2] == len(text)


@pytest.mark.parametrize("angle", [0, 90, 180, 270])
def test_geometry_roundtrip_and_crop_rotation(angle):
    box = normalize_bbox([50, 100, 250, 300], 500, 800)
    result = rotate_bbox(rotate_bbox(box, angle), (360 - angle) % 360)
    assert result == pytest.approx(box, abs=1e-9)
    assert normalize_bbox(
        [50, 500, 250, 700], 500, 800, bottom_left=True
    ) == pytest.approx(box)
    metadata, elements = page_elements(FIXTURES / "crop_rotated.pdf", 1)
    assert metadata["rotation"] == 90
    assert metadata["width"] == 525 and metadata["height"] == 775
    assert all(
        normalize_bbox(element.source_bbox, metadata["width"], metadata["height"])
        for element in elements
        if element.text
    )


def test_storage_rejects_traversal_and_enforces_size(tmp_path):
    storage = LocalStorage(tmp_path)
    for key in ("../secret", "C:/secret", "/etc/passwd"):
        with pytest.raises(ValueError):
            storage.path(key)
    with pytest.raises(ValueError, match="UPLOAD_TOO_LARGE"):
        storage.write(io.BytesIO(b"12345"), "test.pdf", 4)
    assert not list(tmp_path.glob("*.part"))


def test_workspace_document_isolation(
    document, client, normal_user_token_headers, superuser_token_headers
):
    assert (
        client.get(
            f"/api/v1/documents/{document}/file", headers=normal_user_token_headers
        ).status_code
        == 404
    )
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=normal_user_token_headers,
        json={"name": "Other user"},
    ).json()
    assert (
        client.put(
            f"/api/v1/workspaces/{workspace['id']}/documents/{document}",
            headers=normal_user_token_headers,
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/workspaces/{workspace['id']}/documents",
            headers=superuser_token_headers,
        ).status_code
        == 404
    )
    client.delete(
        f"/api/v1/workspaces/{workspace['id']}", headers=normal_user_token_headers
    )
