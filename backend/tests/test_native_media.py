"""Native media indexes, atomic reindexing, clip reuse and grounded chat context."""
# ruff: noqa: F811 -- pytest discovers the imported shared fixture.

import json
import uuid

from sqlmodel import Session, col, select

from app.core.db import engine
from app.domain import Document, DocumentIndex, DocumentVersion, Job
from app.services.models.contracts import (
    ModelCapabilities,
    ModelDescriptor,
    ModelRoutingPolicy,
    ProviderError,
)
from app.services.models.providers import GeminiProvider, NativeEmbeddingProvider
from app.workers.tasks import process_job
from tests.test_media_rag import grant, media_source  # noqa: F401


def test_overview_budget_keeps_both_native_sources(tmp_path, monkeypatch):
    import hashlib
    from types import SimpleNamespace

    from app.schemas.research import EvidencePublic
    from app.services.rag.native_context import native_context
    from app.services.rag.retrieval import is_document_overview

    assert is_document_overview("De que trata el audio y de que trata el video?")
    assert is_document_overview("¿En qué se diferencian estos documentos?")
    assert is_document_overview("¿De qué trata cada documento y en qué se diferencian?")
    assert not is_document_overview("¿De qué trata la propuesta de energía solar?")
    clip = tmp_path / "clip.mp3"
    clip.write_bytes(b"synthetic-native-budget")
    elements = {}
    sources = []
    documents = [uuid.uuid4(), uuid.uuid4()]
    for document in documents:
        for offset in range(4):
            element_id = uuid.uuid4()
            elements[element_id] = SimpleNamespace(
                start_seconds=offset * 10,
                end_seconds=(offset + 1) * 10,
                structured_content={
                    "native_reference": True,
                    "media_key": "clip.mp3",
                    "clip_sha256": hashlib.sha256(clip.read_bytes()).hexdigest(),
                    "mime_type": "audio/mpeg",
                },
            )
            sources.append(
                EvidencePublic(
                    chunk_id=uuid.uuid4(),
                    element_id=element_id,
                    document_id=document,
                    version_id=uuid.uuid4(),
                    document_title="Source",
                    page_number=None,
                    source_type="audio",
                    text="Native reference",
                    bbox=None,
                    rotation=0,
                )
            )
    monkeypatch.setattr(
        "app.services.rag.native_context.LocalStorage",
        lambda: SimpleNamespace(path=lambda _key: clip),
    )
    selected, media, metadata = native_context(
        SimpleNamespace(get=lambda _model, identifier: elements[identifier]), sources
    )
    assert len(media) == 6 and metadata["omitted"] == 2
    assert [source.document_id for source in selected] == documents * 3
    assert [source.label for source in selected] == list(range(1, 7))
    assert metadata["duration_seconds"] == 60


class LocalNative(NativeEmbeddingProvider):
    def __init__(self):
        self.calls = []
        self.fail = False
        self.version = "native-test-v1"

    def discover(self):
        return [
            ModelDescriptor(
                id="embeddinggemma-2-native",
                provider="embeddinggemma",
                version=self.version,
                capabilities=ModelCapabilities(
                    embeddings="declared", audio="declared", video="declared"
                ),
            )
        ]

    def embed_multimodal(
        self, model, inputs, dimensions, *, before_send=None, query=False
    ):
        if before_send:
            before_send()
        if self.fail:
            raise ProviderError("TEST_INTERRUPTION", "Test interruption")
        self.calls.extend(inputs)
        assert all(not item.text and item.media and item.media.data for item in inputs)
        return [[1.0] + [0.0] * (dimensions - 1) for _item in inputs]

    def embed(self, model, texts, dimensions, *, query=False):
        assert query
        return [[1.0] + [0.0] * (dimensions - 1) for _item in texts]


