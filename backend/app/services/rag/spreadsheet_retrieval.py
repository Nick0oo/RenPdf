"""Balance worksheet candidates and apply exact worksheet/A1 scopes."""

import re
import uuid
from dataclasses import dataclass, field

from openpyxl.utils.cell import coordinate_to_tuple, range_boundaries
from sqlalchemy import cast, or_, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Session, col, select

from app.domain import (
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentPage,
    DocumentVersion,
)
from app.schemas.research import EvidencePublic


@dataclass
class SpreadsheetScope:
    versions: set[uuid.UUID] = field(default_factory=set)
    units: dict[uuid.UUID, str] = field(default_factory=dict)
    named: bool = False
    bounds: list[tuple[int, int, int, int]] = field(default_factory=list)
    cell_chunks: set[uuid.UUID] | None = None

    def keeps(self, source: EvidencePublic) -> bool:
        if source.source_type != "spreadsheet":
            return True
        if self.named and source.sheet_name not in set(self.units.values()):
            return False
        if self.bounds:
            if not source.cell_range:
                return False
            row, column = coordinate_to_tuple(source.cell_range.split(":")[0])
            return any(
                left <= column <= right and top <= row <= bottom
                for left, top, right, bottom in self.bounds
            )
        return True


def scope_for_question(
    session: Session, documents: list[Document], question: str
) -> SpreadsheetScope:
    scope = SpreadsheetScope()
    sheets = {}
    for document in documents:
        if document.source_type != "spreadsheet" or not document.current_version_id:
            continue
        scope.versions.add(document.current_version_id)
        version = session.get(DocumentVersion, document.current_version_id)
        for item in version.artifact_manifest.get("sheets", []) if version else []:
            sheets[(document.current_version_id, item["index"])] = item["name"]
    if not scope.versions:
        return scope
    units = session.exec(
        select(DocumentPage)
        .where(
            col(DocumentPage.version_id).in_(list(scope.versions)),
            col(DocumentPage.unit_kind) == "sheet",
        )
        .order_by(col(DocumentPage.page_number))
    ).all()
    names = set(sheets.values())
    mentions = {
        name
        for name in names
        if (
            re.search(r"\b(?:hojas?|sheets?)\b", question, re.IGNORECASE)
            and re.search(
                r"(?<!\w)" + re.escape(name) + r"(?!\w)", question, re.IGNORECASE
            )
        )
        or re.search(
            r"(?:'" + re.escape(name) + r"'|(?<!\w)" + re.escape(name) + r")\s*!",
            question,
            re.IGNORECASE,
        )
    }
    scope.named = bool(mentions)
    scope.units = {
        unit.id: sheets[(unit.version_id, unit.page_number)]
        for unit in units
        if (unit.version_id, unit.page_number) in sheets
        and (not mentions or sheets[(unit.version_id, unit.page_number)] in mentions)
    }
    references = re.findall(
        r"(?:\b(?:celdas?|cells?|rango|range)\s+|!\s*)(\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?:\s*:\s*\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?)",
        question,
        re.IGNORECASE,
    )
    if scope.named or re.search(
        r"\b(?:celdas?|cells?|rango|range)\b", question, re.IGNORECASE
    ):
        references = re.findall(
            r"(?<!\w)(\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?:\s*:\s*\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?)(?!\w)",
            question,
            re.IGNORECASE,
        )
    for reference in dict.fromkeys(references[:8]):
        scope.bounds.append(range_boundaries(re.sub(r"[$\s]", "", reference).upper()))
    if scope.bounds:
        content = cast(col(DocumentElement.structured_content), JSONB)
        conditions = [
            (
                (content["column"].as_integer() >= left)
                & (content["column"].as_integer() <= right)
                & (content["row"].as_integer() >= top)
                & (content["row"].as_integer() <= bottom)
            )
            for left, top, right, bottom in scope.bounds
        ]
        scope.cell_chunks = set(
            session.exec(
                select(ChunkProvenance.chunk_id)
                .join(DocumentElement)
                .where(
                    col(DocumentElement.page_id).in_(list(scope.units)),
                    or_(*conditions),
                )
            ).all()
        )
    return scope


def balanced_sheet_candidates(
    session: Session, scope: SpreadsheetScope, terms: list[str]
) -> list[uuid.UUID]:
    if not scope.units or not terms:
        return []
    statement = text("""
        WITH matches AS (
          SELECT DISTINCT c.id,p.id AS unit_id,
            ts_rank_cd(to_tsvector('spanish',c.contextualized_text) || to_tsvector('english',c.contextualized_text),
              websearch_to_tsquery('spanish',:question) || websearch_to_tsquery('english',:question)) AS score
          FROM chunk c JOIN chunkprovenance cp ON cp.chunk_id=c.id
          JOIN documentelement e ON e.id=cp.element_id JOIN documentpage p ON p.id=e.page_id
          WHERE p.id=ANY(:units) AND
            (to_tsvector('spanish',c.contextualized_text) || to_tsvector('english',c.contextualized_text))
              @@ (websearch_to_tsquery('spanish',:question) || websearch_to_tsquery('english',:question))
        ), ranked AS (
          SELECT id,unit_id,score,row_number() OVER (PARTITION BY unit_id ORDER BY score DESC,id) AS ordinal
          FROM matches
        ) SELECT id FROM ranked WHERE ordinal<=4 ORDER BY ordinal,score DESC,id LIMIT 120
    """)
    return list(
        session.connection()
        .execute(
            statement, {"units": list(scope.units), "question": " OR ".join(terms)}
        )
        .scalars()
    )


def chunk_units(
    session: Session, identifiers: list[uuid.UUID], scope: SpreadsheetScope
) -> dict[uuid.UUID, uuid.UUID]:
    if not identifiers or not scope.units:
        return {}
    return dict(
        session.exec(
            select(ChunkProvenance.chunk_id, DocumentElement.page_id)
            .join(DocumentElement)
            .where(
                col(ChunkProvenance.chunk_id).in_(identifiers),
                col(DocumentElement.page_id).in_(list(scope.units)),
            )
        ).all()
    )
