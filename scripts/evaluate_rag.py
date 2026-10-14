"""Opt-in live acceptance on synthetic fixtures; never sends private PDFs."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

parser = argparse.ArgumentParser()
parser.add_argument("--cloud", action="store_true", help="Authorize Gemini only for these synthetic fixtures")
parser.add_argument("--vision", action="store_true", help="Opt in to synthetic visual-region analysis")
parser.add_argument("--url", default="http://localhost:8000")
args = parser.parse_args()
if args.vision and not args.cloud:
    parser.error("--vision requires --cloud")
ROOT = Path(__file__).resolve().parents[1]
fixtures = ROOT / "backend" / "tests" / "fixtures"
credentials = dotenv_values(ROOT / ".env")
results = {"synthetic_data_only": True, "cloud_opt_in": args.cloud, "measurements": [], "providers": {}, "rag": {}}
client = httpx.Client(base_url=args.url + "/api/v1", timeout=120)


def request(method, url, **kwargs):
    response = client.request(method, url, **kwargs)
    response.raise_for_status()
    return response


def wait_job(document_id, job_id):
    start = time.monotonic()
    while time.monotonic() - start < 180:
        jobs = request("GET", f"/documents/{document_id}/jobs").json()
        job = next(value for value in jobs if value["id"] == job_id)
        if job["state"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
            results["measurements"].append({"kind": job["kind"], "seconds": round(time.monotonic() - start, 3), "state": job["state"], "error_code": job["error_code"]})
            if job["state"] != "SUCCEEDED":
                raise RuntimeError(f"Job failed: {job['error_code']}")
            return job
        time.sleep(0.75)
    raise RuntimeError("Job acceptance timeout")


def stream(conversation_id, question, **kwargs):
    start = time.monotonic()
    with client.stream("POST", f"/conversations/{conversation_id}/messages", json={"question": question, **kwargs}) as response:
        response.raise_for_status()
        name, done = "", None
        for line in response.iter_lines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
                if name == "error":
                    raise RuntimeError(data["code"])
                if name == "done":
                    done = data
    results["measurements"].append({"kind": "chat", "seconds": round(time.monotonic() - start, 3), "state": "COMPLETE" if done else "INCOMPLETE"})
    if not done:
        raise RuntimeError("Stream ended without persisted completion")
    return done


try:
    request("POST", "/login/access-token", data={"username": credentials["FIRST_SUPERUSER"], "password": credentials["FIRST_SUPERUSER_PASSWORD"]})
    catalog = request("GET", "/providers/").json()
    results["providers"] = {item["name"]: {"status": item["status"], "model_count": len(item["models"])} for item in catalog}
    existing = request("GET", "/workspaces/").json()
    workspace = next((row for row in existing if row["name"] == "Evaluación sintética"), None) or request("POST", "/workspaces/", json={"name": "Evaluación sintética", "description": "Fixtures públicos creados para verificar el sistema; no son documentos personales."}).json()
    results["workspace_id"] = workspace["id"]
    documents = {}
    for filename in ("digital_es.pdf", "english_conflict.pdf", "scanned.pdf", "crop_rotated.pdf"):
        source = (fixtures / filename).read_bytes()
        document = request("POST", "/documents/", files={"file": (filename, source, "application/pdf")}).json()
        documents[filename] = document
        if not document.get("current_version_id"):
            jobs = request("GET", f"/documents/{document['id']}/jobs").json()
            extraction_job = next(job for job in jobs if job["kind"] == "extract")
            wait_job(document["id"], extraction_job["id"])
        original = request("GET", f"/documents/{document['id']}/file").content
        assert hashlib.sha256(original).digest() == hashlib.sha256(source).digest()
        request("PUT", f"/workspaces/{workspace['id']}/documents/{document['id']}")
    results["documents"] = {name: request("GET", f"/documents/{document['id']}").json() for name, document in documents.items()}
    scan = request("GET", f"/documents/{documents['scanned.pdf']['id']}/pages/1/elements").json()
    results["ocr"] = {"verified": any("LUNA" in value["text"] for value in scan)}
    expected = json.loads((fixtures / "expected.json").read_text(encoding="utf-8"))
    if args.cloud:
        for name in ("digital_es.pdf", "english_conflict.pdf"):
            document_id = documents[name]["id"]
            for scope in ("embeddings", "chat"):
                request("POST", f"/documents/{document_id}/consents", json={"provider": "gemini", "scope": scope, "expires_in_days": 1})
            job = request("POST", f"/documents/{document_id}/index", json={"provider": "gemini", "model": "gemini-embedding-2", "dimensions": 768}).json()
            wait_job(document_id, job["id"])
        model = credentials.get("DEFAULT_CHAT_MODEL") or "gemini-2.5-flash"
        conversation = request("POST", f"/workspaces/{workspace['id']}/conversations", json={"title": "Aceptación real Gemini", "provider": "gemini", "model": model}).json()
        results["conversation_id"] = conversation["id"]
    recalls, reciprocal_ranks, page_accuracy, citation_coverage, invalid, numeric_accuracy = [], [], [], [], [], []
    for name in ("digital_es.pdf", "english_conflict.pdf"):
        for question in expected[name]["questions"]:
            document_id = documents[name]["id"]
            evidence = request("POST", f"/workspaces/{workspace['id']}/search", json={"question": question["question"], "document_ids": [document_id]}).json()
            ranks = [index + 1 for index, source in enumerate(evidence) if source["page_number"] == question["page"]]
            recalls.append(int(bool(ranks))); reciprocal_ranks.append(1 / min(ranks) if ranks else 0)
            page_accuracy.append(int(bool(evidence and evidence[0]["page_number"] == question["page"])))
            assert all(source["document_id"] == document_id for source in evidence)
            if args.cloud:
                answer = stream(conversation["id"], question["question"], document_ids=[document_id])
                citation_coverage.append(int(bool(answer["citations"])))
                import re
                expected_numbers = re.findall(r"\d+", question["answer"])
                correct = all(re.search(rf"\b{value}\b", answer["content"]) for value in expected_numbers)
                numeric_accuracy.append(int(correct))
                invalid.extend(source for source in answer["citations"] if not source.get("element_id") or source["document_id"] != document_id)
    results["rag"] = {"queries": len(recalls), "recall_at_8": sum(recalls) / len(recalls), "mrr": sum(reciprocal_ranks) / len(recalls),
                      "first_page_accuracy": sum(page_accuracy) / len(recalls), "citation_coverage": sum(citation_coverage) / len(citation_coverage) if citation_coverage else None,
                      "invalid_citations": len(invalid), "numeric_answer_accuracy": sum(numeric_accuracy) / len(numeric_accuracy) if numeric_accuracy else None,
                      "semantic_profile": "gemini-embedding-2/768" if args.cloud else "lexical-only"}
    if args.cloud:
        comparison = stream(conversation["id"], "Compara la capacidad solar reportada por los informes en español e inglés.", document_ids=[documents["digital_es.pdf"]["id"], documents["english_conflict.pdf"]["id"]])
        compared_ids = {source["document_id"] for source in comparison["citations"]}
        results["multidocument"] = {"answer": comparison["content"], "documents_cited": len(compared_ids)}
        if len(compared_ids) != 2 or "120" not in comparison["content"] or "90" not in comparison["content"]:
            raise RuntimeError("Contradictory-document comparison lacks both sources and values")
        missing = stream(conversation["id"], "¿Cuántos quásares de plutonio produce el proyecto?", document_ids=[documents['digital_es.pdf']['id']])
        results["no_evidence"] = {"answer": missing["content"], "sources": len(missing["citations"])}
        document_id = documents["digital_es.pdf"]["id"]
        for purpose in ("questions", "summary"):
            job = request("POST", f"/documents/{document_id}/enrichment", json={"purpose": purpose}).json()
            wait_job(document_id, job["id"])
        enrichment = request("GET", f"/documents/{document_id}/enrichment").json()
        results["enrichment"] = {"questions": len(enrichment["questions"]), "summary_persisted": bool(enrichment["summary"])}
        if len(enrichment["questions"]) != 5 or not enrichment["summary"]:
            raise RuntimeError("Enrichment acceptance failed")
        if args.vision:
            document_id = documents["digital_es.pdf"]["id"]
            request("POST", f"/documents/{document_id}/consents", json={"provider": "gemini", "scope": "vision", "expires_in_days": 1})
            elements = request("GET", f"/documents/{document_id}/pages/2/elements").json()
            figure = next(item for item in elements if item["element_type"] == "figure")
            answer = stream(conversation["id"], "¿De qué color y forma es la figura?", document_ids=[document_id], vision_element_id=figure["id"])
            results["vision"] = {"answer": answer["content"], "cited": any(value["element_id"] == figure["id"] for value in answer["citations"])}
            if not results["vision"]["cited"] or not any(word in answer["content"].lower() for word in ("verde", "green")):
                raise RuntimeError("Visual answer lacks the actual image-region evidence")
            request("POST", f"/documents/{document_id}/consents", json={"provider": "gemini", "scope": "multimodal_embeddings", "expires_in_days": 1})
            job = request("POST", f"/documents/{document_id}/index", json={"provider": "gemini", "model": "gemini-embedding-2", "dimensions": 768, "modality": "multimodal"}).json()
            wait_job(document_id, job["id"])
            results["multimodal_embeddings"] = {"state": "VERIFIED", "provider": "gemini", "model": "gemini-embedding-2", "dimensions": 768}
        if results["no_evidence"]["sources"] != 0:
            raise RuntimeError("An unsupported question was given source citations")
    if results["rag"]["recall_at_8"] < 1 or results["rag"]["invalid_citations"]:
        raise RuntimeError("Retrieval acceptance threshold failed")
    if args.cloud and results["rag"]["numeric_answer_accuracy"] != 1:
        raise RuntimeError("Known numeric answers failed acceptance")
    results["outcome"] = "PASSED"
except Exception as error:
    results["outcome"] = "FAILED"
    results["error_type"] = type(error).__name__
    results["error"] = str(error) if isinstance(error, RuntimeError) else "Acceptance request failed; inspect local service diagnostics."
finally:
    output = ROOT / "docs" / "evaluation-results.json"
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    client.close()
print(json.dumps({"outcome": results["outcome"], "rag": results["rag"], "error": results.get("error")}, ensure_ascii=False))
if results["outcome"] != "PASSED":
    raise SystemExit(1)