def prepare(
    client,
    headers,
    identifier,
    provider="embeddinggemma",
    model="embeddinggemma-2-native",
):
    result = client.post(
        f"/api/v1/documents/{identifier}/prepare-native",
        headers=headers,
        json={
            "provider": provider,
            "model": model,
            "dimensions": 128,
            "modality": "multimodal",
        },
    )
    assert result.status_code == 200, result.text
    process_job(result.json()["id"])
    with Session(engine) as session:
        job = session.get(Job, uuid.UUID(result.json()["id"]))
        assert job.state == "SUCCEEDED", (job.error_code, job.error_message)
        following = session.exec(
            select(Job)
            .where(
                col(Job.document_id) == uuid.UUID(identifier), col(Job.kind) == "index"
            )
            .order_by(col(Job.created_at).desc())
        ).first()
        return following.id


def test_native_local_skips_generation_preserves_old_index_and_reuses_clips(
    media_source, client, superuser_token_headers, monkeypatch
):
    identifier = media_source["id"]
    provider = LocalNative()
    monkeypatch.setattr("app.workers.tasks.enqueue", lambda _job: None)
    monkeypatch.setattr(
        "app.workers.tasks.get_provider", lambda *_args, **_kwargs: provider
    )
    monkeypatch.setattr(
        "app.services.documents.index_cache.get_provider",
        lambda *_args, **_kwargs: provider,
    )
    index_job = prepare(client, superuser_token_headers, identifier)
    with Session(engine) as session:
        assert session.get(Document, uuid.UUID(identifier)).current_version_id is None
    process_job(str(index_job))
    with Session(engine) as session:
        assert session.get(Job, index_job).state == "SUCCEEDED"
        document = session.get(Document, uuid.UUID(identifier))
        old_version, old_index = document.current_version_id, document.active_index_id
    coverage = client.get(
        f"/api/v1/documents/{identifier}/coverage", headers=superuser_token_headers
    ).json()
    assert (
        coverage["analysis_mode"] == "native_embeddings"
        and coverage["segments_analyzed"] == 0
    )
    assert coverage["segments_prepared"] == coverage["segments_indexed"] == 3
    assert len(provider.calls) == 3
    rejected = client.post(
        f"/api/v1/documents/{identifier}/index",
        headers=superuser_token_headers,
        json={
            "provider": "embeddinggemma",
            "model": "embeddinggemma-2-native",
            "dimensions": 128,
            "modality": "text",
        },
    )
    assert rejected.status_code == 422
    # Repeating the same profile on the same version does not send embeddings again.
    same = client.post(
        f"/api/v1/documents/{identifier}/index",
        headers=superuser_token_headers,
        json={
            "provider": "embeddinggemma",
            "model": "embeddinggemma-2-native",
            "dimensions": 128,
            "modality": "multimodal",
        },
    ).json()
    process_job(same["id"])
    assert same["state"] == "SUCCEEDED"
    assert len(provider.calls) == 3
    with Session(engine) as session:
        assert session.get(Document, uuid.UUID(identifier)).active_index_id == old_index
    # A second native version keeps previous queries available until all vectors exist.
    provider.version = "native-test-v2"
    second = prepare(client, superuser_token_headers, identifier)
    pending_coverage = client.get(
        f"/api/v1/documents/{identifier}/coverage", headers=superuser_token_headers
    ).json()
    assert pending_coverage["segments_indexed"] == 0
    assert pending_coverage["active_index_ready"]
    provider.fail = True
    process_job(str(second))
    with Session(engine) as session:
        document = session.get(Document, uuid.UUID(identifier))
        assert (document.current_version_id, document.active_index_id) == (
            old_version,
            old_index,
        )
        pending = session.get(Job, second)
        assert pending.state == "FAILED"
        version = session.get(DocumentVersion, pending.version_id)
        assert version.artifact_manifest["clips_reused"] == 3
        assert session.get(DocumentIndex, old_index).status == "READY"
    provider.fail = False
    retry = client.post(
        f"/api/v1/documents/{identifier}/jobs/{second}/retry",
        headers=superuser_token_headers,
    )
    assert retry.status_code == 200, retry.text
    process_job(str(second))
    with Session(engine) as session:
        document = session.get(Document, uuid.UUID(identifier))
        assert (
            document.current_version_id != old_version
            and document.active_index_id != old_index
        )
    chunks = client.get(
        f"/api/v1/trace/documents/{identifier}/chunks", headers=superuser_token_headers
    ).json()["data"]
    assert all(item["analysis"]["native_reference"] for item in chunks)
    assert "media_key" not in json.dumps(chunks)
    # A further reindex of unchanged clips/profile never invokes the model.
    calls_before = len(provider.calls)
    provider.fail = True
    monkeypatch.setattr(
        "app.services.documents.index_cache.reusable_index", lambda *_args: None
    )
    cached_job = prepare(client, superuser_token_headers, identifier)
    process_job(str(cached_job))
    with Session(engine) as session:
        cached = session.get(Job, cached_job)
        assert cached.state == "SUCCEEDED"
        assert cached.parameters.get("vectors_reused") == 3 or cached.parameters.get(
            "reused_existing_index"
        )
    assert len(provider.calls) == calls_before


