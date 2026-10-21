"""Live acceptance using invented PDFs only; --cloud authorizes those fixtures."""

import argparse
import io
import json
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pymupdf
from dotenv import dotenv_values
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cloud", action="store_true")
    parser.add_argument("--url", default="http://localhost:8000")
    args = parser.parse_args()
    if not args.cloud:
        parser.error("This synthetic live Gemini acceptance requires --cloud")
    credentials = dotenv_values(ROOT / ".env")
    results = {
        "synthetic_data_only": True,
        "date": datetime.now(UTC).isoformat(),
        "checks": {},
    }
    client = httpx.Client(base_url=args.url + "/api/v1", timeout=180)

    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        response.raise_for_status()
        return response

    def wait_document(identifier):
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            document = request("GET", f"/documents/{identifier}").json()
            jobs = request("GET", f"/documents/{identifier}/jobs").json()
            pending = any(job["state"] in {"QUEUED", "RUNNING"} for job in jobs)
            if not pending:
                if not document["current_version_id"]:
                    raise RuntimeError("Synthetic extraction failed")
                return document
            time.sleep(1)
        raise RuntimeError("Synthetic document processing timed out")

    def ask(conversation, identifiers, question):
        done = None
        started = time.monotonic()
        with client.stream(
            "POST",
            f"/conversations/{conversation}/messages",
            json={"question": question, "document_ids": identifiers},
        ) as response:
            response.raise_for_status()
            name = ""
            for line in response.iter_lines():
                if line.startswith("event: "):
                    name = line[7:]
                elif line.startswith("data: "):
                    payload = json.loads(line[6:])
                    if name == "error":
                        raise RuntimeError(payload["code"])
                    if name == "done":
                        done = payload
        if not done:
            raise RuntimeError("Synthetic answer was not completed")
        answer = request("GET", f"/conversations/{conversation}/messages").json()[-1]
        assert answer["state"] == "COMPLETE" and answer["citations"]
        return answer, round(time.monotonic() - started, 2)

    try:
        request(
            "POST",
            "/login/access-token",
            data={
                "username": credentials["FIRST_SUPERUSER"],
                "password": credentials["FIRST_SUPERUSER_PASSWORD"],
            },
        )
        catalog = request("GET", "/providers/").json()
        gemini = next(provider for provider in catalog if provider["name"] == "gemini")
        models = {model["id"] for model in gemini["models"]}
        routing = request("GET", "/providers/routing").json()
        model = next(
            (
                row["model"]
                for row in routing
                if row["task"] == "chat"
                and row["provider"] == "gemini"
                and row["model"] in models
            ),
            None,
        )
        model = model or next(
            (
                value
                for value in [credentials.get("DEFAULT_CHAT_MODEL"), "gemini-2.5-flash"]
                if value in models
            ),
            None,
        )
        if not model:
            raise RuntimeError("No configured Gemini chat model available")
        workspace = request(
            "POST",
            "/workspaces/",
            json={
                "name": "Verificación de RAG visual y comparación",
                "description": "Documentos inventados: figuras y cifras para comprobar citas y trazabilidad.",
            },
        ).json()
        results["workspace_id"] = workspace["id"]
        image = Image.new("RGB", (160, 160), "white")
        ImageDraw.Draw(image).polygon([(80, 10), (10, 150), (150, 150)], fill="green")
        png = io.BytesIO()
        image.save(png, format="PNG")
        identifiers = []
        for title, value in (
            ("Informe inicial", 120),
            ("Corrección independiente", 90),
        ):
            with pymupdf.open() as pdf:
                page = pdf.new_page()
                page.insert_text(
                    (40, 50), f"{title}: energia anual reportada {value} MWh."
                )
                if value == 120:
                    page.insert_image(
                        pymupdf.Rect(80, 120, 240, 280), stream=png.getvalue()
                    )
                    page = pdf.new_page()
                    page.insert_text(
                        (40, 50),
                        "Figura B: evidencia visual sin descripcion de forma o color.",
                    )
                    page.draw_circle(
                        pymupdf.Point(180, 220), 70, color=(1, 0, 0), fill=(1, 0, 0)
                    )
                payload = pdf.tobytes() + f"\n% synthetic {uuid.uuid4()}".encode()
            document = request(
                "POST",
                "/documents/",
                files={"file": (title + ".pdf", payload, "application/pdf")},
            ).json()
            identifiers.append(document["id"])
            request("PUT", f"/workspaces/{workspace['id']}/documents/{document['id']}")
            wait_document(document["id"])
            for scope in ("chat", "vision", "embeddings", "multimodal_embeddings"):
                request(
                    "POST",
                    f"/documents/{document['id']}/consents",
                    json={"provider": "gemini", "scope": scope, "expires_in_days": 1},
                )
        results["document_ids"] = identifiers
        conversation = request(
            "POST",
            f"/workspaces/{workspace['id']}/conversations",
            json={
                "title": "Figuras y contradicciones con fuentes reales",
                "provider": "gemini",
                "model": model,
            },
        ).json()
        results["conversation_id"] = conversation["id"]
        results["chat_model"] = model
        answer, seconds = ask(
            conversation["id"],
            identifiers[:1],
            "¿Qué forma y color tiene la figura de la página 2? Describe lo que ves.",
        )
        assert "rojo" in answer["content"].lower() and (
            "círculo" in answer["content"].lower()
            or "circulo" in answer["content"].lower()
        ), answer["content"]
        assert answer["usage"]["trace"]["visual_coverage"]["sent"] >= 1
        assert any(source["page_number"] == 2 for source in answer["citations"])
        results["checks"]["local_index_visual_chat"] = {
            "passed": True,
            "seconds": seconds,
            "profiles": answer["usage"]["trace"]["retrieval"].get("used_profiles", []),
        }
        for identifier in identifiers:
            request(
                "POST",
                f"/documents/{identifier}/index",
                json={
                    "provider": "gemini",
                    "model": "gemini-embedding-2",
                    "dimensions": 768,
                    "modality": "multimodal",
                },
            )
            wait_document(identifier)
        coverage = request("GET", f"/documents/{identifiers[0]}/coverage").json()
        assert coverage["figures_total"] == coverage["figures_multimodal_indexed"] == 2
        results["checks"]["multimodal_index_coverage"] = {
            "passed": True,
            "coverage": coverage,
        }
        answer, seconds = ask(
            conversation["id"],
            identifiers[:1],
            "¿Qué forma y color tiene la imagen de la página 1?",
        )
        assert (
            "verde" in answer["content"].lower() and "tri" in answer["content"].lower()
        ), answer["content"]
        results["checks"]["native_multimodal_retrieval"] = {
            "passed": True,
            "seconds": seconds,
        }
        answer, seconds = ask(
            conversation["id"],
            identifiers,
            "Compara la energía anual reportada por ambos documentos. ¿Qué cifra da cada fuente y cuál es la diferencia? Cita ambos.",
        )
        assert (
            "120" in answer["content"]
            and "90" in answer["content"]
            and "30" in answer["content"]
        ), answer["content"]
        assert {source["document_id"] for source in answer["citations"]} == set(
            identifiers
        )
        context = request("GET", f"/trace/responses/{answer['id']}/context").json()
        assert context["query"] and context["coverage"]["with_evidence"] == 2
        assert {source["document_id"] for source in context["sources"]} == set(
            identifiers
        )
        results["checks"]["cross_document_comparison_and_trace"] = {
            "passed": True,
            "seconds": seconds,
            "citations": len(answer["citations"]),
            "context_sources": len(context["sources"]),
        }
        results["passed"] = True
    finally:
        client.close()
        destination = ROOT / "docs" / "workspace-rag-results.json"
        destination.write_text(
            json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            json.dumps(
                {
                    "passed": results.get("passed", False),
                    "checks": list(results["checks"]),
                    "result_file": str(destination),
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
