"""Isolated page parser with a wall-time boundary in its parent process."""

import json
import sys
from dataclasses import asdict
from pathlib import Path

from app.core.config import settings
from app.services.parsing.pdf import page_elements


def main() -> None:
    if sys.platform != "win32":
        import resource

        limit = settings.PARSER_MEMORY_LIMIT_MB * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    metadata, elements = page_elements(Path(sys.argv[1]), int(sys.argv[2]))
    if (
        len(elements) > 5000
        or sum(len(element.text) for element in elements) > 2_000_000
    ):
        raise ValueError("PAGE_CONTENT_LIMIT")
    Path(sys.argv[3]).write_text(
        json.dumps(
            {
                "metadata": metadata,
                "elements": [asdict(element) for element in elements],
            }
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
