"""Bounded page extraction; never downloads OCR, layout, or language model weights."""

import hashlib
import importlib
import importlib.metadata
import os
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


def docling_elements(
    path: Path, page_number: int
) -> tuple[list[ParsedElement], list[dict[str, Any]]]:
    # Lazy imports: lightweight operation does not import Torch.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    InputFormat = importlib.import_module("docling.datamodel.base_models").InputFormat
    pipeline = importlib.import_module("docling.datamodel.pipeline_options")
    AcceleratorOptions, PdfPipelineOptions = (
        pipeline.AcceleratorOptions,
        pipeline.PdfPipelineOptions,
    )
    converter_module = importlib.import_module("docling.document_converter")
    DocumentConverter, PdfFormatOption = (
        converter_module.DocumentConverter,
        converter_module.PdfFormatOption,
    )

    options = PdfPipelineOptions(
        artifacts_path=settings.DOCLING_ARTIFACTS_PATH,
        do_ocr=False,
        enable_remote_services=False,
    )
    options.accelerator_options = AcceleratorOptions(num_threads=2, device="cpu")
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )
    document = converter.convert(
        path,
        page_range=(page_number, page_number),
        max_num_pages=settings.MAX_DOCUMENT_PAGES,
    ).document
    elements = []
    for item, _level in document.iterate_items():
        for provenance in getattr(item, "prov", []):
            if provenance.page_no != page_number:
                continue
            bbox = provenance.bbox
            page = document.pages[page_number]
            normalized = bbox.to_top_left_origin(page_height=page.size.height)
            text = getattr(item, "text", "")
            structured = {}
            label = str(getattr(item, "label", "text")).split(".")[-1].lower()
            if label == "picture":
                label = "figure"
            if label == "table":
                structured = item.data.model_dump(mode="json")
                text = item.export_to_markdown(doc=document)
            structured["docling_ref"] = item.self_ref
            elements.append(
                ParsedElement(
                    text,
                    label,
                    [normalized.l, normalized.t, normalized.r, normalized.b],
                    "docling",
                    structured,
                )
            )
    fragments = []
    if settings.DOCLING_TOKENIZER_PATH:
        if not settings.DOCLING_TOKENIZER_PATH.is_dir():
            raise ValueError("TOKENIZER_NOT_CONFIGURED")
        transformers = importlib.import_module("transformers")
        tokenizer_module = importlib.import_module(
            "docling_core.transforms.chunker.tokenizer.huggingface"
        )
        chunker_module = importlib.import_module(
            "docling_core.transforms.chunker.hybrid_chunker"
        )
        tokenizer = tokenizer_module.HuggingFaceTokenizer(
            tokenizer=transformers.AutoTokenizer.from_pretrained(
                str(settings.DOCLING_TOKENIZER_PATH), local_files_only=True
            ),
            max_tokens=384,
        )
        chunker = chunker_module.HybridChunker(tokenizer=tokenizer, merge_peers=True)
        for chunk in chunker.chunk(dl_doc=document):
            fragments.append(
                {
                    "text": chunk.text,
                    "context": chunker.contextualize(chunk=chunk),
                    "refs": [item.self_ref for item in chunk.meta.doc_items],
                }
            )
    return elements, fragments


def page_elements(
    path: Path, page_number: int
) -> tuple[dict[str, Any], list[ParsedElement]]:
    with pymupdf.open(path) as pdf:
        page = pdf[page_number - 1]
        rotation = page.rotation
        page.set_rotation(0)
        width, height = page.rect.width, page.rect.height
        elements = []
        engine = settings.PARSER_ENGINE
        use_docling = engine != "pymupdf" and parser_available()
        if engine == "docling" and not use_docling:
            raise ValueError("DOCLING_NOT_CONFIGURED")
        hybrid_chunks = []
        if use_docling:
            elements, hybrid_chunks = docling_elements(path, page_number)
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
            "parser": "docling" if use_docling else "pymupdf",
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
