"""Verify automatic local PDF image embeddings and grounded vision (--cloud)."""

import argparse
import io
import json
import time
from pathlib import Path

import httpx
import pymupdf
from dotenv import dotenv_values
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cloud", action="store_true")
    args = parser.parse_args()
    if not args.cloud:
        parser.error("Use --cloud to send only the invented red figure to Gemini")
    report_path = ROOT / "docs/native-media-results.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    credentials = dotenv_values(ROOT / ".env")
    client = httpx.Client(base_url="http://localhost:8000/api/v1", timeout=180)

    def request(method, path, **kwargs):
        response = client.request(method, path, **kwargs)
        response.raise_for_status()
        return response

    request(
        "POST",
        "/login/access-token",
        data={
            "username": credentials["FIRST_SUPERUSER"],
            "password": credentials["FIRST_SUPERUSER_PASSWORD"],
        },
    )
    workspace = report["workspace_id"]
    request(
        "PUT",
        "/providers/routing",
        json={
            "scope_key": f"workspace:{workspace}",
            "task": "embeddings",
            "provider": "embeddinggemma",
            "model": "embeddinggemma-2-native",
            "timeout_seconds": 300,
        },
    )
    picture = io.BytesIO()
    Image.new("RGB", (320, 180), "red").save(picture, "PNG")
    with pymupdf.open() as pdf:
        page = pdf.new_page(width=400, height=260)
        page.insert_text((30, 25), "Figura de prueba")
        page.insert_image(pymupdf.Rect(30, 50, 350, 230), stream=picture.getvalue())
        payload = pdf.tobytes()
    document = request(
        "POST",
        f"/documents/?workspace_id={workspace}",
        files={"file": ("Native-image-proof.pdf", payload, "application/pdf")},
    ).json()
    identifier = document["id"]
    request("PUT", f"/workspaces/{workspace}/documents/{identifier}")
    report["native_pdf"] = {"passed": False, "document_id": identifier}
    report["passed"] = False
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        current = request("GET", f"/documents/{identifier}").json()
        jobs = request("GET", f"/documents/{identifier}/jobs").json()
        if current["active_index_id"]:
            break
        if jobs and jobs[0]["state"] == "FAILED":
            raise RuntimeError(
                json.dumps(
                    {
                        key: jobs[0][key]
                        for key in ["kind", "error_code", "error_message"]
                    }
                )
            )
        time.sleep(2)
    coverage = request("GET", f"/documents/{identifier}/coverage").json()
    assert current["active_index_id"] and coverage["figures_multimodal_indexed"] == 1, (
        coverage
    )
    for scope in ["chat", "vision"]:
        request(
            "POST",
            f"/documents/{identifier}/consents",
            json={"provider": "gemini", "scope": scope, "expires_in_days": 1},
        )
    conversation = request(
        "POST",
        f"/workspaces/{workspace}/conversations",
        json={
            "provider": "gemini",
            "model": "gemini-3.8-flash",
            "title": "Figura PDF con embedding local nativo",
        },
    ).json()
    response = request(
        "POST",
        f"/conversations/{conversation['id']}/messages",
        json={
            "question": "¿De qué color es la figura del documento?",
            "document_ids": [identifier],
        },
    )
    assert "event: done" in response.text, response.text
    answer = request("GET", f"/conversations/{conversation['id']}/messages").json()[-1]
    trace = answer["usage"]["trace"]
    assert "roj" in answer["content"].lower() and answer["citations"]
    assert answer["citations"][0]["page_number"] == 1
    assert trace["vision"]["image_count"] == 1
    assert any(
        profile["provider"] == "embeddinggemma" and profile["modality"] == "multimodal"
        for profile in trace["retrieval"]["used_profiles"]
    )
    report["native_pdf"] = {
        "passed": True,
        "document_id": identifier,
        "coverage": coverage,
        "answer": answer["content"],
        "citations": answer["citations"],
        "trace": trace,
    }
    report["passed"] = True
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "passed": True,
                "native_pdf": identifier,
                "figures_multimodal_indexed": coverage["figures_multimodal_indexed"],
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
