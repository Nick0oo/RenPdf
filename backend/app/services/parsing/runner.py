"""Parser subprocess with one-page responses and no document text on stdout."""

import gc
import json
import os
import sys
from contextlib import redirect_stdout
from dataclasses import asdict
from pathlib import Path

from app.core.config import settings


def extract(path: Path, page_number: int, output: Path) -> None:
    from app.services.parsing.pdf import page_elements

    metadata, elements = page_elements(path, page_number)
    if (
        len(elements) > 5000
        or sum(len(element.text) for element in elements) > 2_000_000
    ):
        raise ValueError("PAGE_CONTENT_LIMIT")
    data = json.dumps(
        {"metadata": metadata, "elements": [asdict(element) for element in elements]}
    )
    if len(data.encode("utf-8")) > 20 * 1024 * 1024:
        raise ValueError("PAGE_CONTENT_LIMIT")
    output.write_text(data, encoding="utf-8")


def main() -> None:
    os.environ["OPENBLAS_NUM_THREADS"] = "1"
    os.environ["OMP_NUM_THREADS"] = "2"
    if sys.platform != "win32":
        import resource

        limit = settings.PARSER_MEMORY_LIMIT_MB * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    if sys.argv[1:] != ["--serve"]:
        with redirect_stdout(sys.stderr):
            extract(Path(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3]))
        return
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with redirect_stdout(sys.stderr):
                extract(
                    Path(request["path"]), int(request["page"]), Path(request["output"])
                )
            response = {"status": "done"}
        except Exception as error:
            codes = {
                "PAGE_CONTENT_LIMIT",
                "DOCLING_NOT_CONFIGURED",
                "DOCLING_NATIVE_NOT_CONFIGURED",
                "DOCLING_CONVERSION_INCOMPLETE",
                "TOKENIZER_NOT_CONFIGURED",
            }
            code = (
                "PARSER_MEMORY_LIMIT"
                if isinstance(error, MemoryError)
                else str(error)
                if isinstance(error, ValueError) and str(error) in codes
                else "PARSING_FAILED"
            )
            response = {"status": "error", "code": code}
        print(json.dumps(response), flush=True)  # noqa: T201 -- private IPC status only
        gc.collect()


if __name__ == "__main__":
    main()
