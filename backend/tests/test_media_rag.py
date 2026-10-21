"""Real local decoding, temporal RAG, cloud boundaries and checkpoint recovery."""

import io
import json
import math
import struct
import tempfile
import uuid
import wave

import pymupdf
import pytest
from sqlmodel import Session, col, select

from app.core.db import engine
from app.domain import Document, DocumentPage, DocumentVersion, Job
from app.services.models.contracts import (
    ModelCapabilities,
    ModelDescriptor,
    ProviderError,
)
from app.services.parsing.media import has_audio_signal, inspect_media, run_media_tool
from app.services.rag.retrieval import retrieve
from app.workers.tasks import process_job


def wav_bytes(seconds=22):
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        tone = b"".join(
            struct.pack("<h", int(5000 * math.sin(index * 2 * math.pi * 220 / 8000)))
            for index in range(8000)
        )
        audio.writeframes(tone * seconds)
    return output.getvalue()


@pytest.fixture
def media_source(client, superuser_token_headers, monkeypatch):
    monkeypatch.setattr("app.api.routes.documents.enqueue", lambda _job: None)
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": (f"meeting-{uuid.uuid4()}.wav", wav_bytes(), "audio/wav")},
    )
    assert response.status_code == 200, response.text
    document = response.json()
    with Session(engine) as session:
        job = session.exec(
            select(Job).where(col(Job.document_id) == uuid.UUID(document["id"]))
        ).one()
        process_job(str(job.id))
        session.expire_all()
        assert session.get(Job, job.id).state == "SUCCEEDED"
    yield document
    client.delete(
        f"/api/v1/documents/{document['id']}", headers=superuser_token_headers
    )


class NativeProvider:
    is_cloud = True

    def __init__(self):
        self.calls = []
        self.fail_at = None

    def discover(self):
        return [
            ModelDescriptor(
                id="native-test",
                provider="gemini",
                version="test-v1",
                capabilities=ModelCapabilities(text="declared"),
            )
        ]

    def stream(self, request):
        self.calls.append(request)
        if self.fail_at == len(self.calls):
            raise ProviderError("TEMPORARY", "Synthetic provider interruption")
        assert not request.images and len(request.media) == 1
        assert request.media[0].mime_type == "audio/mpeg"
        with tempfile.TemporaryDirectory() as directory:
            from pathlib import Path

            clip = Path(directory) / "clip.mp3"
            clip.write_bytes(request.media[0].data)
            assert inspect_media(clip)["duration_seconds"] <= 10.2
        yield json.dumps(
            {
                "transcript": "El proyecto Aurora tiene presupuesto de 731 pesos.",
                "audio_description": "Voz",
                "visual_description": "",
            }
        )


def grant(client, headers, identifier, scope):
    response = client.post(
        f"/api/v1/documents/{identifier}/consents",
        headers=headers,
        json={"provider": "gemini", "scope": scope},
    )
    assert response.status_code == 200, response.text
    return response.json()


def analyze(client, headers, identifier, monkeypatch, provider):
    monkeypatch.setattr(
        "app.services.parsing.media_analysis.get_provider", lambda _name: provider
    )
    result = client.post(
        f"/api/v1/documents/{identifier}/analyze",
        headers=headers,
        json={"provider": "gemini", "model": "native-test"},
    )
    assert result.status_code == 200, result.text
    process_job(result.json()["id"])
    return result.json()


def test_upload_prepares_seekable_playback_without_cloud_or_fake_pages(
    media_source, client, superuser_token_headers, normal_user_token_headers
):
    identifier = media_source["id"]
    current = client.get(
        f"/api/v1/documents/{identifier}", headers=superuser_token_headers
    ).json()
    assert current["source_type"] == "audio" and current["page_count"] == 0
    assert current["duration_seconds"] == 22
    assert current["status"] == "MEDIA_READY" and current["current_version_id"] is None
    playback = client.get(
        f"/api/v1/documents/{identifier}/playback",
        headers={**superuser_token_headers, "Range": "bytes=0-99"},
    )
    assert playback.status_code == 206 and len(playback.content) == 100
    assert playback.headers["content-type"] == "audio/mpeg"
    assert (
        client.get(
            f"/api/v1/documents/{identifier}/playback",
            headers=normal_user_token_headers,
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/v1/documents/{identifier}/segments", headers=superuser_token_headers
        ).json()["data"]
        == []
    )
    # Chat permission does not authorize sending the original media for analysis.
    grant(client, superuser_token_headers, identifier, "chat")
    response = client.post(
        f"/api/v1/documents/{identifier}/analyze",
        headers=superuser_token_headers,
        json={"provider": "gemini", "model": "native-test"},
    )
    assert (
        response.status_code == 409 and response.json()["code"] == "CONSENT_REQUIRED"
    ), response.text


