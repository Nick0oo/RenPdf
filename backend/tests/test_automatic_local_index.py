"""Complete-document preparation is independent of question vocabulary."""

import uuid

import pymupdf
import pytest
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.domain import (
    Chunk,
    ChunkEmbedding,
    Document,
    DocumentIndex,
    DocumentVersion,
    Job,
)
from app.services.models.contracts import (
    ModelCapabilities,
    ModelDescriptor,
    ProviderError,
)
from app.services.parsing.pdf import page_elements
from app.services.rag.retrieval import retrieve
from app.workers.tasks import process_job


class LocalAdapter:
    is_cloud = False

    def __init__(self):
        self.sent, self.calls, self.fail_after = [], 0, None

    def discover(self):
        return [
            ModelDescriptor(
                provider="llamacpp",
                id=model,
                version="controlled-v1",
                capabilities=ModelCapabilities(embeddings="declared"),
            )
            for model in ("local-whole-document", "workspace-local")
        ]

    def embed(self, _model, texts, dimensions, *, query=False):
        assert dimensions == 3
        if query:
            return [[1.0, 0.0, 0.0]]
        self.calls += 1
        if self.fail_after is not None and self.calls > self.fail_after:
            raise ProviderError(
                "UNAVAILABLE", "Runtime local temporalmente no disponible."
            )
        self.sent.extend(texts)
        return [
            [1.0, 0.0, 0.0] if "Boreal" in item else [0.0, 1.0, 0.0] for item in texts
        ]


@pytest.fixture
def automatic(monkeypatch):
    for name, value in {
        "AUTO_INDEX_LOCAL": True,
        "DEFAULT_EMBEDDING_PROVIDER": "llamacpp",
        "DEFAULT_EMBEDDING_MODEL": "local-whole-document",
        "LLAMACPP_BASE_URL": "http://127.0.0.1:8081",
        "LLAMACPP_MODE": "embeddings",
        "LLAMACPP_EMBEDDING_DIMENSIONS": 3,
        "EMBEDDING_DIMENSIONS": 3,
        "PARSER_ENGINE": "pymupdf",
    }.items():
        monkeypatch.setattr(settings, name, value)
    provider, enqueued = LocalAdapter(), []
    monkeypatch.setattr(
        "app.api.routes.documents.enqueue", lambda job: enqueued.append(job.id)
    )
    monkeypatch.setattr(
        "app.workers.tasks.enqueue", lambda job: enqueued.append(job.id)
    )
    monkeypatch.setattr(
        "app.workers.tasks.get_provider", lambda *_args, **_kwargs: provider
    )
    monkeypatch.setattr(
        "app.services.rag.retrieval.get_provider", lambda *_args: provider
    )

    class InlineParser:
        def __init__(self, path):
            self.path = path

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            pass

        def elements(self, number):
            return page_elements(self.path, number)

    monkeypatch.setattr("app.workers.tasks.PageParser", InlineParser)
    return provider, enqueued


@pytest.fixture
def uploaded(automatic, client, superuser_token_headers):
    _provider, _enqueued = automatic
    with pymupdf.open() as pdf:
        for page_number in range(2):
            page = pdf.new_page()
            for index in range(6):
                value = (
                    "La expedicion encontro un especimen magnetico en Isla Boreal."
                    if page_number == 1 and index == 3
                    else f"Registro polar independiente {page_number}-{index}."
                )
                page.insert_text((72, 72 + index * 65), value)
        page.insert_text((72, 500), uuid.uuid4().hex)
        payload = pdf.tobytes()
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": ("invented-whole-document.pdf", payload, "application/pdf")},
    )
    assert response.status_code == 200
    identifier = uuid.UUID(response.json()["id"])
    yield identifier
    for job in client.get(
        f"/api/v1/documents/{identifier}/jobs", headers=superuser_token_headers
    ).json():
        if job["state"] in {"QUEUED", "RUNNING"}:
            client.post(
                f"/api/v1/documents/{identifier}/jobs/{job['id']}/cancel",
                headers=superuser_token_headers,
            )
    client.delete(f"/api/v1/documents/{identifier}", headers=superuser_token_headers)


