"""Snapshot/verify confirmed state around an externally initiated Compose restart."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["snapshot", "verify"])
args = parser.parse_args()
credentials = dotenv_values(root / ".env")
with httpx.Client(base_url="http://localhost:8000/api/v1", timeout=30) as client:
    deadline = time.monotonic() + 60
    while True:
        try:
            if client.get("/utils/health-check/", timeout=2).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError("API did not become ready within 60 seconds")
        time.sleep(1)
    response = client.post("/login/access-token", data={"username": credentials["FIRST_SUPERUSER"], "password": credentials["FIRST_SUPERUSER_PASSWORD"]})
    response.raise_for_status()
    documents = client.get("/documents/").json()
    snapshot = {}
    for document in documents:
        original = client.get(f"/documents/{document['id']}/file")
        original.raise_for_status()
        snapshot[document["id"]] = {"sha256": hashlib.sha256(original.content).hexdigest(), "version": document["current_version_id"], "index": document["active_index_id"], "status": document["status"]}
    workspaces = client.get("/workspaces/").json()
    conversations = {}
    for workspace in workspaces:
        for conversation in client.get(f"/workspaces/{workspace['id']}/conversations").json():
            messages = client.get(f"/conversations/{conversation['id']}/messages").json()
            conversations[conversation["id"]] = [{"id": row["id"], "state": row["state"], "content_hash": hashlib.sha256(row["content"].encode()).hexdigest(), "citations": row["citations"]} for row in messages]
    state = {"documents": snapshot, "conversations": conversations}
    target = root / "tmp" / "restart-snapshot.json"
    if args.mode == "snapshot":
        target.write_text(json.dumps(state, sort_keys=True), encoding="utf-8")
        print("Confirmed state snapshot recorded locally.")
    else:
        expected = json.loads(target.read_text(encoding="utf-8"))
        for identifier, document in expected["documents"].items():
            assert snapshot.get(identifier) == document, "Confirmed document changed after restart"
        for identifier, messages in expected["conversations"].items():
            current = {row["id"]: row for row in conversations.get(identifier, [])}
            assert all(current.get(row["id"]) == row for row in messages), "Confirmed message changed after restart"
        # A user can add messages while the app restarts; new data is allowed.
        result = {"outcome": "PASSED", "documents_preserved": len(expected["documents"]), "conversations_preserved": len(expected["conversations"]), "files_hash_verified": True, "citations_preserved": True}
        (root / "docs" / "restart-results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps(result))