def test_analysis_preserves_actual_boundaries_and_temporal_rag_in_its_module(
    media_source,
    client,
    superuser_token_headers,
    normal_user_token_headers,
    monkeypatch,
):
    identifier = media_source["id"]
    grant(client, superuser_token_headers, identifier, "media_analysis")
    grant(client, superuser_token_headers, identifier, "chat")
    provider = NativeProvider()
    job = analyze(client, superuser_token_headers, identifier, monkeypatch, provider)
    assert len(provider.calls) == 3
    segments = client.get(
        f"/api/v1/documents/{identifier}/segments", headers=superuser_token_headers
    ).json()["data"]
    assert [(item["start_seconds"], item["end_seconds"]) for item in segments] == [
        (0, 10),
        (10, 20),
        (20, 22),
    ]
    coverage = client.get(
        f"/api/v1/documents/{identifier}/coverage", headers=superuser_token_headers
    ).json()
    assert coverage["segments_analyzed"] == coverage["segments_total"] == 3
    assert coverage["temporal_precision_seconds"] == 10
    assert coverage["analysis_model"] == "native-test"
    with Session(engine) as session:
        assert session.get(Job, uuid.UUID(job["id"])).state == "SUCCEEDED"
        document = session.get(Document, uuid.UUID(identifier))
        units = session.exec(
            select(DocumentPage).where(
                col(DocumentPage.version_id) == document.current_version_id
            )
        ).all()
        assert len(units) == 3 and all(unit.unit_kind == "segment" for unit in units)
        diagnostics = {}
        sources, _mode = retrieve(
            session,
            [document.id],
            "¿Qué presupuesto menciona Aurora en 00:12?",
            diagnostics=diagnostics,
        )
        assert sources and all(
            item.start_seconds == 10 and item.end_seconds == 20 for item in sources
        )
        assert all(
            item.page_number is None and item.source_type == "audio" for item in sources
        )
        assert diagnostics["requested_time_seconds"] == 12
    chunk_response = client.get(
        f"/api/v1/trace/documents/{identifier}/chunks?second=12",
        headers=superuser_token_headers,
    )
    assert chunk_response.status_code == 200, chunk_response.text
    chunks = chunk_response.json()["data"]
    assert len(chunks) == 1 and chunks[0]["start_seconds"] == 10
    assert chunks[0]["analysis"]["model"] == "native-test"
    assert "media_key" not in json.dumps(chunks)

    # A real answer, trace and query must be accessible from the new RAG module.
    class ChatProvider:
        is_cloud = False
        discover = provider.discover

        def stream(self, request):
            context = json.loads(request.prompt)
            evidence = context["evidence"][0]
            assert evidence["page_number"] is None and evidence["start_seconds"] == 10
            yield f"Aurora tiene 731 pesos. [Fuente {evidence['source_id']}]"

    monkeypatch.setattr(
        "app.services.rag.chat.get_provider", lambda *_args: ChatProvider()
    )
    workspace = client.post(
        "/api/v1/workspaces/",
        headers=superuser_token_headers,
        json={"name": "Temporal acceptance"},
    ).json()
    try:
        client.put(
            f"/api/v1/workspaces/{workspace['id']}/documents/{identifier}",
            headers=superuser_token_headers,
        )
        conversation = client.post(
            f"/api/v1/workspaces/{workspace['id']}/conversations",
            headers=superuser_token_headers,
            json={"provider": "gemini", "model": "native-test"},
        ).json()
        question = "¿Qué presupuesto menciona Aurora en 00:12?"
        response = client.post(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
            json={"question": question, "document_ids": [identifier]},
        )
        assert "event: done" in response.text, response.text
        answer = client.get(
            f"/api/v1/conversations/{conversation['id']}/messages",
            headers=superuser_token_headers,
        ).json()[-1]
        assert answer["citations"][0]["start_seconds"] == 10
        context = client.get(
            f"/api/v1/trace/responses/{answer['id']}/context",
            headers=superuser_token_headers,
        ).json()
        assert (
            context["sources"][0]["start_seconds"] == 10
            and context["query"] == question
        )
        queries = client.get(
            f"/api/v1/trace/rag/queries?workspace_id={workspace['id']}&q=Aurora",
            headers=superuser_token_headers,
        )
        assert queries.status_code == 200, queries.text
        assert queries.json()["data"][0]["query"] == question
        source_list = client.get(
            f"/api/v1/trace/rag/sources?workspace_id={workspace['id']}&source_type=audio",
            headers=superuser_token_headers,
        )
        assert source_list.status_code == 200, source_list.text
        assert source_list.json()["data"][0]["chunks"] == 3
        for path in (
            f"trace/rag/sources?workspace_id={workspace['id']}",
            f"trace/rag/queries?workspace_id={workspace['id']}",
            f"trace/documents/{identifier}/chunks",
            f"documents/{identifier}/segments",
        ):
            assert (
                client.get(
                    f"/api/v1/{path}", headers=normal_user_token_headers
                ).status_code
                == 404
            )
    finally:
        client.delete(
            f"/api/v1/workspaces/{workspace['id']}", headers=superuser_token_headers
        )