def extract(identifier):
    with Session(engine) as session:
        job = session.exec(
            select(Job).where(Job.document_id == identifier, Job.kind == "extract")
        ).first()
        process_job(str(job.id))
        return job.id


def test_native_local_pdf_defaults_to_multimodal(uploaded, monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_EMBEDDING_PROVIDER", "embeddinggemma")
    monkeypatch.setattr(settings, "DEFAULT_EMBEDDING_MODEL", "embeddinggemma-2-native")
    monkeypatch.setattr(settings, "EMBEDDINGGEMMA_BASE_URL", "http://127.0.0.1:8082")
    extract(uploaded)
    with Session(engine) as session:
        index = session.exec(
            select(Job).where(Job.document_id == uploaded, Job.kind == "index")
        ).one()
        assert index.parameters["provider"] == "embeddinggemma"
        assert index.parameters["modality"] == "multimodal"


def test_auto_indexes_every_chunk_then_answers_arbitrary_topic(
    uploaded, automatic, client, superuser_token_headers, monkeypatch
):
    provider, enqueued = automatic
    extraction = extract(uploaded)
    with Session(engine) as session:
        document = session.get(Document, uploaded)
        assert document.status == "INDEXING" and document.current_version_id
        assert document.active_index_id is None
        assert session.get(Job, extraction).state == "SUCCEEDED"
        chunks = session.exec(
            select(Chunk).where(Chunk.version_id == document.current_version_id)
        ).all()
        expected = {item.contextualized_text for item in chunks}
        assert len(chunks) >= 12
    path = f"/api/v1/documents/{uploaded}"
    first = client.post(path + "/index-local", headers=superuser_token_headers).json()
    repeated = client.post(
        path + "/index-local", headers=superuser_token_headers
    ).json()
    assert first["state"] == repeated["state"] == "QUEUED"
    assert first["job"]["id"] == repeated["job"]["id"]
    job_id = uuid.UUID(first["job"]["id"])
    assert enqueued.count(job_id) == 1
    client.post(f"{path}/jobs/{job_id}/cancel", headers=superuser_token_headers)
    assert (
        client.get(path, headers=superuser_token_headers).json()["status"]
        == "EXTRACTED"
    )
    client.post(f"{path}/jobs/{job_id}/retry", headers=superuser_token_headers)
    process_job(str(job_id))
    process_job(str(extraction))
    with Session(engine) as session:
        document = session.get(Document, uploaded)
        assert document.status == "READY"
        index = session.get(DocumentIndex, document.active_index_id)
        assert index.status == "READY"
        vectors = session.exec(
            select(ChunkEmbedding).where(ChunkEmbedding.index_id == index.id)
        ).all()
        assert {item.chunk_id for item in vectors} == {item.id for item in chunks}
        assert set(provider.sent) == expected
        assert session.get(Job, job_id).checkpoint == len(chunks)
        assert (
            len(session.exec(select(Job).where(Job.document_id == uploaded)).all()) == 2
        )
        evidence, mode = retrieve(
            session, [uploaded], "Where was the mysterious object discovered?", top_k=1
        )
        assert mode == "hybrid"
        assert any("Isla Boreal" in item.text for item in evidence)
        assert {item.page_number for item in evidence} == {2}
        active = document.active_index_id
    monkeypatch.setattr(settings, "DEFAULT_EMBEDDING_MODEL", "changed-selection")
    prepared = client.post(
        path + "/index-local", headers=superuser_token_headers
    ).json()
    assert prepared["state"] == "READY" and prepared["job"] is None
    with Session(engine) as session:
        assert session.get(Document, uploaded).active_index_id == active


def test_partial_index_failure_preserves_extraction_and_resumes_missing_vectors(
    uploaded, automatic, client, superuser_token_headers
):
    provider, _enqueued = automatic
    extract(uploaded)
    path = f"/api/v1/documents/{uploaded}"
    prepared = client.post(
        path + "/index-local", headers=superuser_token_headers
    ).json()
    job_id = uuid.UUID(prepared["job"]["id"])
    provider.fail_after = 1
    process_job(str(job_id))
    with Session(engine) as session:
        document = session.get(Document, uploaded)
        version_id = document.current_version_id
        assert document.status == "EXTRACTED" and document.active_index_id is None
        assert session.get(DocumentVersion, version_id).status == "EXTRACTED"
        job = session.get(Job, job_id)
        assert job.state == "FAILED" and job.error_code == "UNAVAILABLE"
        index_id = uuid.UUID(job.parameters["index_id"])
        assert (
            len(
                session.exec(
                    select(ChunkEmbedding).where(ChunkEmbedding.index_id == index_id)
                ).all()
            )
            == 4
        )
    repeated = client.post(
        path + "/index-local", headers=superuser_token_headers
    ).json()
    assert repeated["state"] == "FAILED" and repeated["job"]["id"] == str(job_id)
    provider.fail_after = None
    client.post(f"{path}/jobs/{job_id}/retry", headers=superuser_token_headers)
    process_job(str(job_id))
    with Session(engine) as session:
        document = session.get(Document, uploaded)
        chunks = session.exec(select(Chunk).where(Chunk.version_id == version_id)).all()
        vectors = session.exec(
            select(ChunkEmbedding).where(ChunkEmbedding.index_id == index_id)
        ).all()
        assert document.current_version_id == version_id
        assert document.active_index_id == index_id and document.status == "READY"
        assert len(vectors) == len(chunks) == len(provider.sent)


@pytest.mark.parametrize(
    "case", ["cloud", "remote_endpoint", "invalid_endpoint", "disabled"]
)
def test_no_implicit_cloud_or_disabled_index(
    uploaded, automatic, client, superuser_token_headers, monkeypatch, case
):
    if case == "cloud":
        monkeypatch.setattr(settings, "DEFAULT_EMBEDDING_PROVIDER", "gemini")
    elif case == "remote_endpoint":
        monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "https://remote.example")
    elif case == "invalid_endpoint":
        monkeypatch.setattr(settings, "LLAMACPP_BASE_URL", "http://[")
    else:
        monkeypatch.setattr(settings, "AUTO_INDEX_LOCAL", False)
    extract(uploaded)
    with Session(engine) as session:
        document = session.get(Document, uploaded)
        assert document.status == "EXTRACTED" and document.current_version_id
        assert (
            len(session.exec(select(Job).where(Job.document_id == uploaded)).all()) == 1
        )
    assert automatic[0].calls == 0
    result = client.post(
        f"/api/v1/documents/{uploaded}/index-local", headers=superuser_token_headers
    ).json()
    assert result["state"] == ("DISABLED" if case == "disabled" else "NOT_CONFIGURED")


