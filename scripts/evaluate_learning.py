"""Generate real AI study material from the existing invented PDF acceptance set."""
# ruff: noqa: T201 -- executable acceptance report.

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]


def check_native(client: httpx.Client) -> dict:
    fixture = json.loads((ROOT / "docs/native-media-results.json").read_text())
    assert fixture["synthetic_data_only"]
    identifiers = [
        row["document_id"] for row in fixture["providers"]["embeddinggemma"]["coverage"]
    ]
    started = time.monotonic()
    response = client.post(
        "/learning/generate",
        json={
            "workspace_id": fixture["workspace_id"],
            "kind": "deck",
            "document_ids": identifiers,
            "provider": "gemini",
            "model": "gemini-3.8-flash",
            "count": 3,
            "title": "Repaso audiovisual Aurora · validación IA",
        },
    )
    response.raise_for_status()
    result = response.json()
    evidence = [source for card in result["cards"] for source in card["evidences"]]
    assert len(result["cards"]) == 3
    assert {source["source_type"] for source in evidence} == {"audio", "video"}
    budget_cards = [card for card in result["cards"] if "731" in card["answer"]]
    assert budget_cards and all(
        any(
            source["source_type"] == "audio" and source["start_seconds"] == 60
            for source in card["evidences"]
        )
        for card in budget_cards
    ), "The spoken budget must cite the clip at 01:00, not an earlier silent clip"
    return {
        "passed": True,
        "seconds": round(time.monotonic() - started, 2),
        "deck_id": result["deck"]["id"],
        "message_id": result["message_id"],
        "cards": 3,
        "minute_citation_correct": True,
        "intervals": [
            {
                key: source.get(key)
                for key in ["source_type", "start_seconds", "end_seconds"]
            }
            for source in evidence
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cloud", action="store_true")
    parser.add_argument(
        "--native", action="store_true", help="Also verify invented native audio/video"
    )
    parser.add_argument(
        "--native-only",
        action="store_true",
        help="Append native verification to the existing report",
    )
    args = parser.parse_args()
    if not args.cloud:
        parser.error("Use --cloud to authorize only these invented acceptance PDFs")
    fixture = json.loads((ROOT / "docs/workspace-rag-results.json").read_text())
    env = dotenv_values(ROOT / ".env")
    report = {
        "synthetic_data_only": True,
        "started_at": datetime.now(UTC).isoformat(),
        "checks": [],
    }
    if args.native_only and (ROOT / "docs/learning-ai-results.json").exists():
        report = json.loads((ROOT / "docs/learning-ai-results.json").read_text())
        assert report["synthetic_data_only"]
    with httpx.Client(base_url="http://localhost:8000/api/v1", timeout=180) as client:
        client.post(
            "/login/access-token",
            data={
                "username": env["FIRST_SUPERUSER"],
                "password": env["FIRST_SUPERUSER_PASSWORD"],
            },
        ).raise_for_status()
        try:
            for kind, count in (
                []
                if args.native_only
                else [("summary", 3), ("questions", 4), ("deck", 3)]
            ):
                started = time.monotonic()
                response = client.post(
                    "/learning/generate",
                    json={
                        "workspace_id": fixture["workspace_id"],
                        "document_ids": fixture["document_ids"],
                        "kind": kind,
                        "count": count,
                        "provider": "gemini",
                        "model": fixture["chat_model"],
                        "title": f"Validación IA · {kind}",
                        "focus": "energía anual reportada por las fuentes",
                    },
                )
                if response.status_code != 200:
                    report["checks"].append(
                        {
                            "kind": kind,
                            "passed": False,
                            "status": response.status_code,
                            "error": response.json().get("code"),
                        }
                    )
                    response.raise_for_status()
                result = response.json()
                context = client.get(f"/trace/responses/{result['message_id']}/context")
                context.raise_for_status()
                assert context.json()["sources"]
                check = {
                    "kind": kind,
                    "passed": True,
                    "seconds": round(time.monotonic() - started, 2),
                    "message_id": result["message_id"],
                    "research_count": len(result["research"]),
                    "card_count": len(result["cards"]),
                    "coverage": result["coverage"],
                }
                if kind == "summary":
                    answer = result["research"][0]["answers"][0]
                    assert (
                        answer["citations"]
                        and "120" in answer["content"]
                        and "90" in answer["content"]
                    )
                    check["content"] = answer["content"]
                else:
                    assert (
                        len(result["cards"]) == count
                        and result["deck"]["cards"] == count
                    )
                    assert all(
                        card["evidences"] and "[Fuente " in card["answer"]
                        for card in result["cards"]
                    )
                    assert not any(
                        term in (card["question"] + " " + card["answer"]).casefold()
                        for card in result["cards"]
                        for term in [
                            "triángulo",
                            "círculo",
                            "color verde",
                            "color rojo",
                            "figura geométrica",
                        ]
                    ), "Study questions drifted from the selected energy topic"
                    saved = client.get(
                        f"/learning/decks/{result['deck']['id']}/cards"
                    ).json()
                    assert len(saved) == count
                    check["deck_id"] = result["deck"]["id"]
                    check["questions"] = [
                        {
                            "question": card["question"],
                            "answer": card["answer"],
                            "source_count": len(card["evidences"]),
                        }
                        for card in saved
                    ]
                    reviewed = client.post(
                        f"/learning/cards/{saved[0]['id']}/reviews",
                        json={
                            "rating": "good",
                            "response": "Respuesta de prueba inventada",
                        },
                    )
                    reviewed.raise_for_status()
                    progress = client.get(
                        f"/learning/decks/{result['deck']['id']}/progress"
                    ).json()
                    assert (
                        progress["reviews"] == 1
                        and progress["assessment"] == "self_reported"
                    )
                    check["review_persisted"] = True
                report["checks"].append(check)
                print(
                    json.dumps(
                        {
                            key: value
                            for key, value in check.items()
                            if key not in {"content", "questions"}
                        }
                    ),
                    flush=True,
                )
            if args.native or args.native_only:
                report["native_media"] = check_native(client)
                print(json.dumps(report["native_media"]), flush=True)
            report["passed"] = True
        finally:
            (ROOT / "docs/learning-ai-results.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
            )
    print(json.dumps({"passed": report.get("passed", False)}), flush=True)


if __name__ == "__main__":
    main()
