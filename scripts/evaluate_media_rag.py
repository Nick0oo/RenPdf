"""Live Gemini acceptance with invented speech and color video only (--cloud)."""

import argparse
import json
import subprocess
import sys
import time
import wave
from datetime import UTC, datetime
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.parsing.media import run_media_tool  # noqa: E402


def fixtures():
    folder = ROOT / "tmp" / "media-acceptance"
    folder.mkdir(parents=True, exist_ok=True)
    speech = folder / "speech.wav"
    if not speech.is_file():
        # Offline OS speech synthesis; no account data or downloaded media.
        command = """Add-Type -AssemblyName System.Speech
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SetOutputToWaveFile($args[0])
$voice.Speak('Project Aurora has a budget of seven hundred thirty one dollars.')
$voice.Dispose()
"""
        helper = folder / "speech.ps1"
        helper.write_text(command, encoding="utf-8")
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-File", str(helper), str(speech)], check=True, timeout=30, capture_output=True)
    audio = folder / "Aurora-minute.wav"
    with wave.open(str(speech), "rb") as source, wave.open(str(audio), "wb") as output:
        output.setparams(source.getparams())
        output.writeframes(b"\0" * (60 * source.getframerate() * source.getnchannels() * source.getsampwidth()))
        output.writeframes(source.readframes(source.getnframes()))
    video = folder / "Aurora-colors.mp4"
    run_media_tool("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=10:d=10", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=10:d=2", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", str(video)])
    return audio, video


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cloud", action="store_true")
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if not args.cloud:
        parser.error("Use --cloud to send only these invented fixtures to Gemini")
    audio, video = fixtures()
    credentials = dotenv_values(ROOT / ".env")
    result = {"synthetic_data_only": True, "date": datetime.now(UTC).isoformat(), "checks": {}}
    report = ROOT / "docs" / "media-rag-results.json"
    if args.resume and report.is_file():
        result = json.loads(report.read_text(encoding="utf-8"))
    client = httpx.Client(base_url=args.url + "/api/v1", timeout=180)

    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        response.raise_for_status()
        return response

    def settled(identifier, ignore_previous_index_failure=False):
        deadline = time.monotonic() + 480
        retries = 0
        while time.monotonic() < deadline:
            jobs = request("GET", f"/documents/{identifier}/jobs").json()
            if not any(job["state"] in {"QUEUED", "RUNNING"} for job in jobs):
                if jobs and jobs[0]["state"] != "SUCCEEDED":
                    if ignore_previous_index_failure and jobs[0]["kind"] == "index":
                        existing = request("GET", f"/documents/{identifier}").json()
                        if existing["current_version_id"]:
                            return existing
                    if jobs[0]["error_code"] in {"PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT"} and retries < 3:
                        retries += 1
                        print(f"Retrying transient {jobs[0]['kind']} failure at checkpoint {jobs[0]['checkpoint']}", flush=True)
                        request("POST", f"/documents/{identifier}/jobs/{jobs[0]['id']}/retry")
                        continue
                    raise RuntimeError(json.dumps({"state": jobs[0]["state"], "code": jobs[0]["error_code"], "stage": jobs[0]["stage"]}))
                return request("GET", f"/documents/{identifier}").json()
            time.sleep(1)
        raise RuntimeError("Synthetic media processing timeout")

    def grant(identifier, scope):
        request("POST", f"/documents/{identifier}/consents", json={"provider": "gemini", "scope": scope, "expires_in_days": 1})

    def ask(conversation, identifiers, question):
        for attempt in range(3):
            response = request("POST", f"/conversations/{conversation}/messages", json={"question": question, "document_ids": identifiers})
            if "event: done" in response.text:
                break
            if not any(code in response.text for code in ("PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT")) or attempt == 2:
                raise RuntimeError(response.text)
            print("Retrying a transient chat connection failure; failed trace is retained", flush=True)
        answer = request("GET", f"/conversations/{conversation}/messages").json()[-1]
        assert answer["state"] == "COMPLETE" and answer["citations"], answer
        trace = request("GET", f"/trace/responses/{answer['id']}/context").json()
        assert trace["query"] == question and trace["sources"]
        print(f"Answered: {question}", flush=True)
        return {"id": answer["id"], "question": question, "answer": answer["content"], "citations": answer["citations"], "retrieval_mode": answer["retrieval_mode"], "trace_source_count": len(trace["sources"])}

    try:
        request("POST", "/login/access-token", data={"username": credentials["FIRST_SUPERUSER"], "password": credentials["FIRST_SUPERUSER_PASSWORD"]})
        catalog = request("GET", "/providers/").json()
        gemini = next(item for item in catalog if item["name"] == "gemini")
        models = {item["id"] for item in gemini["models"]}
        routing = request("GET", "/providers/routing").json()
        model = next((row["model"] for row in routing if row["task"] == "chat" and row["provider"] == "gemini" and row["model"] in models), None)
        model = model or next(value for value in [credentials.get("DEFAULT_CHAT_MODEL"), "gemini-2.5-flash"] if value in models)
        result["analysis_model"] = model
        workspace = {"id": result["workspace_id"]} if args.resume else request("POST", "/workspaces/", json={"name": "Audio y video · verificación temporal", "description": "Fuentes inventadas: presupuesto Aurora al minuto 1 y cambio azul a rojo en el segundo 10."}).json()
        result["workspace_id"] = workspace["id"]
        identifiers = []
        for path in (audio, video):
            with path.open("rb") as source:
                document = request("POST", f"/documents/?workspace_id={workspace['id']}", files={"file": (path.name, source)}).json()
            identifier = document["id"]
            identifiers.append(identifier)
            request("PUT", f"/workspaces/{workspace['id']}/documents/{identifier}")
            prepared = settled(identifier, ignore_previous_index_failure=True)
            playback = request("GET", f"/documents/{identifier}/playback", headers={"Range": "bytes=0-99"})
            assert playback.status_code == 206
            if not prepared["current_version_id"]:
                assert prepared["status"] == "MEDIA_READY"
                for scope in ("media_analysis", "chat"):
                    grant(identifier, scope)
                request("POST", f"/documents/{identifier}/analyze", json={"provider": "gemini", "model": model})
                settled(identifier)
            coverage = request("GET", f"/documents/{identifier}/coverage").json()
            assert coverage["segments_analyzed"] == coverage["segments_total"] > 0
            result["sources"] = [item for item in result.get("sources", []) if item["id"] != identifier] + [{"id": identifier, "title": path.name, "coverage": coverage}]
            print(f"Analyzed {path.name}: {coverage['segments_analyzed']} segments", flush=True)
        conversation = request("POST", f"/workspaces/{workspace['id']}/conversations", json={"provider": "gemini", "model": model}).json()
        result["conversation_id"] = conversation["id"]
        answer = ask(conversation["id"], [identifiers[0]], "¿Cuál es el presupuesto de Aurora que se escucha en 01:02? Cita la evidencia.")
        assert "731" in answer["answer"] or "setecientos" in answer["answer"].lower(), answer
        assert any(citation["start_seconds"] == 60 and citation["page_number"] is None for citation in answer["citations"])
        result["checks"]["audio_minute_one"] = answer
        answer = ask(conversation["id"], [identifiers[1]], "¿Qué color se ve en 00:11 del video? Cita la evidencia.")
        assert "rojo" in answer["answer"].lower(), answer
        assert all(citation["start_seconds"] == 10 for citation in answer["citations"])
        result["checks"]["video_second_eleven"] = answer
        answer = ask(conversation["id"], identifiers, "Compara las dos fuentes: ¿cuál es el presupuesto de Aurora en el audio y qué cambio de color ocurre en el video? Cita ambas fuentes.")
        assert {citation["document_id"] for citation in answer["citations"]} == set(identifiers)
        result["checks"]["cross_media"] = answer
        # Native audio/video embeddings must work as well as local text vectors.
        embedding_model = next((value for value in [credentials.get("DEFAULT_EMBEDDING_MODEL"), "gemini-embedding-2", "gemini-embedding-2-preview"] if value in models and "embedding-2" in value), None)
        assert embedding_model, "Gemini Embedding 2 not configured"
        for identifier in identifiers:
            for scope in ("embeddings", "multimodal_embeddings"):
                grant(identifier, scope)
            request("POST", f"/documents/{identifier}/index", json={"provider": "gemini", "model": embedding_model, "modality": "multimodal", "dimensions": 768})
            settled(identifier)
        answer = ask(conversation["id"], identifiers, "¿Qué presupuesto se menciona en la grabación y cómo cambia el fondo del video? Cita ambas fuentes.")
        assert answer["retrieval_mode"] == "hybrid", answer
        assert {citation["document_id"] for citation in answer["citations"]} == set(identifiers)
        result["checks"]["native_multimodal_embeddings"] = answer
        result["embedding_model"] = embedding_model
        for source in result["sources"]:
            source["local_text_coverage"] = source["coverage"]
            source["coverage"] = request("GET", f"/documents/{source['id']}/coverage").json()
        sources = request("GET", f"/trace/rag/sources?workspace_id={workspace['id']}").json()
        queries = request("GET", f"/trace/rag/queries?workspace_id={workspace['id']}").json()
        assert sources["total"] == 2 and queries["total"] >= 4
        result["checks"]["module_records"] = {"sources": sources["total"], "queries": queries["total"]}
        result["passed"] = True
        result["finished_at"] = datetime.now(UTC).isoformat()
        result.pop("error", None)
        print("All real media acceptance checks passed", flush=True)
    except Exception as error:
        result["passed"] = False
        result["error"] = str(error)
        raise
    finally:
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        client.close()


if __name__ == "__main__":
    main()