@pytest.mark.parametrize("cloud", [False, True])
def test_single_workspace_embedding_routing_is_honored(
    uploaded, client, superuser_token_headers, cloud
):
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Local embedding scope"},
    ).json()
    try:
        client.put(
            f"/api/v1/workspaces/{workspace['id']}/documents/{uploaded}",
            headers=superuser_token_headers,
        )
        client.put(
            "/api/v1/providers/routing",
            headers=superuser_token_headers,
            json={
                "task": "embeddings",
                "scope_key": f"workspace:{workspace['id']}",
                "provider": "gemini" if cloud else "llamacpp",
                "model": "workspace-local",
                "timeout_seconds": 123,
            },
        )
        extract(uploaded)
        result = client.post(
            f"/api/v1/documents/{uploaded}/index-local", headers=superuser_token_headers
        ).json()
        if cloud:
            assert result["state"] == "NOT_CONFIGURED" and result["job"] is None
        else:
            assert result["state"] == "QUEUED"
            with Session(engine) as session:
                job = session.get(Job, uuid.UUID(result["job"]["id"]))
                assert job.parameters["model"] == "workspace-local"
                assert job.parameters["workspace_id"] == workspace["id"]
                assert job.parameters["timeout_seconds"] == 123
    finally:
        client.delete(
            f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
        )


