"""Offline Docling conversion: native PDF content or explicitly installed models."""

import hashlib
import importlib
import io
import os
from typing import Any

import pymupdf

from app.core.config import settings


def convert_page(pdf: pymupdf.Document, page_number: int, *, native: bool) -> Any:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from docling.datamodel.base_models import DocumentStream, InputFormat
    from docling.datamodel.pipeline_options import (
        AcceleratorOptions,
        NativePdfPipelineOptions,
        PdfPipelineOptions,
    )
    from docling.document_converter import (
        DocumentConverter,
        NativePdfFormatOption,
        PdfFormatOption,
    )

    # Canonical unrotated one-page input keeps CropBox and PDF.js geometry aligned.
    # The original PDF is never modified and no page image is retained by Docling.
    with pymupdf.open() as single:
        single.insert_pdf(
            pdf, from_page=page_number - 1, to_page=page_number - 1, rotate=0
        )
        source = DocumentStream(name="page.pdf", stream=io.BytesIO(single.tobytes()))
    if native:
        options = NativePdfPipelineOptions(
            generate_page_images=False,
            generate_picture_images=False,
            parser_threads=2,
            enable_remote_services=False,
            allow_external_plugins=False,
            document_timeout=settings.PARSER_PAGE_TIMEOUT_SECONDS,
        )
        format_option = NativePdfFormatOption(pipeline_options=options)
    else:
        advanced = PdfPipelineOptions(
            artifacts_path=settings.DOCLING_ARTIFACTS_PATH,
            do_ocr=False,
            enable_remote_services=False,
            allow_external_plugins=False,
            document_timeout=settings.PARSER_PAGE_TIMEOUT_SECONDS,
        )
        advanced.accelerator_options = AcceleratorOptions(num_threads=2, device="cpu")
        format_option = PdfFormatOption(pipeline_options=advanced)
    result = DocumentConverter(format_options={InputFormat.PDF: format_option}).convert(
        source
    )
    if str(result.status.value) != "success" or 1 not in result.document.pages:
        raise ValueError("DOCLING_CONVERSION_INCOMPLETE")
    return result.document


def supplement_native_tables(document: Any, page: pymupdf.Page) -> None:
    """Add real PyMuPDF cell structure; native Docling performs no table inference."""
    from docling_core.types.doc import (
        BoundingBox,
        CoordOrigin,
        ProvenanceItem,
        TableCell,
        TableData,
    )

    for table in page.find_tables().tables:
        rows = table.extract()
        if not rows:
            continue
        columns = max(len(row) for row in rows)
        cells = [
            TableCell(
                text=str(value or ""),
                start_row_offset_idx=row_index,
                end_row_offset_idx=row_index + 1,
                start_col_offset_idx=column_index,
                end_col_offset_idx=column_index + 1,
                column_header=row_index == 0 and not table.header.external,
            )
            for row_index, row in enumerate(rows)
            for column_index, value in enumerate(row)
        ]
        document.add_table(
            data=TableData(num_rows=len(rows), num_cols=columns, table_cells=cells),
            prov=ProvenanceItem(
                page_no=1,
                bbox=BoundingBox(
                    l=table.bbox[0],
                    t=table.bbox[1],
                    r=table.bbox[2],
                    b=table.bbox[3],
                    coord_origin=CoordOrigin.TOPLEFT,
                ),
                charspan=(0, 0),
            ),
        )


def map_elements(document: Any, page: pymupdf.Page, *, native: bool) -> list[Any]:
    from app.services.parsing.pdf import ParsedElement

    images = [block for block in page.get_text("dict")["blocks"] if block["type"] == 1]
    elements = []
    for item, _level in document.iterate_items():
        for provenance in getattr(item, "prov", []):
            bbox = provenance.bbox.to_top_left_origin(
                page_height=document.pages[1].size.height
            )
            coordinates = [bbox.l, bbox.t, bbox.r, bbox.b]
            text = getattr(item, "text", "")
            label = str(item.label.value)
            structured: dict[str, Any] = {"docling_ref": item.self_ref}
            method = "docling-native" if native else "docling"
            if label == "picture":
                label = "figure"
                structured["vision_status"] = "NOT_ANALYZED"
                for image in images:
                    if (
                        max(
                            abs(a - b)
                            for a, b in zip(coordinates, image["bbox"], strict=True)
                        )
                        < 2
                    ):
                        structured["image_hash"] = hashlib.sha256(
                            image["image"]
                        ).hexdigest()
                        break
            if label == "table":
                text = item.export_to_markdown(doc=document)
                structured["docling_table"] = item.data.model_dump(mode="json")
                structured["rows"] = [
                    [cell.text for cell in row] for row in item.data.grid
                ]
                if native:
                    method = "pymupdf-table"
            elements.append(ParsedElement(text, label, coordinates, method, structured))
    return elements


def hybrid_fragments(document: Any) -> list[dict[str, Any]]:
    from docling_core.transforms.chunker import DocMeta
    from docling_core.transforms.chunker.hybrid_chunker import HybridChunker
    from docling_core.transforms.chunker.tokenizer.base import BaseTokenizer

    class ByteBudgetTokenizer(BaseTokenizer):
        """Conservative UTF-8 byte budget, never fetches a model/tokenizer."""

        def count_tokens(self, text: str) -> int:
            return len(text.encode("utf-8"))

        def get_max_tokens(self) -> int:
            return 1536

        def get_tokenizer(self) -> Any:
            return self.count_tokens

    profile = "docling-hybrid-byte-v1"
    tokenizer: Any = ByteBudgetTokenizer()
    if settings.DOCLING_TOKENIZER_PATH:
        if not settings.DOCLING_TOKENIZER_PATH.is_dir():
            raise ValueError("TOKENIZER_NOT_CONFIGURED")
        transformers = importlib.import_module("transformers")
        module = importlib.import_module(
            "docling_core.transforms.chunker.tokenizer.huggingface"
        )
        tokenizer = module.HuggingFaceTokenizer(
            tokenizer=transformers.AutoTokenizer.from_pretrained(
                str(settings.DOCLING_TOKENIZER_PATH), local_files_only=True
            ),
            max_tokens=384,
        )
        profile = "docling-hybrid-tokenizer-v1"
    # Keep separate item provenance: a numeric cell must not cite a nearby heading.
    chunker = HybridChunker(tokenizer=tokenizer, merge_peers=False)
    fragments = []
    for chunk in chunker.chunk(dl_doc=document):
        if not chunk.text.strip():
            continue
        if not isinstance(chunk.meta, DocMeta):
            raise ValueError("DOCLING_PROVENANCE_MISSING")
        fragments.append(
            {
                "text": chunk.text,
                "context": chunker.contextualize(chunk=chunk),
                "refs": [item.self_ref for item in chunk.meta.doc_items],
                "profile": profile,
            }
        )
    return fragments


def extract(pdf: pymupdf.Document, page_number: int, *, native: bool):
    page = pdf[page_number - 1]
    document = convert_page(pdf, page_number, native=native)
    if native:
        supplement_native_tables(document, page)
    return map_elements(document, page, native=native), hybrid_fragments(document)
