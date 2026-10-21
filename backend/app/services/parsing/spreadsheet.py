"""Read workbook values locally, retaining original cells and stored formulas.

No macros, external links or formulas are executed. ZIP/XML and grid limits are
checked before the spreadsheet libraries allocate the workbook.
"""

import csv
import io
import math
import posixpath
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zipfile import BadZipFile, ZipFile

import openpyxl
import xlrd
from defusedxml import ElementTree as SafeXML
from openpyxl.utils.cell import coordinate_to_tuple, get_column_letter, range_boundaries

from app.core.config import settings

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


@dataclass
class SpreadsheetCell:
    row: int
    column: int
    coordinate: str
    value: Any
    display_value: str
    kind: str
    formula: str | None = None
    cached: bool = True
    number_format: str = "General"
    merged_range: str | None = None


@dataclass
class SpreadsheetSheet:
    name: str
    index: int
    rows: int
    columns: int
    hidden: bool = False
    cells: list[SpreadsheetCell] = field(default_factory=list)
    merged_ranges: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        return {
            "name": self.name,
            "index": self.index,
            "rows": self.rows,
            "columns": self.columns,
            "hidden": self.hidden,
            "nonempty_cells": len(self.cells),
            "formula_cells": sum(cell.formula is not None for cell in self.cells),
            "missing_formula_values": sum(
                cell.formula is not None and not cell.cached for cell in self.cells
            ),
            "merged_ranges": self.merged_ranges,
        }


@dataclass
class SpreadsheetBook:
    format: str
    mime_type: str
    sheets: list[SpreadsheetSheet]
    warnings: list[str] = field(default_factory=list)


def check_grid(rows: int, columns: int) -> None:
    if (
        rows > settings.MAX_SPREADSHEET_ROWS
        or columns > settings.MAX_SPREADSHEET_COLUMNS
    ):
        raise ValueError("SPREADSHEET_DIMENSION_LIMIT")


