"""Live CPU acceptance using a public synthetic PDF and local providers only."""

import argparse
import hashlib
import json
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8000")
    args = parser.parse_args()
    credentials = dotenv_values(ROOT / ".env")
    results = {
        "checked_at": datetime.now(UTC).isoformat(),
        "synthetic_data_only": True,
        "cloud_calls": 0,
        "measurements": [],
        "status": "FAILED",
    }
    with httpx.Client(base_url=args.url + "/api/v1", timeout=180) as client:

        def request(method, url, **kwargs):
            response = client.request(method, url, **kwargs)
            response.raise_for_status()
            return response

        def wait_job(document_id, job_id):
            started = time.monotonic()
            while time.monotonic() - started < 180:
                job = next(
                    row
                    for row in request("GET", f"/documents/{document_id}/jobs").json()
                    if row["id"] == job_id
                )
                if job["state"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
                    results["measurements"].append(
                        {
                            "kind": job["kind"],
                            "state": job["state"],
                            "seconds": round(time.monotonic() - started, 3),
                        }
                    )
                    assert job["state"] == "SUCCEEDED", job["error_code"]
                    return
                time.sleep(0.75)
            raise RuntimeError("Local job timed out")

        request(
            "POST",
            "/login/access-token",
            data={
                "username": credentials["FIRST_SUPERUSER"],
                "password": credentials["FIRST_SUPERUSER_PASSWORD"],
            },
        )
        results["diagnostics"] = request("GET", "/providers/diagnostics").json()
        assert results["diagnostics"]["parser"] == "docling-native"
        existing = request("GET", "/workspaces/").json()
        workspace = next(
            (row for row in existing if row["name"] == "Verificación local Docling"),
            None,
        )
        if not workspace:
            workspace = request(
                "POST",
                "/workspaces/",
                json={
                    "name": "Verificación local Docling",
                    "description": "PDF sintético público; Docling, EmbeddingGemma2 y chat CPU locales.",
                },
            ).json()
        results["workspace_id"] = workspace["id"]
        # Distinguish this acceptance fixture from older PyMuPDF versions with the same hash.
        source = (
            ROOT / "backend/tests/fixtures/digital_es.pdf"
        ).read_bytes() + b"\n% renpdf-docling-native-local-v1\n"
        document = request(
            "POST",
            "/documents/",
            files={
                "file": ("docling-local-synthetic.pdf", source, "application/pdf"),
            },
        ).json()
        document_id = document["id"]
        results["document_id"] = document_id
        if not document["current_version_id"]:
            job = next(
                row
                for row in request("GET", f"/documents/{document_id}/jobs").json()
                if row["kind"] == "extract"
            )
            wait_job(document_id, job["id"])
        assert (
            hashlib.sha256(
                request("GET", f"/documents/{document_id}/file").content
            ).digest()
            == hashlib.sha256(source).digest()
        )
        request("PUT", f"/workspaces/{workspace['id']}/documents/{document_id}")
        job = request(
            "POST",
            f"/documents/{document_id}/index",
            json={
                "provider": "llamacpp",
                "model": "embeddinggemma-2-q8_0",
                "dimensions": 768,
            },
        ).json()
        wait_job(document_id, job["id"])

        # Inspect only this synthetic fixture's persisted parser/profile/vector metadata.
        from sqlmodel import Session, col, select

        from app.core.db import engine
        from app.domain import (
            Chunk,
            ChunkEmbedding,
            Document,
            DocumentIndex,
            DocumentVersion,
            EmbeddingProfile,
        )

        with Session(engine) as session:
            persisted = session.get(Document, uuid.UUID(document_id))
            assert (
                persisted and persisted.current_version_id and persisted.active_index_id
            )
            version = session.get(DocumentVersion, persisted.current_version_id)
            index = session.get(DocumentIndex, persisted.active_index_id)
            assert version and version.parser_name == "docling-native"
            assert index and index.status == "READY"
            profile = session.get(EmbeddingProfile, index.profile_id)
            assert (
                profile and profile.provider == "llamacpp" and profile.dimensions == 768
            )
            chunks = session.exec(
                select(Chunk).where(col(Chunk.version_id) == version.id)
            ).all()
            vectors = session.exec(
                select(ChunkEmbedding).where(col(ChunkEmbedding.index_id) == index.id)
            ).all()
            assert len(chunks) == len(vectors) > 0
            assert all(len(row.embedding) == 768 for row in vectors)
            results["index"] = {
                "parser": version.parser_name,
                "parser_version": version.parser_version,
                "chunk_profiles": sorted({row.chunking_profile for row in chunks}),
                "chunks": len(chunks),
                "vectors": len(vectors),
                "provider": profile.provider,
                "model": profile.model,
                "model_version": profile.model_version,
                "dimensions": profile.dimensions,
                "state": index.status,
            }
        request(
            "PUT",
            "/providers/routing",
            json={
                "scope_key": f"workspace:{workspace['id']}",
                "task": "chat",
                "provider": "ollama",
                "model": "gemma4:e2b",
                "timeout_seconds": 180,
                "max_tokens": 128,
            },
        )
        conversation = request(
            "POST",
            f"/workspaces/{workspace['id']}/conversations",
            json={
                "title": "Comprobación CPU con citas",
                "provider": "ollama",
                "model": "gemma4:e2b",
            },
        ).json()
        results["conversation_id"] = conversation["id"]
        question = "¿Cuál es la capacidad solar instalada?"
        evidence = request(
            "POST",
            f"/workspaces/{workspace['id']}/search",
            json={
                "question": question,
                "document_ids": [document_id],
            },
        ).json()
        assert evidence and any(row["page_number"] == 1 for row in evidence)
        started, event, done = time.monotonic(), "", None
        with client.stream(
            "POST",
            f"/conversations/{conversation['id']}/messages",
            json={
                "question": question,
                "document_ids": [document_id],
            },
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if line.startswith("event: "):
                    event = line[7:]
                elif line.startswith("data: "):
                    data = json.loads(line[6:])
                    if event == "error":
                        raise RuntimeError(data["code"])
                    if event == "done":
                        done = data
        assert done and "120" in done["content"] and done["citations"]
        messages = request(
            "GET", f"/conversations/{conversation['id']}/messages"
        ).json()
        answer = next(row for row in reversed(messages) if row["role"] == "assistant")
        assert answer["state"] == "COMPLETE" and answer["retrieval_mode"] == "hybrid"
        assert all(
            row["document_id"] == document_id and row["element_id"]
            for row in answer["citations"]
        )
        results["chat"] = {
            "provider": answer["provider"],
            "model": answer["model"],
            "state": answer["state"],
            "retrieval_mode": answer["retrieval_mode"],
            "seconds": round(time.monotonic() - started, 3),
            "cited_sources": len(answer["citations"]),
            "expected_value_verified": True,
        }
        results["status"] = "PASSED"
    (ROOT / "docs/local-evaluation-results.json").write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    sys.stdout.write(
        json.dumps(
            {
                "status": results["status"],
                "index": results["index"],
                "chat": results["chat"],
            },
            ensure_ascii=False,
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
