"""Explicit local transforms create new PDFs; no source is ever overwritten."""

import io
import re
import uuid
from contextlib import ExitStack

import pymupdf
from fastapi import HTTPException
from sqlmodel import Session

from app.core.config import settings
from app.domain import Document, Job, WorkspaceDocument
from app.module_domain import StudioOperation
from app.schemas.modules import StudioInput
from app.services.documents.access import owned_document, owned_workspace
from app.services.parsing.pdf import inspect_pdf
from app.services.storage.local import LocalStorage


def output_filename(name: str) -> str:
    clean = name.replace("\\", "/").split("/")[-1].strip()
    clean = re.sub(r'[\x00-\x1f<>:"|?*]', "", clean).strip(" .")
    if not clean:
        raise HTTPException(422, "Escribe un nombre para la copia")
    return clean if clean.lower().endswith(".pdf") else clean + ".pdf"


def create_derivative(
    session: Session, owner_id: uuid.UUID, body: StudioInput
) -> tuple[StudioOperation, Document, Job]:
    storage = LocalStorage()
    if body.workspace_id:
        owned_workspace(session, owner_id, body.workspace_id)
    documents = [
        owned_document(session, owner_id, source.document_id) for source in body.sources
    ]
    if any(document.source_type != "pdf" for document in documents):
        raise HTTPException(422, "Studio trabaja con fuentes PDF")
    byte_limit = min(settings.MAX_UPLOAD_SIZE_MB, 50) * 1024 * 1024
    page_limit = min(settings.MAX_DOCUMENT_PAGES, 500)
    if sum(document.file_size for document in documents) > byte_limit:
        raise HTTPException(422, "Los archivos seleccionados superan 50 MB en total")
    plans = [
        source.pages or list(range(1, document.page_count + 1))
        for source, document in zip(body.sources, documents, strict=True)
    ]
    if sum(map(len, plans)) > page_limit:
        raise HTTPException(422, "La copia supera el límite de 500 páginas")
    for pages, document in zip(plans, documents, strict=True):
        if any(page > document.page_count for page in pages):
            raise HTTPException(422, "Una página seleccionada no existe")

    identifier = uuid.uuid4()
    operation_id = uuid.uuid4()
    filename = output_filename(body.output_name)
    key = f"originals/{identifier}.pdf"
    lineage = []
    try:
        with ExitStack() as stack:
            output = stack.enter_context(pymupdf.open())
            for source, document, pages in zip(
                body.sources, documents, plans, strict=True
            ):
                path = storage.path(document.storage_key)
                if not path.is_file():
                    raise HTTPException(
                        404, "Un archivo original ya no está disponible"
                    )
                original = stack.enter_context(pymupdf.open(path))
                if original.needs_pass or len(original) != document.page_count:
                    raise HTTPException(422, "El original no se puede procesar")
                for page_index, page_number in enumerate(pages):
                    output.insert_pdf(
                        original,
                        from_page=page_number - 1,
                        to_page=page_number - 1,
                        links=True,
                        annots=True,
                        widgets=True,
                        final=int(page_index == len(pages) - 1),
                    )
                    page = output[-1]
                    if source.crop:
                        crop = source.crop
                        box = page.cropbox
                        page.set_cropbox(
                            pymupdf.Rect(
                                box.x0 + crop.x * box.width,
                                box.y0 + crop.y * box.height,
                                box.x0 + (crop.x + crop.width) * box.width,
                                box.y0 + (crop.y + crop.height) * box.height,
                            )
                        )
                    page.set_rotation((page.rotation + source.rotation) % 360)
                lineage.append(
                    {
                        "document_id": str(document.id),
                        "sha256": document.sha256,
                        "pages": pages,
                        "rotation": source.rotation,
                        "crop": source.crop.model_dump() if source.crop else None,
                    }
                )
            output.set_metadata(
                {
                    "title": filename,
                    "producer": "RenPdf Studio / PyMuPDF",
                    "keywords": f"RenPdf operation {operation_id}",
                }
            )
            data = output.tobytes(garbage=4, deflate=True)
        size, digest = storage.write(io.BytesIO(data), key, byte_limit)
        page_count = inspect_pdf(storage.path(key))
        document = Document(
            id=identifier,
            owner_id=owner_id,
            title=filename,
            original_filename=filename,
            storage_key=key,
            sha256=digest,
            file_size=size,
            page_count=page_count,
        )
        session.add(document)
        session.flush()
        if body.workspace_id:
            session.add(
                WorkspaceDocument(
                    workspace_id=body.workspace_id, document_id=document.id
                )
            )
        operation = StudioOperation(
            id=operation_id,
            owner_id=owner_id,
            workspace_id=body.workspace_id,
            output_document_id=document.id,
            kind=body.kind,
            output_name=filename,
            page_count=page_count,
            file_size=size,
            sources=lineage,
        )
        job = Job(document_id=document.id)
        session.add(operation)
        session.add(job)
        session.commit()
        for row in (operation, document, job):
            session.refresh(row)
        return operation, document, job
    except HTTPException:
        session.rollback()
        storage.delete(key)
        raise
    except ValueError, pymupdf.FileDataError:
        session.rollback()
        storage.delete(key)
        raise HTTPException(
            422, "No se pudo crear la copia. Revisa páginas y recorte."
        ) from None
    except Exception:
        session.rollback()
        storage.delete(key)
        raise HTTPException(
            503, "No se pudo guardar la copia. Los originales siguen disponibles."
        ) from None
