"""Authenticated worksheet windows backed by persisted extraction, never reparsing."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import cast
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.domain import DocumentElement, DocumentPage, DocumentVersion
from app.services.documents.access import owned_document

router = APIRouter(prefix="/documents", tags=["spreadsheets"])


def workbook_version(
    document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    document = owned_document(session, current_user.id, document_id)
    if document.source_type != "spreadsheet":
        raise HTTPException(422, "Esta fuente no es un libro de cálculo")
    version = (
        session.get(DocumentVersion, document.current_version_id)
        if document.current_version_id
        else None
    )
    if not version:
        raise HTTPException(409, "Las hojas todavía se están preparando")
    return document, version


@router.get("/{document_id}/sheets")
def list_sheets(document_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    document, version = workbook_version(document_id, session, current_user)
    return {
        "document_id": document.id,
        "version_id": version.id,
        "data": version.artifact_manifest.get("sheets", []),
        "warnings": version.artifact_manifest.get("warnings", []),
    }


@router.get("/{document_id}/sheets/cells")
def sheet_cells(
    document_id: uuid.UUID,
    session: SessionDep,
    current_user: CurrentUser,
    sheet: Annotated[str, Query(min_length=1, max_length=255)],
    row: Annotated[int, Query(ge=1, le=100000)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    column: Annotated[int, Query(ge=1, le=16384)] = 1,
    columns: Annotated[int, Query(ge=1, le=50)] = 20,
):
    _document, version = workbook_version(document_id, session, current_user)
    meta = next(
        (
            item
            for item in version.artifact_manifest.get("sheets", [])
            if item["name"] == sheet
        ),
        None,
    )
    if not meta:
        raise HTTPException(404, "Hoja no encontrada")
    content = cast(col(DocumentElement.structured_content), JSONB)
    elements = session.exec(
        select(DocumentElement)
        .join(DocumentPage)
        .where(
            col(DocumentPage.version_id) == version.id,
            col(DocumentPage.unit_kind) == "sheet",
            col(DocumentElement.sheet_name) == sheet,
            content["row"].as_integer() >= row,
            content["row"].as_integer() < row + limit,
            content["column"].as_integer() >= column,
            content["column"].as_integer() < column + columns,
        )
        .order_by(content["row"].as_integer(), content["column"].as_integer())
    ).all()
    return {
        "sheet": sheet,
        "row_start": row,
        "column_start": column,
        "rows_total": meta["rows"],
        "columns_total": meta["columns"],
        "cells": [
            {
                **{
                    key: value
                    for key, value in element.structured_content.items()
                    if key
                    in {
                        "coordinate",
                        "row",
                        "column",
                        "value",
                        "display_value",
                        "formula",
                        "cached",
                        "number_format",
                        "merged_range",
                        "kind",
                    }
                },
                "element_id": element.id,
            }
            for element in elements
        ],
        "merged_ranges": meta.get("merged_ranges", []),
    }
