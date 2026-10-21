"""Checkpointed sheet extraction, row chunks and exact per-cell provenance."""

import hashlib
import importlib.metadata
from collections import defaultdict
from dataclasses import asdict

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.domain import (
    Chunk,
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentPage,
    DocumentVersion,
    Job,
)
from app.services.documents.automatic_index import plan_local_index
from app.services.parsing.spreadsheet import cell_contexts, read_spreadsheet
from app.services.storage.local import LocalStorage


def extract_spreadsheet(session: Session, job: Job, document: Document) -> Job | None:
    from app.workers.tasks import check_cancel, update_job

    check_cancel(session, job)
    update_job(session, job, stage="reading_workbook", progress=2)
    book = read_spreadsheet(
        LocalStorage().path(document.storage_key), document.original_filename
    )
    check_cancel(session, job)
    version = session.get(DocumentVersion, job.version_id) if job.version_id else None
    if not version:
        latest = (
            session.exec(
                select(func.max(col(DocumentVersion.version_number))).where(
                    col(DocumentVersion.document_id) == document.id
                )
            ).one()
            or 0
        )
        version = DocumentVersion(
            document_id=document.id,
            version_number=latest + 1,
            parser_name="xlrd"
            if book.format == "xls"
            else "csv"
            if book.format in {"csv", "tsv"}
            else "openpyxl",
            parser_version=importlib.metadata.version(
                "xlrd" if book.format == "xls" else "openpyxl"
            )
            if book.format not in {"csv", "tsv"}
            else "utf8-v1",
        )
        session.add(version)
        session.flush()
        job.version_id = version.id
        session.add(job)
        session.commit()
    for sheet in book.sheets:
        if sheet.index <= job.checkpoint:
            continue
        check_cancel(session, job)
        update_job(
            session,
            job,
            stage="extracting_cells",
            progress=int((sheet.index - 1) / len(book.sheets) * 90),
        )
        unit = DocumentPage(
            version_id=version.id,
            page_number=sheet.index,
            unit_kind="sheet",
            width=max(1, sheet.columns),
            height=max(1, sheet.rows),
        )
        session.add(unit)
        session.flush()
        contexts = cell_contexts(sheet)
        rows: dict[int, list[DocumentElement]] = defaultdict(list)
        for cell in sheet.cells:
            text, context_cells = contexts[cell.coordinate]
            element = DocumentElement(
                page_id=unit.id,
                element_type="spreadsheet_cell",
                text=text,
                sheet_name=sheet.name,
                cell_range=cell.coordinate,
                coordinate_system="spreadsheet_a1",
                extraction_method=version.parser_name,
                content_hash=hashlib.sha256(text.encode()).hexdigest(),
                structured_content={
                    **asdict(cell),
                    "sheet_name": sheet.name,
                    "context_cells": context_cells,
                    "original_sha256": document.sha256,
                },
            )
            rows[cell.row].append(element)
        elements = [element for row in rows.values() for element in row]
        session.add_all(elements)
        session.flush()
        chunks: list[Chunk] = []
        provenance: list[ChunkProvenance] = []

        def append_chunk(
            origins: list[tuple[DocumentElement, int, int]],
            sheet_name: str = sheet.name,
            chunk_sink: list[Chunk] = chunks,
            origin_sink: list[ChunkProvenance] = provenance,
        ) -> None:
            content = "\n\n".join(
                element.text[start:end] for element, start, end in origins
            )
            chunk = Chunk(
                version_id=version.id,
                text=content,
                contextualized_text=f"{document.title}\nHoja «{sheet_name}»\n{content}",
                content_hash=hashlib.sha256(content.encode()).hexdigest(),
                chunking_profile="spreadsheet-rows-v1",
            )
            chunk_sink.append(chunk)
            origin_sink.extend(
                ChunkProvenance(
                    chunk_id=chunk.id,
                    element_id=element.id,
                    span_start=start,
                    span_end=end,
                )
                for element, start, end in origins
            )

        for row in rows.values():
            group, characters = [], 0
            for element in row:
                if group and (len(group) >= 8 or characters + len(element.text) > 1800):
                    append_chunk(group)
                    group, characters = [], 0
                if len(element.text) > 1800:
                    for start in range(0, len(element.text), 1400):
                        append_chunk(
                            [(element, start, min(len(element.text), start + 1500))]
                        )
                else:
                    group.append((element, 0, len(element.text)))
                    characters += len(element.text)
            if group:
                append_chunk(group)
        check_cancel(session, job)
        session.add_all(chunks)
        session.flush()
        session.add_all(provenance)
        job.checkpoint = sheet.index
        update_job(
            session,
            job,
            stage="sheets_extracted",
            progress=int(sheet.index / len(book.sheets) * 95),
        )
    check_cancel(session, job)
    summaries = [sheet.summary() for sheet in book.sheets]
    version.artifact_manifest = {
        "source_type": "spreadsheet",
        "format": book.format,
        "original_sha256": document.sha256,
        "sheets": summaries,
        "sheets_total": len(summaries),
        "sheets_extracted": len(summaries),
        "cells_total": sum(item["nonempty_cells"] for item in summaries),
        "formula_cells": sum(item["formula_cells"] for item in summaries),
        "missing_formula_values": sum(
            item["missing_formula_values"] for item in summaries
        ),
        "warnings": book.warnings,
    }
    version.status = "EXTRACTED"
    document.current_version_id, document.active_index_id = version.id, None
    document.sheet_count, document.status = len(summaries), "EXTRACTED"
    document.warning = " ".join(book.warnings) or None
    session.add_all([document, version])
    preparation = plan_local_index(session, document, extraction_job=job)
    update_job(
        session, job, state="SUCCEEDED", stage="workbook_extracted", progress=100
    )
    return preparation.job if preparation.created else None