def test_analysis_failure_retry_keeps_checkpoint_and_does_not_publish_partial_version(
    media_source, client, superuser_token_headers, monkeypatch
):
    identifier = media_source["id"]
    grant(client, superuser_token_headers, identifier, "media_analysis")
    provider = NativeProvider()
    provider.fail_at = 2
    job = analyze(client, superuser_token_headers, identifier, monkeypatch, provider)
    with Session(engine) as session:
        failed = session.get(Job, uuid.UUID(job["id"]))
        assert failed.state == "FAILED" and failed.checkpoint == 1
        assert session.get(Document, uuid.UUID(identifier)).current_version_id is None
        version_id = failed.version_id
    coverage = client.get(
        f"/api/v1/documents/{identifier}/coverage", headers=superuser_token_headers
    ).json()
    assert coverage["segments_analyzed"] == 1
    assert coverage["version_id"] is None and coverage["analysis_complete"] is False
    assert coverage["processing"]["state"] == "FAILED"
    assert coverage["processing"]["error_code"] == "TEMPORARY"
    provider.fail_at = None
    retried = client.post(
        f"/api/v1/documents/{identifier}/jobs/{job['id']}/retry",
        headers=superuser_token_headers,
    )
    assert retried.status_code == 200
    process_job(job["id"])
    assert len(provider.calls) == 4  # Completed first segment was never re-sent.
    with Session(engine) as session:
        assert session.get(Job, uuid.UUID(job["id"])).state == "SUCCEEDED"
        assert (
            session.get(Document, uuid.UUID(identifier)).current_version_id
            == version_id
        )
        assert (
            len(
                session.exec(
                    select(DocumentVersion).where(
                        col(DocumentVersion.document_id) == uuid.UUID(identifier)
                    )
                ).all()
            )
            == 1
        )
        assert (
            len(
                session.exec(
                    select(DocumentPage).where(
                        col(DocumentPage.version_id) == version_id
                    )
                ).all()
            )
            == 3
        )


