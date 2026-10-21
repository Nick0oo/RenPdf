"""Live native embeddings and temporal chat using invented fixtures only (--cloud)."""

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cloud", action="store_true")
    args = parser.parse_args()
    if not args.cloud:
        parser.error("Use --cloud to send only invented fixtures to Gemini")
    credentials = dotenv_values(ROOT / ".env")
    report = {
        "synthetic_data_only": True,
        "started_at": datetime.now(UTC).isoformat(),
        "providers": {},
        "answers": [],
    }
    client = httpx.Client(base_url="http://localhost:8000/api/v1", timeout=180)

    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        response.raise_for_status()
        return response

    def settled(identifier, ignore_previous_failure=False):
        deadline = time.monotonic() + 900
        retries = 0
        while time.monotonic() < deadline:
            jobs = request("GET", f"/documents/{identifier}/jobs").json()
            pending = [job for job in jobs if job["state"] in {"QUEUED", "RUNNING"}]
            if not pending:
                if jobs and jobs[0]["state"] != "SUCCEEDED":
                    if ignore_previous_failure:
                        existing = request("GET", f"/documents/{identifier}").json()
                        if existing.get("active_index_id"):
                            return existing
                    if (
                        jobs[0]["error_code"]
                        in {
                            "PROVIDER_UNAVAILABLE",
                            "PROVIDER_TIMEOUT",
                            "QUOTA_EXCEEDED",
                        }
                        and retries < 2
                    ):
                        retries += 1
                        print(
                            f"Retrying transient native {jobs[0]['kind']} failure at checkpoint {jobs[0]['checkpoint']}",
                            flush=True,
                        )
                        request(
                            "POST",
                            f"/documents/{identifier}/jobs/{jobs[0]['id']}/retry",
                        )
                        continue
                    raise RuntimeError(
                        json.dumps(
                            {
                                key: jobs[0][key]
                                for key in [
                                    "kind",
                                    "state",
                                    "error_code",
                                    "error_message",
                                    "checkpoint",
                                ]
                            }
                        )
                    )
                return request("GET", f"/documents/{identifier}").json()
            time.sleep(2)
        raise RuntimeError("Synthetic native indexing timeout")

    request(
        "POST",
        "/login/access-token",
        data={
            "username": credentials["FIRST_SUPERUSER"],
            "password": credentials["FIRST_SUPERUSER_PASSWORD"],
        },
    )
    catalog = request("GET", "/providers/").json()
    local = next(item for item in catalog if item["name"] == "embeddinggemma")
    assert local["status"] == "AVAILABLE", local
    workspace = request(
        "POST",
        "/workspaces/",
        json={"name": "Validación embeddings nativos — audio y video"},
    ).json()
    report["workspace_id"] = workspace["id"]
    documents = []
    for name in ["Aurora-minute.wav", "Aurora-colors.mp4"]:
        path = ROOT / "tmp/media-acceptance" / name
        document = request(
            "POST",
            "/documents/",
            files={
                "file": (
                    f"Native-{name}",
                    path.read_bytes(),
                    "audio/wav" if name.endswith("wav") else "video/mp4",
                )
            },
        ).json()
        settled(document["id"], ignore_previous_failure=True)
        request("PUT", f"/workspaces/{workspace['id']}/documents/{document['id']}")
        for scope in ["chat", "embeddings", "multimodal_embeddings"]:
            request(
                "POST",
                f"/documents/{document['id']}/consents",
                json={"provider": "gemini", "scope": scope, "expires_in_days": 1},
            )
        documents.append(document)
    for provider, model in [
        ("embeddinggemma", "embeddinggemma-2-native"),
        ("gemini", "gemini-embedding-2"),
    ]:
        started = time.monotonic()
        coverages = []
        for document in documents:
            identifier = document["id"]
            before = request("GET", f"/documents/{identifier}").json()
            request(
                "POST",
                f"/documents/{identifier}/prepare-native",
                json={
                    "provider": provider,
                    "model": model,
                    "dimensions": 768,
                    "modality": "multimodal",
                },
            )
            during = request("GET", f"/documents/{identifier}").json()
            assert during["active_index_id"] == before["active_index_id"]
            settled(identifier)
            coverage = request("GET", f"/documents/{identifier}/coverage").json()
            assert (
                coverage["analysis_mode"] == "native_embeddings"
                and coverage["segments_analyzed"] == 0
            )
            assert coverage["segments_indexed"] == coverage["segments_total"] > 0
            coverages.append(coverage)
        report["providers"][provider] = {
            "model": model,
            "elapsed_seconds": round(time.monotonic() - started, 2),
            "coverage": coverages,
        }
        conversation = request(
            "POST",
            f"/workspaces/{workspace['id']}/conversations",
            json={
                "provider": "gemini",
                "model": "gemini-3.8-flash",
                "title": f"Clips recuperados desde {provider}",
            },
        ).json()
        for question in [
            "¿Qué presupuesto menciona Aurora en el audio en 01:02?",
            "Compara lo que dice el audio en 01:02 con el color que aparece en el video en 00:11. Cita ambas fuentes.",
        ]:
            response = request(
                "POST",
                f"/conversations/{conversation['id']}/messages",
                json={
                    "question": question,
                    "document_ids": [item["id"] for item in documents],
                },
            )
            if "event: done" not in response.text:
                raise RuntimeError(response.text)
            answer = request(
                "GET", f"/conversations/{conversation['id']}/messages"
            ).json()[-1]
            assert answer["state"] == "COMPLETE" and answer["citations"], answer
            trace = answer["usage"]["trace"]
            assert (
                trace["input_modality"] == "native_media"
                and trace["native_media"]["clips"]
            )
            assert any(item["start_seconds"] == 60 for item in answer["citations"])
            if question.startswith("Compara"):
                assert {item["source_type"] for item in answer["citations"]} == {
                    "audio",
                    "video",
                }
            report["answers"].append(
                {
                    "provider": provider,
                    "question": question,
                    "answer": answer["content"],
                    "citations": answer["citations"],
                    "trace": trace,
                }
            )
            print(
                f"Verified {provider}: native clips, timestamps and citations",
                flush=True,
            )
        (ROOT / "docs/native-media-results.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    # Return to the local profile: clip/vector reuse should require no encoding.
    started = time.monotonic()
    for document in documents:
        request(
            "POST",
            f"/documents/{document['id']}/prepare-native",
            json={
                "provider": "embeddinggemma",
                "model": "embeddinggemma-2-native",
                "dimensions": 768,
                "modality": "multimodal",
            },
        )
        settled(document["id"])
    report["cached_local_reindex_seconds"] = round(time.monotonic() - started, 2)
    report["passed"] = True
    report["finished_at"] = datetime.now(UTC).isoformat()
    (ROOT / "docs/native-media-results.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "passed": True,
                "workspace_id": workspace["id"],
                "cached_local_reindex_seconds": report["cached_local_reindex_seconds"],
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