def plain_value(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return "#NUM!"
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def display_value(value: Any, number_format: str = "General") -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "VERDADERO" if value else "FALSO"
    if isinstance(value, (int, float)) and math.isfinite(value):
        decimal = re.search(r"0\.(0+)", number_format)
        precision = min(10, len(decimal[1])) if decimal else 0
        if "%" in number_format and not re.search(r'"[^"]*%[^"]*"|\\%', number_format):
            return f"{value * 100:.{precision}f}%"
        currency = next(
            (symbol for symbol in ("$", "€", "£", "¥") if symbol in number_format), ""
        )
        if currency:
            return currency + format(value, f",.{precision}f")
        if re.fullmatch(r"0{2,}", number_format) and float(value).is_integer():
            return str(int(value)).zfill(len(number_format))
        if decimal:
            return format(
                value, f",.{precision}f" if "," in number_format else f".{precision}f"
            )
    return str(plain_value(value))


def xlsx_parts(path: Path) -> tuple[list[dict], list[str], str]:
    warnings = []
    try:
        with ZipFile(path) as archive:
            entries = archive.infolist()
            names = archive.namelist()
            if len(entries) > 3000 or len(set(names)) != len(names):
                raise ValueError("SPREADSHEET_ARCHIVE_LIMIT")
            if (
                sum(item.file_size for item in entries)
                > settings.MAX_SPREADSHEET_EXPANDED_MB * 1024 * 1024
            ):
                raise ValueError("SPREADSHEET_EXPANSION_LIMIT")
            if (
                "xl/workbook.xml" not in names
                or "xl/_rels/workbook.xml.rels" not in names
            ):
                raise ValueError("INVALID_SPREADSHEET")
            workbook = SafeXML.fromstring(archive.read("xl/workbook.xml"))
            relations = SafeXML.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
            targets = {node.attrib["Id"]: node.attrib for node in relations}
            definitions = [
                node for node in workbook.iter() if node.tag.endswith("}sheet")
            ]
            if not 1 <= len(definitions) <= settings.MAX_SPREADSHEET_SHEETS:
                raise ValueError("SPREADSHEET_SHEET_LIMIT")
            metadata = []
            cell_count, grid_size = 0, 0
            for definition in definitions:
                relation_id = next(
                    (
                        value
                        for key, value in definition.attrib.items()
                        if key.endswith("}id")
                    ),
                    "",
                )
                relation = targets.get(relation_id, {})
                if relation.get("TargetMode") == "External":
                    raise ValueError("INVALID_SPREADSHEET")
                if not relation.get("Type", "").endswith("/worksheet"):
                    warnings.append(
                        "Las hojas de gráficos no se interpretan como celdas."
                    )
                    continue
                target = relation.get("Target", "")
                member = posixpath.normpath(
                    target.lstrip("/") if target.startswith("/") else "xl/" + target
                )
                if not member.startswith("xl/worksheets/") or member not in names:
                    raise ValueError("INVALID_SPREADSHEET")
                rows, columns, merged = 0, 0, []
                with archive.open(member) as stream:
                    for _event, node in SafeXML.iterparse(stream, events=("end",)):
                        if node.tag.endswith("}c"):
                            cell_count += 1
                            if cell_count > settings.MAX_SPREADSHEET_CELLS:
                                raise ValueError("SPREADSHEET_CELL_LIMIT")
                            populated = any(
                                child.tag.endswith(("}v", "}f", "}is"))
                                for child in node
                            )
                            if populated:
                                coordinate = node.attrib.get("r", "")
                                if not re.fullmatch(
                                    r"[A-Z]{1,3}[1-9][0-9]{0,6}", coordinate
                                ):
                                    raise ValueError("INVALID_CELL_REFERENCE")
                                row, column = coordinate_to_tuple(coordinate)
                                check_grid(row, column)
                                rows, columns = max(rows, row), max(columns, column)
                            node.clear()
                        elif node.tag.endswith("}mergeCell"):
                            reference = node.attrib.get("ref", "")
                            bounds = range_boundaries(reference)
                            check_grid(bounds[3], bounds[2])
                            merged.append(reference)
                            if len(merged) > 2000:
                                raise ValueError("SPREADSHEET_MERGE_LIMIT")
                            node.clear()
                        elif node.tag.endswith("}row"):
                            node.clear()
                grid_size += rows * columns
                if grid_size > settings.MAX_SPREADSHEET_GRID_CELLS:
                    raise ValueError("SPREADSHEET_GRID_LIMIT")
                metadata.append(
                    {
                        "name": definition.attrib["name"],
                        "rows": rows,
                        "columns": columns,
                        "hidden": definition.attrib.get("state", "visible")
                        != "visible",
                        "merged_ranges": merged,
                    }
                )
            if any(name.startswith("xl/externalLinks/") for name in names):
                warnings.append(
                    "No se actualizaron vínculos externos; se conservan sólo los valores guardados."
                )
            if any(name.endswith("vbaProject.bin") for name in names):
                warnings.append("Las macros del libro no se ejecutan.")
            if any(name.startswith(("xl/media/", "xl/charts/")) for name in names):
                warnings.append(
                    "Las imágenes y gráficos del libro no forman parte de las celdas indexadas."
                )
            macro = b"macroEnabled" in archive.read("[Content_Types].xml")
            return metadata, list(dict.fromkeys(warnings)), "xlsm" if macro else "xlsx"
    except BadZipFile, KeyError, OSError, SafeXML.ParseError:
        raise ValueError("INVALID_SPREADSHEET") from None


def read_xlsx(path: Path) -> SpreadsheetBook:
    metadata, warnings, kind = xlsx_parts(path)
    with path.open("rb") as formula_file, path.open("rb") as value_file:
        formulas = openpyxl.load_workbook(
            formula_file,
            read_only=True,
            data_only=False,
            keep_links=False,
            keep_vba=False,
        )
        values = openpyxl.load_workbook(
            value_file, read_only=True, data_only=True, keep_links=False, keep_vba=False
        )
        try:
            sheets = []
            for index, meta in enumerate(metadata, 1):
                sheet = SpreadsheetSheet(**meta, index=index)
                anchors = {
                    reference.split(":")[0]: reference
                    for reference in sheet.merged_ranges
                }
                if sheet.rows and sheet.columns:
                    rows = formulas[sheet.name].iter_rows(
                        max_row=sheet.rows, max_col=sheet.columns
                    )
                    saved_rows = values[sheet.name].iter_rows(
                        max_row=sheet.rows, max_col=sheet.columns
                    )
                    for row, saved_row in zip(rows, saved_rows, strict=True):
                        for cell, saved in zip(row, saved_row, strict=True):
                            if cell.value is None:
                                continue
                            formula = (
                                str(
                                    getattr(cell.value, "text", cell.value)
                                    or "Fórmula especial de Excel"
                                )
                                if cell.data_type == "f"
                                else None
                            )
                            actual = saved.value if formula else cell.value
                            cached = not formula or actual is not None
                            value = plain_value(actual)
                            cell_kind = (
                                "formula"
                                if formula
                                else "error"
                                if cell.data_type == "e"
                                else "boolean"
                                if isinstance(actual, bool)
                                else "number"
                                if isinstance(actual, (int, float))
                                else "date"
                                if isinstance(actual, (datetime, date, time, timedelta))
                                else "text"
                            )
                            sheet.cells.append(
                                SpreadsheetCell(
                                    row=cell.row,
                                    column=cell.column,
                                    coordinate=cell.coordinate,
                                    value=value,
                                    display_value=display_value(
                                        actual, cell.number_format
                                    ),
                                    kind=cell_kind,
                                    formula=formula,
                                    cached=cached,
                                    number_format=cell.number_format,
                                    merged_range=anchors.get(cell.coordinate),
                                )
                            )
                sheets.append(sheet)
        finally:
            formulas.close()
            values.close()
    if sum(not cell.cached for sheet in sheets for cell in sheet.cells):
        warnings.append(
            "Hay fórmulas sin resultado guardado. Abre y guarda el libro en Excel para actualizar sus valores; RenPdf no ejecuta fórmulas."
        )
    return SpreadsheetBook(
        kind,
        "application/vnd.ms-excel.sheet.macroEnabled.12"
        if kind == "xlsm"
        else XLSX_MIME,
        sheets,
        warnings,
    )


def read_xls(path: Path) -> SpreadsheetBook:
    warnings = [
        "En XLS se leen resultados guardados; el formato antiguo no expone el texto de sus fórmulas."
    ]
    try:
        with xlrd.open_workbook(
            file_contents=path.read_bytes(),
            on_demand=True,
            formatting_info=True,
            logfile=io.StringIO(),
        ) as workbook:
            if not 1 <= workbook.nsheets <= settings.MAX_SPREADSHEET_SHEETS:
                raise ValueError("SPREADSHEET_SHEET_LIMIT")
            sheets, total, grid = [], 0, 0
            for index in range(workbook.nsheets):
                source = workbook.sheet_by_index(index)
                check_grid(source.nrows, source.ncols)
                grid += source.nrows * source.ncols
                if grid > settings.MAX_SPREADSHEET_GRID_CELLS:
                    raise ValueError("SPREADSHEET_GRID_LIMIT")
                sheet = SpreadsheetSheet(
                    source.name,
                    index + 1,
                    source.nrows,
                    source.ncols,
                    bool(source.visibility),
                )
                anchors = {}
                for low_row, high_row, low_col, high_col in source.merged_cells:
                    reference = f"{get_column_letter(low_col + 1)}{low_row + 1}:{get_column_letter(high_col)}{high_row}"
                    sheet.merged_ranges.append(reference)
                    anchors[reference.split(":")[0]] = reference
                for row in range(source.nrows):
                    for column in range(source.ncols):
                        cell = source.cell(row, column)
                        if cell.ctype in {xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK}:
                            continue
                        total += 1
                        if total > settings.MAX_SPREADSHEET_CELLS:
                            raise ValueError("SPREADSHEET_CELL_LIMIT")
                        value = cell.value
                        kind = "text"
                        if cell.ctype == xlrd.XL_CELL_DATE:
                            value, kind = (
                                xlrd.xldate_as_datetime(value, workbook.datemode),
                                "date",
                            )
                        elif cell.ctype == xlrd.XL_CELL_BOOLEAN:
                            value, kind = bool(value), "boolean"
                        elif cell.ctype == xlrd.XL_CELL_ERROR:
                            value, kind = (
                                xlrd.error_text_from_code.get(value, "#ERROR!"),
                                "error",
                            )
                        elif cell.ctype == xlrd.XL_CELL_NUMBER:
                            kind = "number"
                        number_format = workbook.format_map[
                            workbook.xf_list[cell.xf_index].format_key
                        ].format_str
                        coordinate = f"{get_column_letter(column + 1)}{row + 1}"
                        sheet.cells.append(
                            SpreadsheetCell(
                                row + 1,
                                column + 1,
                                coordinate,
                                plain_value(value),
                                display_value(value, number_format),
                                kind,
                                number_format=number_format,
                                merged_range=anchors.get(coordinate),
                            )
                        )
                sheets.append(sheet)
                workbook.unload_sheet(index)
        return SpreadsheetBook("xls", "application/vnd.ms-excel", sheets, warnings)
    except xlrd.XLRDError:
        raise ValueError("INVALID_SPREADSHEET") from None


def read_delimited(path: Path, suffix: str) -> SpreadsheetBook:
    try:
        content = path.read_text(encoding="utf-8-sig")
    except UnicodeError:
        raise ValueError("CSV_REQUIRES_UTF8") from None
    if "\0" in content:
        raise ValueError("INVALID_SPREADSHEET")
    delimiter = (
        "\t"
        if suffix == ".tsv"
        else ";"
        if content[:4096].count(";") > content[:4096].count(",")
        else ","
    )
    sheet = SpreadsheetSheet("Datos", 1, 0, 0)
    for row, fields in enumerate(
        csv.reader(io.StringIO(content), delimiter=delimiter), 1
    ):
        check_grid(row, len(fields))
        if row * max(sheet.columns, len(fields)) > settings.MAX_SPREADSHEET_GRID_CELLS:
            raise ValueError("SPREADSHEET_GRID_LIMIT")
        sheet.rows, sheet.columns = row, max(sheet.columns, len(fields))
        for column, text in enumerate(fields, 1):
            if text == "":
                continue
            value: Any = text
            # Preserve identifiers with leading zeros and locale-ambiguous values.
            if re.fullmatch(r"-?(?:0|[1-9]\d*)(?:\.\d+)?", text):
                value = float(text) if "." in text else int(text)
                if isinstance(value, float) and not math.isfinite(value):
                    value = text
            sheet.cells.append(
                SpreadsheetCell(
                    row,
                    column,
                    f"{get_column_letter(column)}{row}",
                    value,
                    str(value),
                    "number" if isinstance(value, (int, float)) else "text",
                )
            )
            if len(sheet.cells) > settings.MAX_SPREADSHEET_CELLS:
                raise ValueError("SPREADSHEET_CELL_LIMIT")
    return SpreadsheetBook(
        suffix[1:],
        "text/tab-separated-values" if suffix == ".tsv" else "text/csv",
        [sheet],
    )


def read_spreadsheet(path: Path, filename: str = "") -> SpreadsheetBook:
    with path.open("rb") as stream:
        magic = stream.read(8)
    try:
        if magic.startswith(b"PK\x03\x04"):
            return read_xlsx(path)
        if magic == OLE_MAGIC:
            return read_xls(path)
        suffix = Path(filename).suffix.lower()
        if suffix in {".csv", ".tsv"}:
            return read_delimited(path, suffix)
    except ValueError:
        raise
    except Exception:
        raise ValueError("INVALID_SPREADSHEET") from None
    raise ValueError("UNSUPPORTED_SOURCE_FORMAT")


def is_spreadsheet(path: Path, filename: str) -> bool:
    with path.open("rb") as stream:
        magic = stream.read(8)
    return (
        magic.startswith(b"PK\x03\x04")
        or magic == OLE_MAGIC
        or Path(filename).suffix.lower() in {".csv", ".tsv", ".xlsx", ".xlsm", ".xls"}
    )


def cell_contexts(sheet: SpreadsheetSheet) -> dict[str, tuple[str, list[dict]]]:
    rows: dict[int, list[SpreadsheetCell]] = defaultdict(list)
    for cell in sheet.cells:
        rows[cell.row].append(cell)
    header = next(
        (
            cells
            for row, cells in rows.items()
            if row <= 10
            and sum(cell.kind == "text" for cell in cells) >= 2
            and sum(cell.kind == "text" for cell in cells) / len(cells) >= 0.6
        ),
        [],
    )
    headers = {cell.column: cell for cell in header}
    result = {}
    for cells in rows.values():
        first = next(
            (cell for cell in cells if cell.kind == "text" and not cell.formula),
            cells[0],
        )
        for cell in cells:
            context = []
            for origin in (headers.get(cell.column), first):
                if (
                    origin
                    and origin.coordinate != cell.coordinate
                    and len(origin.display_value) <= 300
                    and origin.coordinate
                    not in {item["coordinate"] for item in context}
                ):
                    context.append(
                        {"coordinate": origin.coordinate, "value": origin.value}
                    )
            lines = [f"Hoja «{sheet.name}» · {cell.coordinate}"]
            if cell.formula:
                lines.append(f"Fórmula guardada: {cell.formula}")
            lines.append(
                f"Valor guardado: {cell.value}"
                if cell.cached
                else "Resultado guardado: no disponible; no calcular ni inventar un valor como si estuviera guardado."
            )
            if cell.display_value and cell.display_value != str(cell.value):
                lines.append(f"Presentación de la celda: {cell.display_value}")
            lines.extend(
                f"Contexto {item['coordinate']}: {item['value']}" for item in context
            )
            result[cell.coordinate] = ("\n".join(lines), context)
    return result