def test_multiple_workspaces_use_personal_routing_without_arbitrary_selection(
    uploaded, client, superuser_token_headers
):
    workspaces = [
        client.post(
            "/api/v1/workspaces/",
            headers=superuser_token_headers,
            json={"name": f"Ambiguous scope {number}"},
        ).json()
        for number in range(2)
    ]
    try:
        for workspace in workspaces:
            client.put(
                f"/api/v1/workspaces/{workspace['id']}/documents/{uploaded}",
                headers=superuser_token_headers,
            )
            client.put(
                "/api/v1/providers/routing",
                headers=superuser_token_headers,
                json={
                    "task": "embeddings",
                    "scope_key": f"workspace:{workspace['id']}",
                    "provider": "gemini",
                    "model": "cloud-choice",
                },
            )
        extract(uploaded)
        result = client.post(
            f"/api/v1/documents/{uploaded}/index-local", headers=superuser_token_headers
        ).json()
        assert result["state"] == "QUEUED"
        with Session(engine) as session:
            job = session.get(Job, uuid.UUID(result["job"]["id"]))
            assert job.parameters["provider"] == "llamacpp"
            assert job.parameters["model"] == "local-whole-document"
            assert "workspace_id" not in job.parameters
    finally:
        for workspace in workspaces:
            client.delete(
                f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
            )


def test_page_without_readable_text_stays_degraded_instead_of_claiming_ready(
    automatic, client, superuser_token_headers, monkeypatch
):
    monkeypatch.setattr(settings, "ENABLE_OCR", False)
    with pymupdf.open() as pdf:
        pdf.new_page()
        payload = pdf.tobytes()
    result = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": ("blank.pdf", payload, "application/pdf")},
    ).json()
    identifier = uuid.UUID(result["id"])
    try:
        extract(identifier)
        prepared = client.post(
            f"/api/v1/documents/{identifier}/index-local",
            headers=superuser_token_headers,
        ).json()
        assert prepared["state"] == "NO_TEXT" and prepared["job"] is None
        assert (
            client.get(
                f"/api/v1/documents/{identifier}", headers=superuser_token_headers
            ).json()["status"]
            == "DEGRADED"
        )
        assert automatic[0].calls == 0
    finally:
        client.delete(
            f"/api/v1/documents/{identifier}", headers=superuser_token_headers
        )


def test_reuploading_old_extracted_document_prepares_once_without_new_version(
    uploaded, client, superuser_token_headers, monkeypatch
):
    monkeypatch.setattr(settings, "AUTO_INDEX_LOCAL", False)
    extract(uploaded)
    path = f"/api/v1/documents/{uploaded}"
    before = client.get(path, headers=superuser_token_headers).json()
    payload = client.get(path + "/file", headers=superuser_token_headers).content
    monkeypatch.setattr(settings, "AUTO_INDEX_LOCAL", True)
    for _attempt in range(2):
        response = client.post(
            "/api/v1/documents/",
            headers=superuser_token_headers,
            files={"file": ("same-content.pdf", payload, "application/pdf")},
        )
        assert response.status_code == 200
        assert response.json()["id"] == str(uploaded)
        assert response.json()["status"] == "INDEXING"
        assert response.json()["current_version_id"] == before["current_version_id"]
    with Session(engine) as session:
        assert (
            len(session.exec(select(Job).where(Job.document_id == uploaded)).all()) == 2
        )
