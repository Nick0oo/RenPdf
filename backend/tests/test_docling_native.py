import socket
from pathlib import Path

import pymupdf
import pytest

from app.core.config import settings
from app.services.models.contracts import ProviderError
from app.services.parsing.isolated import PageParser
from app.services.parsing.pdf import element_data, page_elements

FIXTURES = Path(__file__).parent / "fixtures"


def test_native_docling_is_offline_and_preserves_tables_and_provenance(monkeypatch):
    monkeypatch.setattr(settings, "PARSER_ENGINE", "docling-native")
    monkeypatch.setattr(settings, "DOCLING_TOKENIZER_PATH", None)

    def reject_network(*_args, **_kwargs):
        raise AssertionError("Docling must not fetch models or tokenizers")

    monkeypatch.setattr(socket.socket, "connect", reject_network)
    metadata, elements = page_elements(FIXTURES / "digital_es.pdf", 2)
    assert metadata["parser"] == "docling-native"
    table = next(element for element in elements if element.kind == "table")
    assert table.structured["rows"][-1] == ["Total", "200"]
    assert table.method == "pymupdf-table"
    figure = next(element for element in elements if element.kind == "figure")
    assert len(figure.structured["image_hash"]) == 64
    refs = {element.structured["docling_ref"] for element in elements}
    assert metadata["hybrid_chunks"]
    for fragment in metadata["hybrid_chunks"]:
        assert fragment["refs"] and set(fragment["refs"]) <= refs
        assert fragment["profile"] == "docling-hybrid-byte-v1"
        assert len(fragment["text"].encode("utf-8")) <= 1536


def test_native_docling_crop_rotation_uses_the_viewers_unrotated_coordinates(
    monkeypatch,
):
    monkeypatch.setattr(settings, "PARSER_ENGINE", "docling-native")
    metadata, elements = page_elements(FIXTURES / "crop_rotated.pdf", 1)
    assert metadata["rotation"] == 90
    assert (metadata["width"], metadata["height"]) == (525, 775)
    element = next(item for item in elements if "120 MWh" in item.text)
    normalized = element_data(element, metadata["width"], metadata["height"])["bbox"]
    with pymupdf.open(FIXTURES / "crop_rotated.pdf") as pdf:
        page = pdf[0]
        page.set_rotation(0)
        expected = page.search_for("La capacidad solar instalada es de 120 MWh.")[0]
    # Font metrics differ slightly between parsers; both centers lie in this line.
    center = pymupdf.Point(
        normalized["x"] * 525 + normalized["width"] * 525 / 2,
        normalized["y"] * 775 + normalized["height"] * 775 / 2,
    )
    assert expected.contains(center)


def test_parser_reuses_the_child_then_recycles_and_releases_it(monkeypatch):
    monkeypatch.setenv("PARSER_ENGINE", "pymupdf")
    monkeypatch.setattr(settings, "PARSER_RECYCLE_PAGES", 2)
    with PageParser(FIXTURES / "digital_es.pdf") as parser:
        parser.elements(1)
        first = parser.process
        parser.elements(2)
        assert parser.process is first
        parser.elements(1)
        assert first.poll() is not None
        second = parser.process
        assert second.pid != first.pid
    assert parser.process is None and second.poll() is not None


def test_parser_timeout_releases_the_child(monkeypatch):
    monkeypatch.setattr(settings, "PARSER_PAGE_TIMEOUT_SECONDS", 0.01)
    with PageParser(FIXTURES / "digital_es.pdf") as parser:
        with pytest.raises(ProviderError) as failure:
            parser.elements(1)
        assert failure.value.code == "PARSER_TIMEOUT"
        assert parser.process is None
