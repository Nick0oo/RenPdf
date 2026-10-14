"""Explicit Windows CPU install; downloads only official runtime and text GGUF."""

import hashlib
import json
import os
import platform
import sys
import zipfile
from pathlib import Path

import httpx

RELEASE = "b11624"
REPOSITORY = "ggml-org/embeddinggemma-2-GGUF"
MODEL = "embeddinggemma-2-Q8_0.gguf"


def download(client, url, path, digest, expected_size):
    if (
        path.exists()
        and hashlib.file_digest(path.open("rb"), "sha256").hexdigest() == digest
    ):
        return
    temporary = path.with_suffix(path.suffix + ".part")
    hasher, size = hashlib.sha256(), 0
    with client.stream("GET", url) as response:
        if response.status_code != 200:
            raise RuntimeError(f"Download rejected: HTTP {response.status_code}")
        with temporary.open("wb") as output:
            for chunk in response.iter_bytes(1024 * 1024):
                size += len(chunk)
                if size > expected_size:
                    raise RuntimeError("Unexpected download size")
                hasher.update(chunk)
                output.write(chunk)
    if size != expected_size or hasher.hexdigest() != digest:
        raise RuntimeError("Download checksum or size mismatch")
    temporary.replace(path)


def main():
    if platform.system() != "Windows" or platform.machine().lower() not in {
        "amd64",
        "x86_64",
    }:
        raise SystemExit("This installer targets Windows x64 CPU only.")
    root = Path(os.environ["LOCALAPPDATA"]) / "RenPdf" / "llama.cpp"
    runtime = root / RELEASE
    models = root / "models"
    runtime.mkdir(parents=True, exist_ok=True)
    models.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=120) as client:
        release = client.get(
            f"https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/{RELEASE}"
        )
        release.raise_for_status()
        asset = next(
            item
            for item in release.json()["assets"]
            if item["name"].endswith("bin-win-cpu-x64.zip")
        )
        if asset["size"] > 150_000_000:
            raise RuntimeError("CPU runtime exceeds the expected download budget")
        archive = root / asset["name"]
        download(
            client,
            asset["browser_download_url"],
            archive,
            asset["digest"].removeprefix("sha256:"),
            asset["size"],
        )
        with zipfile.ZipFile(archive) as package:
            for item in package.infolist():
                target = (runtime / item.filename).resolve()
                if (
                    not target.is_relative_to(runtime.resolve())
                    or (item.external_attr >> 16) & 0o170000 == 0o120000
                ):
                    raise RuntimeError("Unsafe archive entry")
            for item in package.infolist():
                target = runtime / item.filename
                if not item.is_dir() and target.is_file():
                    # Installed DLLs can be in use. Verify identical bytes and keep them.
                    with package.open(item) as source, target.open("rb") as installed:
                        if (
                            hashlib.file_digest(source, "sha256").digest()
                            == hashlib.file_digest(installed, "sha256").digest()
                        ):
                            continue
                package.extract(item, runtime)
        tree = client.get(
            f"https://huggingface.co/api/models/{REPOSITORY}/tree/main?expand=true"
        )
        tree.raise_for_status()
        artifact = next(item for item in tree.json() if item["path"] == MODEL)
        if artifact["size"] > 650_000_000:
            raise RuntimeError("Text model exceeds the small-model download budget")
        download(
            client,
            f"https://huggingface.co/{REPOSITORY}/resolve/main/{MODEL}",
            models / MODEL,
            artifact["lfs"]["oid"],
            artifact["size"],
        )
    server = next(runtime.rglob("llama-server.exe"))
    state = {
        "release": RELEASE,
        "server": str(server),
        "model": str(models / MODEL),
        "model_sha256": artifact["lfs"]["oid"],
        "model_bytes": artifact["size"],
        "alias": "embeddinggemma-2-q8_0",
        "port": 8081,
    }
    (root / "runtime.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
    sys.stdout.write(
        json.dumps(
            {
                "installed": True,
                "release": RELEASE,
                "model": MODEL,
                "model_mb": round(artifact["size"] / 1e6, 1),
                "hash_verified": True,
            }
        )
        + "\n"
    )


if __name__ == "__main__":
    main()
