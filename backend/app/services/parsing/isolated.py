"""Warm, bounded page parser; private child output never enters service logs."""

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.models.contracts import ProviderError
from app.services.parsing.pdf import ParsedElement


class PageParser:
    def __init__(self, path: Path):
        self.path = path.resolve()
        self.process: subprocess.Popen[str] | None = None
        self.responses: queue.Queue[dict[str, str]] = queue.Queue(maxsize=1)
        self.completed = 0

    def __enter__(self):
        return self

    def __exit__(self, *_arguments: object) -> None:
        self.close()

    def close(self) -> None:
        if self.process is None:
            return
        process, self.process = self.process, None
        if process.stdin:
            try:
                process.stdin.close()
            except OSError:
                pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        if process.stdout:
            process.stdout.close()

    def _start(self) -> None:
        self.responses = queue.Queue(maxsize=1)
        self.completed = 0
        self.process = subprocess.Popen(
            [sys.executable, "-m", "app.services.parsing.runner", "--serve"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
        )
        responses, process = self.responses, self.process

        def receive() -> None:
            assert process.stdout is not None
            try:
                for line in process.stdout:
                    try:
                        value = json.loads(line)
                        if value.get("status") in {"done", "error"}:
                            responses.put_nowait(value)
                    except ValueError, AttributeError, queue.Full:
                        continue  # Never retain or log third-party output.
            except OSError, ValueError:
                pass
            try:
                responses.put_nowait({"status": "error", "code": "PARSING_FAILED"})
            except queue.Full:
                pass

        threading.Thread(target=receive, daemon=True).start()

    def elements(self, page_number: int) -> tuple[dict[str, Any], list[ParsedElement]]:
        if self.completed >= settings.PARSER_RECYCLE_PAGES:
            self.close()
        if self.process is None:
            self._start()
        descriptor, output_name = tempfile.mkstemp(
            prefix="renpdf-page-", suffix=".json"
        )
        os.close(descriptor)
        output = Path(output_name)
        try:
            assert self.process is not None and self.process.stdin is not None
            self.process.stdin.write(
                json.dumps(
                    {"path": str(self.path), "page": page_number, "output": str(output)}
                )
                + "\n"
            )
            self.process.stdin.flush()
            response = self.responses.get(timeout=settings.PARSER_PAGE_TIMEOUT_SECONDS)
            if response["status"] != "done":
                self.close()
                raise ProviderError(
                    response.get("code", "PARSING_FAILED"),
                    "La página no pudo procesarse dentro de los límites configurados.",
                )
            if output.stat().st_size > 20 * 1024 * 1024:
                raise ProviderError(
                    "PAGE_CONTENT_LIMIT", "La página supera el límite de extracción."
                )
            data = json.loads(output.read_text(encoding="utf-8"))
            self.completed += 1
            return data["metadata"], [
                ParsedElement(**item) for item in data["elements"]
            ]
        except queue.Empty:
            self.close()
            raise ProviderError(
                "PARSER_TIMEOUT",
                "Una página excedió el tiempo de procesamiento permitido.",
            ) from None
        except BrokenPipeError, OSError, ValueError:
            self.close()
            raise ProviderError(
                "PARSING_FAILED",
                "El proceso de extracción se interrumpió. Puedes reintentar desde su checkpoint.",
            ) from None
        finally:
            output.unlink(missing_ok=True)


def isolated_page_elements(path: Path, page_number: int):
    with PageParser(path) as parser:
        return parser.elements(page_number)