def test_known_text_image_model_is_rejected_before_sending_audio(
    media_source, client, superuser_token_headers
):
    identifier = media_source["id"]
    grant(client, superuser_token_headers, identifier, "media_analysis")
    response = client.post(
        f"/api/v1/documents/{identifier}/analyze",
        headers=superuser_token_headers,
        json={"provider": "gemini", "model": "gemma-4-31b-it"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "MEDIA_MODEL_UNSUPPORTED"
    assert "no admite entrada de audio" in response.json()["detail"]
    assert (
        len(
            client.get(
                f"/api/v1/documents/{identifier}/jobs", headers=superuser_token_headers
            ).json()
        )
        == 1
    )


def test_media_dispatch_uses_a_queue_independent_of_long_pdf_jobs(
    media_source, monkeypatch
):
    from app.workers.tasks import enqueue

    calls = []
    monkeypatch.setattr(
        "app.workers.tasks.process_task.apply_async",
        lambda **kwargs: calls.append(kwargs),
    )
    with Session(engine) as session:
        audio = session.get(Document, uuid.UUID(media_source["id"]))
        pdf = Document(
            owner_id=audio.owner_id,
            title="Queue PDF",
            original_filename="queue.pdf",
            storage_key=f"test/{uuid.uuid4()}.pdf",
            sha256=uuid.uuid4().hex,
            file_size=1,
            page_count=1,
        )
        session.add(pdf)
        session.commit()
        try:
            enqueue(Job(document_id=audio.id, kind="extract"))
            enqueue(Job(document_id=audio.id, kind="media_analysis"))
            enqueue(Job(document_id=audio.id, kind="index"))
            enqueue(Job(document_id=pdf.id, kind="extract"))
            assert [call["queue"] for call in calls] == [
                "media",
                "media",
                "index",
                "extract",
            ]
        finally:
            session.delete(pdf)
            session.commit()


def test_browser_webm_without_duration_is_measured_from_packets(tmp_path):
    path = tmp_path / "browser.webm"
    run_media_tool(
        "ffmpeg",
        [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x64:r=10",
            "-t",
            "2",
            "-c:v",
            "libvpx",
            "-f",
            "webm",
            "-live",
            "1",
            str(path),
        ],
    )
    inspected = inspect_media(path)
    assert inspected["source_type"] == "video"
    assert inspected["duration_seconds"] == pytest.approx(2, abs=0.2)


def test_digital_silence_does_not_send_clips_or_invent_a_transcript(
    media_source, client, superuser_token_headers, monkeypatch
):
    identifier = media_source["id"]
    grant(client, superuser_token_headers, identifier, "media_analysis")
    provider = NativeProvider()
    monkeypatch.setattr(
        "app.services.parsing.media_analysis.has_audio_signal", lambda _key: False
    )
    analyze(client, superuser_token_headers, identifier, monkeypatch, provider)
    assert not provider.calls
    chunks = client.get(
        f"/api/v1/trace/documents/{identifier}/chunks", headers=superuser_token_headers
    ).json()["data"]
    assert len(chunks) == 3
    assert all(
        item["analysis"]["provider"] == "local"
        and item["analysis"]["usage"]["status"] == "NOT_INVOKED"
        for item in chunks
    )


def test_real_silence_detection_is_local_and_keeps_actual_sound(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.parsing.media.LocalStorage.path",
        lambda _self, key: tmp_path / key,
    )
    silent = io.BytesIO()
    with wave.open(silent, "wb") as audio:
        audio.setparams((1, 2, 8000, 8000, "NONE", "not compressed"))
        audio.writeframes(b"\0\0" * 8000)
    (tmp_path / "silence.wav").write_bytes(silent.getvalue())
    (tmp_path / "tone.wav").write_bytes(wav_bytes(1))
    assert not has_audio_signal("silence.wav")
    assert has_audio_signal("tone.wav")


def test_revocation_stops_before_the_next_clip_send(
    media_source, client, superuser_token_headers, monkeypatch
):
    identifier = media_source["id"]
    consent = grant(client, superuser_token_headers, identifier, "media_analysis")
    provider = NativeProvider()
    original_stream = provider.stream

    def revoke_during_first_send(request):
        yield from original_stream(request)
        client.delete(
            f"/api/v1/documents/{identifier}/consents/{consent['id']}",
            headers=superuser_token_headers,
        )

    provider.stream = revoke_during_first_send
    job = analyze(client, superuser_token_headers, identifier, monkeypatch, provider)
    assert len(provider.calls) == 1
    with Session(engine) as session:
        failure = session.get(Job, uuid.UUID(job["id"]))
        assert failure.checkpoint == 1 and failure.error_code == "CONSENT_REQUIRED"
        assert session.get(Document, uuid.UUID(identifier)).current_version_id is None
    retry = client.post(
        f"/api/v1/documents/{identifier}/jobs/{job['id']}/retry",
        headers=superuser_token_headers,
    )
    assert retry.status_code == 409


def test_media_limits_and_untrusted_playlists_are_rejected(tmp_path, monkeypatch):
    path = tmp_path / "audio.wav"
    path.write_bytes(wav_bytes(2))
    monkeypatch.setattr(
        "app.services.parsing.media.settings.MAX_MEDIA_DURATION_SECONDS", 1
    )
    with pytest.raises(ValueError, match="MEDIA_DURATION_LIMIT"):
        inspect_media(path)
    path.write_bytes(b"#EXTM3U\nhttp://127.0.0.1/private")
    with pytest.raises(ValueError, match="UNSUPPORTED_SOURCE_FORMAT"):
        inspect_media(path)


def test_pdf_page_and_media_timestamp_filters_coexist_in_one_query(
    media_source, client, superuser_token_headers, monkeypatch
):
    identifier = media_source["id"]
    grant(client, superuser_token_headers, identifier, "media_analysis")
    analyze(client, superuser_token_headers, identifier, monkeypatch, NativeProvider())
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((40, 50), "Aurora presupuesto PDF 999 pesos")
        pdf.new_page().insert_text(
            (40, 50), "Aurora presupuesto PDF actualizado 800 pesos"
        )
        payload = pdf.tobytes()
    response = client.post(
        "/api/v1/documents/",
        headers=superuser_token_headers,
        files={"file": ("mixed-aurora.pdf", payload, "application/pdf")},
    )
    assert response.status_code == 200
    pdf_id = uuid.UUID(response.json()["id"])
    try:
        with Session(engine) as session:
            job = session.exec(select(Job).where(col(Job.document_id) == pdf_id)).one()
            process_job(str(job.id))
            sources, _mode = retrieve(
                session,
                [pdf_id, uuid.UUID(identifier)],
                "Compara el presupuesto de Aurora de la página 1 del PDF con el audio en 00:12",
            )
            assert {item.document_id for item in sources} == {
                pdf_id,
                uuid.UUID(identifier),
            }
            assert all(
                item.page_number == 1 for item in sources if item.source_type == "pdf"
            )
            assert all(
                item.page_number is None
                and item.start_seconds == 10
                and item.end_seconds == 20
                for item in sources
                if item.source_type == "audio"
            )
    finally:
        client.delete(f"/api/v1/documents/{pdf_id}", headers=superuser_token_headers)
