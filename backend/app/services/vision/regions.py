import hashlib

import pymupdf
from sqlmodel import Session, col, select

from app.core.config import settings
from app.domain import Chunk, ChunkProvenance, Document, DocumentElement, DocumentPage
from app.schemas.research import EvidencePublic
from app.services.storage.local import LocalStorage


def region_image(
    document: Document, page: DocumentPage, element: DocumentElement
) -> bytes:
    with pymupdf.open(LocalStorage().path(document.storage_key)) as pdf:
        source = pdf[page.page_number - 1]
        source.set_rotation(0)
        box = element.bbox
        clip = (
            pymupdf.Rect(
                box["x"] * page.width,
                box["y"] * page.height,
                (box["x"] + box["width"]) * page.width,
                (box["y"] + box["height"]) * page.height,
            )
            if box
            else source.rect
        )
        # Bound resolution regardless of the PDF's physical dimensions.
        scale = min(settings.RENDER_DPI / 72, 1600 / max(clip.width, clip.height))
        return source.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False
        ).tobytes("png")


def visual_evidence(
    session: Session, document: Document, page: DocumentPage, element: DocumentElement
) -> EvidencePublic:
    provenance = session.exec(
        select(ChunkProvenance).where(col(ChunkProvenance.element_id) == element.id)
    ).first()
    if not provenance:
        text = (
            element.text
            or f"Región visual de tipo {element.element_type}; interpretación aún no verificada."
        )
        page_text = session.exec(
            select(DocumentElement.text).where(
                col(DocumentElement.page_id) == page.id,
                col(DocumentElement.element_type) != "figure",
            )
        ).all()
        chunk = Chunk(
            version_id=page.version_id,
            text=text,
            contextualized_text=(
                f"{document.title}\nPágina {page.page_number} · imagen figura gráfico diagrama\n"
                f"{text}\nContexto de la página (no describe la imagen):\n"
                + "\n".join(page_text)[:1600]
            ),
            content_hash=hashlib.sha256(text.encode()).hexdigest(),
            chunking_profile="visual-region-v1",
        )
        session.add(chunk)
        session.flush()
        provenance = ChunkProvenance(
            chunk_id=chunk.id, element_id=element.id, span_end=len(text)
        )
        session.add(provenance)
        session.flush()
    return EvidencePublic(
        chunk_id=provenance.chunk_id,
        element_id=element.id,
        document_id=document.id,
        version_id=page.version_id,
        document_title=document.title,
        page_number=page.page_number,
        text=element.text or "Región visual adjunta",
        bbox=element.bbox,
        rotation=page.rotation,
        precision="region" if element.bbox else "page",
    )