def test_native_gemini_requires_embedding_scopes_but_no_transcription_permission(
    media_source, client, superuser_token_headers, monkeypatch
):
    identifier = media_source["id"]
    body = {
        "provider": "gemini",
        "model": "gemini-embedding-2",
        "dimensions": 128,
        "modality": "multimodal",
    }
    path = f"/api/v1/documents/{identifier}/prepare-native"
    assert (
        client.post(path, headers=superuser_token_headers, json=body).status_code == 409
    )
    grant(client, superuser_token_headers, identifier, "embeddings")
    assert (
        client.post(path, headers=superuser_token_headers, json=body).status_code == 409
    )
    grant(client, superuser_token_headers, identifier, "multimodal_embeddings")

    class CloudNative(GeminiProvider):
        def discover(self):
            return [
                ModelDescriptor(
                    id="gemini-embedding-2",
                    provider="gemini",
                    version="test",
                    capabilities=ModelCapabilities(embeddings="declared"),
                )
            ]

        embed_multimodal = LocalNative.embed_multimodal

    provider = CloudNative()
    provider.calls, provider.fail = [], False
    monkeypatch.setattr("app.workers.tasks.enqueue", lambda _job: None)
    monkeypatch.setattr(
        "app.workers.tasks.get_provider", lambda *_args, **_kwargs: provider
    )
    job = prepare(
        client, superuser_token_headers, identifier, "gemini", "gemini-embedding-2"
    )
    process_job(str(job))
    assert len(provider.calls) == 3
    with Session(engine) as session:
        assert session.get(Job, job).state == "SUCCEEDED"


