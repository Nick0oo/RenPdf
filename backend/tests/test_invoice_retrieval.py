"""Cross-language field retrieval without embeddings, using invented invoices."""

import hashlib
import json
import uuid

import pymupdf
import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.domain import (
    Chunk,
    ChunkEmbedding,
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentIndex,
    DocumentPage,
    DocumentVersion,
    EmbeddingProfile,
    Job,
)
from app.services.models.contracts import ModelDescriptor
from app.services.rag.retrieval import retrieve
from app.workers.tasks import process_job


@pytest.fixture
def invoice(client, superuser_token_headers, monkeypatch):
    monkeypatch.setattr("app.api.routes.documents.enqueue", lambda _job: None)
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 70), "INVOICE", fontsize=20)
        # Labels and values are distinct PDF elements, on the same visual line.
        for row, label, value in (
            (110, "INVOICE NUMBER", "TEST-401"),
            (140, "ISSUE DATE", "April 12, 2026"),
            (170, "PAYMENT DUE", "May 12, 2026"),
            (240, "DESCRIPTION", "Synthetic research service"),
            (270, "TOTAL", "250.00"),
        ):
            page.insert_text((72, row), label)
            page.insert_text((300, row), value)
        second = pdf.new_page()
        second.insert_text((72, 70), "An unrelated astronomy appendix")
        payload = pdf.tobytes()
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": ("invented-invoice.pdf", payload, "application/pdf")},
    )
    assert response.status_code == 200, response.text
    identifier = uuid.UUID(response.json()["id"])
    with Session(engine) as session:
        job = session.exec(select(Job).where(Job.document_id == identifier)).first()
        process_job(str(job.id))
        session.expire_all()
        assert session.get(Job, job.id).state == "SUCCEEDED"
        assert session.get(Document, identifier).active_index_id is None
    yield identifier
    client.delete(f"/api/v1/documents/{identifier}", headers=superuser_token_headers)


def test_spanish_invoice_month_keeps_english_field_value_and_exact_citations(
    invoice, client, superuser_token_headers, monkeypatch
):
    with Session(engine) as session:
        original = session.get(Document, invoice)
        # A different, unselected version must never provide a tempting answer.
        other = Document(
            owner_id=original.owner_id,
            title="Unselected invented invoice",
            original_filename="unselected.pdf",
            sha256=uuid.uuid4().hex,
            storage_key="not-read.pdf",
            file_size=1,
            page_count=1,
            status="EXTRACTED",
        )
        session.add(other)
        session.flush()
        version = DocumentVersion(document_id=other.id, status="EXTRACTED")
        session.add(version)
        session.flush()
        other.current_version_id = version.id
        page = DocumentPage(version_id=version.id, page_number=1, width=600, height=800)
        session.add_all([other, page])
        session.flush()
        wrong = "Invoice issue date: September 1, 2026"
        digest = hashlib.sha256(wrong.encode()).hexdigest()
        element = DocumentElement(page_id=page.id, text=wrong, content_hash=digest)
        chunk = Chunk(
            version_id=version.id,
            text=wrong,
            contextualized_text=wrong,
            content_hash=digest,
        )
        session.add_all([element, chunk])
        session.flush()
        session.add(
            ChunkProvenance(
                chunk_id=chunk.id,
                element_id=element.id,
                span_start=0,
                span_end=len(wrong),
            )
        )
        session.commit()
        try:
            evidence, mode = retrieve(
                session, [invoice], "Cual es el mes de la factura"
            )
            assert mode == "lexical_expanded"
            assert any("ISSUE DATE" in item.text for item in evidence)
            assert any("April 12, 2026" in item.text for item in evidence)
            assert {item.document_id for item in evidence} == {invoice}
            assert {item.page_number for item in evidence} == {1}
            assert len({item.label for item in evidence}) == len(evidence)
            assert len(evidence) <= 48
            assert sum(len(item.text) for item in evidence) <= 6000
            for item in evidence:
                origin = session.get(DocumentElement, item.element_id)
                assert item.text in origin.text
                assert item.bbox.model_dump() == origin.bbox
            absent, _mode = retrieve(session, [invoice], "quasar plutonio")
            assert absent == []
        finally:
            session.delete(other)
            session.commit()

    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Cross-language invoice regression"},
    ).json()
    client.put(
        f"/api/v1/workspaces/{workspace['id']}/documents/{invoice}",
        headers=superuser_token_headers,
    )
    conversation = client.post(
        f"/api/v1/workspaces/{workspace['id']}/conversations",
        headers=superuser_token_headers,
        json={"provider": "ollama", "model": "local-contract"},
    ).json()

    class LocalInvoiceProvider:
        is_cloud = False

        def discover(self):
            return [
                ModelDescriptor(id="local-contract", provider="ollama", version="test")
            ]

        def stream(self, request):
            context = json.loads(request.prompt)
            assert context["question"] == "Cual es el mes de la factura"
            assert all(item["page_number"] == 1 for item in context["evidence"])
            supporting = next(
                item for item in context["evidence"] if "April 12, 2026" in item["text"]
            )
            yield f"El mes de emisión es abril. [Fuente {supporting['source_id']}]"

    monkeypatch.setattr(
        "app.services.rag.chat.get_provider", lambda *_args: LocalInvoiceProvider()
    )
    try:
        response = client.post(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
            json={
                "question": "Cual es el mes de la factura",
                "document_ids": [str(invoice)],
            },
        )
        assert "event: done" in response.text, response.text
        answer = client.get(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
        ).json()[-1]
        assert answer["state"] == "COMPLETE"
        assert answer["retrieval_mode"] == "lexical_expanded"
        assert "abril" in answer["content"]
        assert len(answer["citations"]) == 1
        assert answer["citations"][0]["document_id"] == str(invoice)
        assert "April 12, 2026" in answer["citations"][0]["text"]
        assert answer["usage"]["trace"]["retrieval"]["mode"] == "lexical_expanded"

        # The same recovered fields must remain behind cloud consent checks.
        client.patch(
            f"/api/v1/conversations/{conversation['id']}/model",
            headers=superuser_token_headers,
            json={"provider": "gemini", "model": "contract-chat"},
        )
        response = client.post(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
            json={"question": "Cual es el mes de la factura"},
        )
        assert '"code": "CONSENT_REQUIRED"' in response.text, response.text
    finally:
        client.delete(
            f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
        )


