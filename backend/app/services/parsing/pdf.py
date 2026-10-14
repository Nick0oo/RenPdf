"""Bounded page extraction; never downloads OCR, layout, or language model weights."""

import hashlib
import importlib
import importlib.metadata
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pymupdf

from app.core.config import settings
from app.services.parsing.geometry import normalize_bbox


@dataclass
class ParsedElement:
    text: str
    kind: str
    source_bbox: list[float]
    method: str = "digital"
    structured: dict[str, Any] = field(default_factory=dict)


def inspect_pdf(path: Path) -> int:
    with path.open("rb") as stream:
        if not stream.read(1024).lstrip().startswith(b"%PDF-"):
            raise ValueError("INVALID_PDF")
    try:
        with pymupdf.open(path) as pdf:
            if pdf.needs_pass:
                raise ValueError("ENCRYPTED_PDF")
            if not 1 <= len(pdf) <= settings.MAX_DOCUMENT_PAGES:
                raise ValueError("PAGE_LIMIT")
            return len(pdf)
    except pymupdf.FileDataError:
        raise ValueError("DAMAGED_PDF") from None


def parser_available() -> bool:
    if (
        not settings.DOCLING_ARTIFACTS_PATH
        or not settings.DOCLING_ARTIFACTS_PATH.is_dir()
    ):
        return False
    try:
        importlib.metadata.version("docling")
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


def native_parser_available() -> bool:
    try:
        importlib.metadata.version("docling-slim")
        importlib.metadata.version("docling-parse")
        return True
    except importlib.metadata.PackageNotFoundError:
        return False


def selected_parser() -> str:
    engine = settings.PARSER_ENGINE
    if engine == "pymupdf":
        return engine
    if engine == "docling":
        if not parser_available():
            raise ValueError("DOCLING_NOT_CONFIGURED")
        return engine
    if engine == "docling-native":
        if not native_parser_available():
            raise ValueError("DOCLING_NATIVE_NOT_CONFIGURED")
        return engine
    if parser_available():
        return "docling"
    return "docling-native" if native_parser_available() else "pymupdf"


def page_elements(
    path: Path, page_number: int
) -> tuple[dict[str, Any], list[ParsedElement]]:
    with pymupdf.open(path) as pdf:
        page = pdf[page_number - 1]
        rotation = page.rotation
        page.set_rotation(0)
        width, height = page.rect.width, page.rect.height
        elements = []
        engine = selected_parser()
        hybrid_chunks = []
        if engine.startswith("docling"):
            from app.services.parsing.docling import extract

            elements, hybrid_chunks = extract(
                pdf, page_number, native=engine == "docling-native"
            )
        else:
            for block in page.get_text("dict")["blocks"]:
                if block["type"] == 0:
                    text = "\n".join(
                        "".join(span["text"] for span in line["spans"])
                        for line in block["lines"]
                    ).strip()
                    if text:
                        elements.append(
                            ParsedElement(text, "text", list(block["bbox"]))
                        )
                elif block["type"] == 1:
                    elements.append(
                        ParsedElement(
                            "",
                            "figure",
                            list(block["bbox"]),
                            structured={
                                "vision_status": "NOT_ANALYZED",
                                "image_hash": hashlib.sha256(
                                    block.get("image", b"")
                                ).hexdigest(),
                            },
                        )
                    )
            for table in page.find_tables().tables:
                rows = table.extract()
                text = "\n".join(
                    " | ".join(str(cell or "") for cell in row) for row in rows
                )
                elements.append(
                    ParsedElement(
                        text, "table", list(table.bbox), structured={"rows": rows}
                    )
                )
        status = "EXTRACTED"
        if not any(element.text.strip() for element in elements):
            status = "OCR_REQUIRED"
            if settings.ENABLE_OCR:
                try:
                    textpage = page.get_textpage_ocr(
                        language=settings.OCR_LANGUAGE,
                        dpi=settings.RENDER_DPI,
                        full=True,
                    )
                    for block in page.get_text("blocks", textpage=textpage):
                        if block[4].strip():
                            elements.append(
                                ParsedElement(
                                    block[4].strip(),
                                    "text",
                                    list(block[:4]),
                                    "tesseract",
                                )
                            )
                    if any(element.text.strip() for element in elements):
                        status = "OCR_EXTRACTED"
                except RuntimeError, OSError:
                    status = "OCR_UNAVAILABLE"
        return {
            "width": width,
            "height": height,
            "rotation": rotation,
            "crop_box": list(page.cropbox),
            "extraction_status": status,
            "parser": engine,
            "hybrid_chunks": hybrid_chunks,
        }, elements


def element_data(element: ParsedElement, width: float, height: float) -> dict[str, Any]:
    return {
        "text": element.text,
        "element_type": element.kind,
        "source_coordinates": element.source_bbox,
        "bbox": normalize_bbox(element.source_bbox, width, height),
        "extraction_method": element.method,
        "structured_content": element.structured,
        "content_hash": element.structured.get("image_hash")
        or hashlib.sha256(element.text.encode()).hexdigest(),
    }


def structural_chunks(
    text: str, max_chars: int = 1600
) -> Iterator[tuple[str, int, int]]:
    """Split inside one structural element, with exact span offsets and overlap."""
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            space = text.rfind(" ", start + max_chars // 2, end)
            if space > start:
                end = space
        fragment = text[start:end]
        if fragment.strip():
            yield fragment, start, end
        if end == len(text):
            break
        start = max(start + 1, end - min(120, max_chars // 4))