def test_native_chat_reads_retrieved_clip_and_traces_its_timestamp(
    media_source, client, superuser_token_headers, monkeypatch
):
    identifier = media_source["id"]
    provider = LocalNative()
    monkeypatch.setattr("app.workers.tasks.enqueue", lambda _job: None)
    monkeypatch.setattr(
        "app.workers.tasks.get_provider", lambda *_args, **_kwargs: provider
    )
    monkeypatch.setattr(
        "app.services.rag.retrieval.get_provider", lambda *_args, **_kwargs: provider
    )
    index_job = prepare(client, superuser_token_headers, identifier)
    process_job(str(index_job))
    grant(client, superuser_token_headers, identifier, "chat")
    from app.services.rag.retrieval import retrieve

    with Session(engine) as session:
        diagnostics = {}
        evidence, _mode = retrieve(
            session,
            [uuid.UUID(identifier)],
            "Compara 00:12 y 00:21",
            diagnostics=diagnostics,
        )
        assert {item.start_seconds for item in evidence} == {10, 20}
        assert diagnostics["requested_times_seconds"] == [12, 21]

    class NativeChat:
        is_cloud = True

        def discover(self):
            return [
                ModelDescriptor(
                    id="native-chat-test",
                    provider="gemini",
                    version="chat-v1",
                    capabilities=ModelCapabilities(text="declared", audio="declared"),
                )
            ]

        def stream(self, request):
            context = json.loads(request.prompt)
            assert len(request.media) == 1 and request.media[0].data
            assert context["media"][0]["start_seconds"] == 10
            assert context["media"][0]["end_seconds"] == 20
            yield f"Se escucha un tono. [Fuente {context['media'][0]['source_id']}]"

    monkeypatch.setattr(
        "app.services.rag.chat.get_provider", lambda *_args: NativeChat()
    )
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Native temporal context"},
    ).json()
    try:
        client.put(
            f"/api/v1/workspaces/{workspace['id']}/documents/{identifier}",
            headers=superuser_token_headers,
        )
        conversation = client.post(
            f"/api/v1/workspaces/{workspace['id']}/conversations",
            headers=superuser_token_headers,
            json={"provider": "gemini", "model": "native-chat-test"},
        ).json()
        response = client.post(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
            json={"question": "¿Qué se oye en 00:12?", "document_ids": [identifier]},
        )
        assert "event: done" in response.text, response.text
        answer = client.get(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
        ).json()[-1]
        assert answer["citations"][0]["start_seconds"] == 10
        trace = answer["usage"]["trace"]
        assert trace["input_modality"] == "native_media"
        assert trace["native_media"]["clips"][0]["clip_sha256"]
        assert trace["inference_attempted"] and trace["consent_verified"]

        class NativeSummary(NativeChat):
            def stream(self, request):
                context = json.loads(request.prompt)
                assert len(request.media) == len(context["media"]) == 3
                yield "Resumen parcial: se escuchan tonos. [Fuente 1]"

        monkeypatch.setattr(
            "app.services.rag.enrichment.get_provider", lambda *_args: NativeSummary()
        )
        with Session(engine) as session:
            summary = Job(
                document_id=uuid.UUID(identifier),
                kind="summary",
                parameters={"provider": "gemini", "model": "native-chat-test"},
            )
            session.add(summary)
            session.commit()
            summary_id = summary.id
        process_job(str(summary_id))
        with Session(engine) as session:
            job = session.get(Job, summary_id)
            assert job.state == "SUCCEEDED", job.error_code
            document = session.get(Document, uuid.UUID(identifier))
            manifest = session.get(
                DocumentVersion, document.current_version_id
            ).artifact_manifest
            assert len(manifest["native_enrichment"]["clips"]) == 3
    finally:
        client.delete(
            f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
        )


def test_local_policy_automatically_prepares_uploaded_media(
    media_source, client, superuser_token_headers, monkeypatch
):
    from app.core.config import settings

    provider = LocalNative()
    enqueued = []
    monkeypatch.setattr(settings, "AUTO_INDEX_LOCAL", True)
    monkeypatch.setattr(settings, "EMBEDDINGGEMMA_BASE_URL", "http://127.0.0.1:8082")
    monkeypatch.setattr(
        "app.services.models.routing.resolve_policy",
        lambda *_args: ModelRoutingPolicy(
            provider="embeddinggemma", model="embeddinggemma-2-native"
        ),
    )
    monkeypatch.setattr(
        "app.workers.tasks.enqueue", lambda job: enqueued.append(job.id)
    )
    monkeypatch.setattr(
        "app.workers.tasks.get_provider", lambda *_args, **_kwargs: provider
    )
    with Session(engine) as session:
        job = Job(document_id=uuid.UUID(media_source["id"]), kind="extract")
        session.add(job)
        session.commit()
        identifier = job.id
    process_job(str(identifier))
    process_job(str(enqueued[-1]))
    process_job(str(enqueued[-1]))
    coverage = client.get(
        f"/api/v1/documents/{media_source['id']}/coverage",
        headers=superuser_token_headers,
    ).json()
    assert coverage["analysis_mode"] == "native_embeddings"
    assert coverage["segments_indexed"] == 3
    assert coverage["segments_analyzed"] == 0
