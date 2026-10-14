import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from app.core.config import settings
from app.services.models.contracts import ProviderError
from app.services.parsing.pdf import ParsedElement


def isolated_page_elements(path: Path, page_number: int):
    descriptor, output_name = tempfile.mkstemp(prefix="renpdf-page-", suffix=".json")
    os.close(descriptor)
    output = Path(output_name)
    try:
        subprocess.run(
            [
                sys.executable,
                "-m",
                "app.services.parsing.runner",
                str(path),
                str(page_number),
                str(output),
            ],
            check=True,
            timeout=settings.PARSER_PAGE_TIMEOUT_SECONDS,
            capture_output=True,
        )
        if output.stat().st_size > 20 * 1024 * 1024:
            raise ProviderError(
                "PAGE_CONTENT_LIMIT", "La página supera el límite de extracción."
            )
        data = json.loads(output.read_text(encoding="utf-8"))
        return data["metadata"], [ParsedElement(**item) for item in data["elements"]]
    except subprocess.TimeoutExpired:
        raise ProviderError(
            "PARSER_TIMEOUT", "Una página excedió el tiempo de procesamiento permitido."
        ) from None
    except subprocess.CalledProcessError:
        # Child stderr may contain document text; never emit it to user/logs.
        raise ProviderError(
            "PARSING_FAILED",
            "La página no pudo procesarse dentro de los límites configurados.",
        ) from None
    finally:
        output.unlink(missing_ok=True)