def test_hybrid_vague_invoice_question_preserves_amount_and_date_neighbors(
    invoice, monkeypatch
):
    class LocalFieldEmbeddingProvider:
        def discover(self):
            return [
                ModelDescriptor(
                    id="local-invoice-fields", provider="llamacpp", version="test"
                )
            ]

        def embed(self, _model, _texts, _dimensions, *, query=False):
            assert query is True
            return [[1.0, 0.0, 0.0]]

    monkeypatch.setattr(
        "app.services.rag.retrieval.get_provider",
        lambda _name: LocalFieldEmbeddingProvider(),
    )
    with Session(engine) as session:
        document = session.get(Document, invoice)
        profile = EmbeddingProfile(
            provider="llamacpp",
            model="local-invoice-fields",
            model_version="test",
            dimensions=3,
            fingerprint=uuid.uuid4().hex,
        )
        session.add(profile)
        session.flush()
        index = DocumentIndex(
            version_id=document.current_version_id,
            profile_id=profile.id,
            status="READY",
        )
        session.add(index)
        session.flush()
        chunks = session.exec(
            select(Chunk).where(Chunk.version_id == document.current_version_id)
        ).all()
        # Semantic nearest neighbors find labels, not their separate numeric/date
        # values. The retrieval window must supply those actual source elements.
        for chunk in chunks:
            session.add(
                ChunkEmbedding(
                    chunk_id=chunk.id,
                    index_id=index.id,
                    embedding=[1.0, 0.0, 0.0]
                    if chunk.text.strip() in {"ISSUE DATE", "TOTAL"}
                    else [0.0, 1.0, 0.0],
                )
            )
        document.active_index_id = index.id
        session.add(document)
        session.commit()
        diagnostics = {}
        evidence, mode = retrieve(
            session,
            [invoice],
            "Cuanto es y que mes fue?",
            top_k=2,
            diagnostics=diagnostics,
        )
        assert mode == "hybrid"
        assert any("ISSUE DATE" in item.text for item in evidence)
        assert any("April 12, 2026" in item.text for item in evidence)
        assert any("TOTAL" in item.text for item in evidence)
        assert any("250.00" in item.text for item in evidence)
        assert {item.document_id for item in evidence} == {invoice}
        assert {item.page_number for item in evidence} == {1}
        assert len(evidence) <= 48
        assert sum(len(item.text) for item in evidence) <= 6000
        assert len({item.label for item in evidence}) == len(evidence)
        assert diagnostics["used_profiles"][0]["provider"] == "llamacpp"
        assert diagnostics["used_profiles"][0]["index_ids"] == [str(index.id)]
        for item in evidence:
            origin = session.get(DocumentElement, item.element_id)
            assert item.text in origin.text
            assert item.bbox.model_dump() == origin.bbox
