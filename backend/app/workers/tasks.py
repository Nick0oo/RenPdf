import hashlib
import importlib.metadata
import json
import uuid
from datetime import UTC, datetime, timedelta

from celery.signals import worker_ready
from sqlalchemy import func, text
from sqlmodel import Session, col, select

from app.core.db import engine
from app.domain import (
    Chunk,
    ChunkEmbedding,
    ChunkProvenance,
    Document,
    DocumentElement,
    DocumentIndex,
    DocumentPage,
    DocumentVersion,
    EmbeddingProfile,
    Job,
    now,
)
from app.services.documents.automatic_index import plan_local_index, restored_text_state
from app.services.models.contracts import EmbeddingInput, MediaInput, ProviderError
from app.services.models.providers import (
    GeminiProvider,
    NativeEmbeddingProvider,
    get_provider,
    safe_error,
)
from app.services.parsing.isolated import PageParser
from app.services.parsing.pdf import element_data, structural_chunks
from app.services.privacy.consent import require_consent
from app.services.storage.local import LocalStorage
from app.workers.celery_app import celery_app

TERMINAL_STATES = {"SUCCEEDED", "FAILED", "CANCELLED"}


def enqueue(job: Job) -> None:
    try:
        with Session(engine) as session:
            document = session.get(Document, job.document_id)
            queue = (
                "index"
                if job.kind == "index"
                else "media"
                if job.kind == "media_analysis"
                or (document and document.source_type in {"audio", "video"})
                else "extract"
                if job.kind == "extract"
                else "celery"
            )
        process_task.apply_async(args=[str(job.id)], queue=queue, retry=False)
    except Exception:
        # PostgreSQL is the durable outbox. Beat/startup dispatches this job later.
        pass


def update_job(session: Session, job: Job, **values: object) -> None:
    for key, value in values.items():
        setattr(job, key, value)
    job.updated_at = now()
    session.add(job)
    session.commit()


def check_cancel(session: Session, job: Job) -> None:
    session.refresh(job)
    if job.cancel_requested:
        raise ProviderError("CANCELLED", "Procesamiento cancelado por el usuario.")


def extract_document(session: Session, job: Job, document: Document) -> Job | None:
    storage = LocalStorage()
    if job.version_id:
        version = session.get(DocumentVersion, job.version_id)
    else:
        number = (
            session.exec(
                select(func.max(col(DocumentVersion.version_number))).where(
                    col(DocumentVersion.document_id) == document.id
                )
            ).one()
            or 0
        )
        version = DocumentVersion(
            document_id=document.id,
            version_number=number + 1,
            parser_version=importlib.metadata.version("pymupdf"),
        )
        session.add(version)
        session.flush()
        job.version_id = version.id
        session.add(job)
        session.commit()
    if not version:
        raise ProviderError("VERSION_MISSING", "No existe la versión documental.")
    degraded_pages = []
    with PageParser(storage.path(document.storage_key)) as page_parser:
        for number in range(job.checkpoint + 1, document.page_count + 1):
            check_cancel(session, job)
            metadata, elements = page_parser.elements(number)
            parser = metadata.pop("parser")
            hybrid_chunks = metadata.pop("hybrid_chunks", [])
            version.parser_name = parser
            if parser.startswith("docling"):
                version.parser_version = importlib.metadata.version("docling-slim")
            page = DocumentPage(version_id=version.id, page_number=number, **metadata)
            session.add(page)
            session.flush()
            element_refs = {}
            for parsed in elements:
                element = DocumentElement(
                    page_id=page.id, **element_data(parsed, page.width, page.height)
                )
                session.add(element)
                session.flush()
                if parsed.structured.get("docling_ref"):
                    element_refs[parsed.structured["docling_ref"]] = element
                # Figures remain real elements even when there is no visual model.
                if hybrid_chunks:
                    continue
                for fragment, start, end in structural_chunks(element.text):
                    contextualized = f"{document.title}\nPágina {number} · {element.element_type}\n{fragment}"
                    chunk = Chunk(
                        version_id=version.id,
                        text=fragment,
                        contextualized_text=contextualized,
                        content_hash=hashlib.sha256(fragment.encode()).hexdigest(),
                    )
                    session.add(chunk)
                    session.flush()
                    session.add(
                        ChunkProvenance(
                            chunk_id=chunk.id,
                            element_id=element.id,
                            span_start=start,
                            span_end=end,
                        )
                    )
            for fragment in hybrid_chunks:
                origins = [
                    element_refs[ref] for ref in fragment["refs"] if ref in element_refs
                ]
                if not origins:
                    raise ProviderError(
                        "MISSING_PROVENANCE",
                        "Un fragmento Docling carece de elementos de origen.",
                    )
                chunk = Chunk(
                    version_id=version.id,
                    text=fragment["text"],
                    contextualized_text=f"{document.title}\nPágina {number}\n{fragment['context']}",
                    content_hash=hashlib.sha256(fragment["text"].encode()).hexdigest(),
                    chunking_profile=fragment.get("profile", "docling-hybrid-v1"),
                )
                session.add(chunk)
                session.flush()
                for element in origins:
                    session.add(
                        ChunkProvenance(
                            chunk_id=chunk.id,
                            element_id=element.id,
                            span_end=len(element.text),
                        )
                    )
            from app.services.vision.regions import visual_evidence

            for figure in session.exec(
                select(DocumentElement).where(
                    col(DocumentElement.page_id) == page.id,
                    col(DocumentElement.element_type) == "figure",
                )
            ).all():
                visual_evidence(session, document, page, figure)
            if page.extraction_status in {"OCR_REQUIRED", "OCR_UNAVAILABLE"}:
                degraded_pages.append(number)
            job.checkpoint = number
            job.progress = int(number / document.page_count * 95)
            job.stage = "extracting"
            job.updated_at = now()
            session.add_all([version, job])
            session.commit()  # Page, elements, provenance, and checkpoint commit together.
    pages = session.exec(
        select(DocumentPage).where(col(DocumentPage.version_id) == version.id)
    ).all()
    degraded_pages = [
        page.page_number
        for page in pages
        if page.extraction_status in {"OCR_REQUIRED", "OCR_UNAVAILABLE"}
    ]
    version.status = "EXTRACTED"
    version.artifact_manifest = {
        "pages": len(pages),
        "ocr_pending_pages": degraded_pages,
        "chunker": "docling-hybrid"
        if version.parser_name.startswith("docling")
        else "structural-v1",
    }
    document.current_version_id = version.id
    document.active_index_id = None
    document.status = "EXTRACTED" if not degraded_pages else "DEGRADED"
    document.warning = (
        f"OCR pendiente en páginas: {degraded_pages}"
        if degraded_pages
        else (
            "Extracción ligera PyMuPDF; Docling no está configurado."
            if version.parser_name == "pymupdf"
            else (
                "Docling nativo sin modelos de layout; tablas PyMuPDF y OCR Tesseract selectivo."
                if version.parser_name == "docling-native"
                else None
            )
        )
    )
    session.add_all([version, document])
    preparation = plan_local_index(session, document, extraction_job=job)
    version.artifact_manifest = {
        **version.artifact_manifest,
        "local_index_preparation": {
            "state": preparation.state,
            "reason": preparation.reason,
            "job_id": str(preparation.job.id) if preparation.job else None,
        },
    }
    session.add(version)
    # The extraction result and its next outbox job commit atomically.
    update_job(session, job, state="SUCCEEDED", stage="extracted", progress=100)
    return preparation.job if preparation.created else None


def index_document(session: Session, job: Job, document: Document) -> None:
    target_version = job.version_id or document.current_version_id
    native_preparation = bool(job.parameters.get("native_preparation"))
    version = session.get(DocumentVersion, target_version) if target_version else None
    if not version or version.document_id != document.id:
        raise ProviderError(
            "NO_VERSION", "Primero completa la extracción del documento."
        )
    target_version = version.id
    if target_version != document.current_version_id and not (
        native_preparation
        and version.artifact_manifest.get("analysis_mode") == "native_embeddings"
    ):
        raise ProviderError(
            "VERSION_CHANGED", "La versión cambió; prepara su nuevo índice."
        )
    parameters = job.parameters
    provider_name, model, dimensions = (
        parameters["provider"],
        parameters["model"],
        parameters["dimensions"],
    )
    require_consent(session, [document.id], provider_name, "embeddings")
    provider = (
        get_provider(provider_name, timeout=int(parameters["timeout_seconds"]))
        if parameters.get("auto_index_local")
        else get_provider(provider_name)
    )
    modality = parameters.get("modality", "text")
    if (
        version.artifact_manifest.get("analysis_mode") == "native_embeddings"
        and modality != "multimodal"
    ):
        raise ProviderError(
            "MULTIMODAL_REQUIRED",
            "Las referencias nativas requieren embeddings de sus clips, no de sus etiquetas.",
        )
    if modality == "multimodal":
        require_consent(session, [document.id], provider_name, "multimodal_embeddings")
        if not isinstance(provider, NativeEmbeddingProvider) and (
            not isinstance(provider, GeminiProvider) or "embedding-2" not in model
        ):
            raise ProviderError(
                "MULTIMODAL_UNSUPPORTED",
                "Selecciona EmbeddingGemma 2 nativo o Gemini Embedding 2 para este perfil.",
            )
    from app.services.vision.regions import visual_evidence

    # Backfill visual provenance for previously extracted documents as well.
    figures = session.exec(
        select(DocumentElement, DocumentPage)
        .select_from(DocumentElement)
        .join(DocumentPage, col(DocumentPage.id) == col(DocumentElement.page_id))
        .where(
            col(DocumentPage.version_id) == target_version,
            col(DocumentElement.element_type) == "figure",
        )
    ).all()
    for element, page in figures:
        visual_evidence(session, document, page, element)
    models = provider.discover()
    descriptor = next((item for item in models if item.id == model), None)
    if not descriptor or descriptor.capabilities.embeddings == "unsupported":
        raise ProviderError(
            "MODEL_UNAVAILABLE", "El modelo de embeddings no está disponible."
        )
    config = {
        "provider": provider_name,
        "model": model,
        "model_version": descriptor.version,
        "dimensions": dimensions,
        "modality": modality,
        "metric": "cosine",
        "strategy": "retrieval-v1",
    }
    fingerprint = hashlib.sha256(
        json.dumps(config, sort_keys=True).encode()
    ).hexdigest()
    profile = session.exec(
        select(EmbeddingProfile).where(col(EmbeddingProfile.fingerprint) == fingerprint)
    ).first()
    if not profile:
        profile = EmbeddingProfile(
            provider=provider_name,
            model=model,
            model_version=descriptor.version,
            dimensions=dimensions,
            fingerprint=fingerprint,
            modality=modality,
        )
        session.add(profile)
        session.flush()
    if parameters.get("index_id"):
        index = session.get(DocumentIndex, uuid.UUID(parameters["index_id"]))
        if (
            not index
            or index.profile_id != profile.id
            or index.version_id != target_version
        ):
            raise ProviderError(
                "PROFILE_CHANGED", "El modelo cambió. Inicia una nueva reindexación."
            )
    else:
        index = session.exec(
            select(DocumentIndex).where(
                col(DocumentIndex.version_id) == target_version,
                col(DocumentIndex.profile_id) == profile.id,
                col(DocumentIndex.status) == "READY",
            )
        ).first()
        reused_index = bool(index)
        index = index or DocumentIndex(version_id=target_version, profile_id=profile.id)
        session.add(index)
        session.flush()
        job.parameters = {
            **parameters,
            "index_id": str(index.id),
            "reused_existing_index": reused_index,
        }
        session.add(job)
        session.commit()
    total_chunks = session.exec(
        select(func.count())
        .select_from(Chunk)
        .where(col(Chunk.version_id) == index.version_id)
    ).one()
    if not total_chunks:
        raise ProviderError("NO_TEXT", "No hay texto extraído para generar embeddings.")

    def authorize_send() -> None:
        check_cancel(session, job)
        require_consent(session, [document.id], provider_name, "embeddings")
        if modality == "multimodal":
            require_consent(
                session, [document.id], provider_name, "multimodal_embeddings"
            )

    cursor = None
    processed = 0
    while True:
        statement = select(Chunk).where(col(Chunk.version_id) == index.version_id)
        if cursor:
            statement = statement.where(col(Chunk.id) > cursor)
        batch_size = (
            1
            if document.source_type in {"audio", "video"}
            or (
                modality == "multimodal"
                and isinstance(provider, NativeEmbeddingProvider)
            )
            else 4
        )
        chunks = session.exec(statement.order_by(col(Chunk.id)).limit(batch_size)).all()
        if not chunks:
            break
        cursor = chunks[-1].id
        processed += len(chunks)
        check_cancel(session, job)
        batch = [
            chunk
            for chunk in chunks
            if not session.get(ChunkEmbedding, (chunk.id, index.id))
        ]
        # Exact native clip hashes + immutable model profile permit vector reuse
        # across versions. No transcript, decoder or model request is repeated.
        uncached = []
        reused_vectors = 0
        for chunk in batch:
            cached = (
                session.exec(
                    select(ChunkEmbedding)
                    .join(Chunk, col(Chunk.id) == col(ChunkEmbedding.chunk_id))
                    .join(
                        DocumentIndex,
                        col(DocumentIndex.id) == col(ChunkEmbedding.index_id),
                    )
                    .join(
                        DocumentVersion,
                        col(DocumentVersion.id) == col(Chunk.version_id),
                    )
                    .join(
                        Document, col(Document.id) == col(DocumentVersion.document_id)
                    )
                    .where(
                        col(Document.owner_id) == document.owner_id,
                        col(DocumentIndex.profile_id) == profile.id,
                        col(DocumentIndex.status) == "READY",
                        col(Chunk.content_hash) == chunk.content_hash,
                        col(Chunk.chunking_profile) == "native-media-v1",
                    )
                    .limit(1)
                ).first()
                if chunk.chunking_profile == "native-media-v1"
                else None
            )
            if cached:
                session.add(
                    ChunkEmbedding(
                        chunk_id=chunk.id, index_id=index.id, embedding=cached.embedding
                    )
                )
                reused_vectors += 1
            else:
                uncached.append(chunk)
        batch = uncached
        if reused_vectors:
            job.parameters = {
                **job.parameters,
                "vectors_reused": job.parameters.get("vectors_reused", 0)
                + reused_vectors,
            }
        if batch:
            require_consent(session, [document.id], provider_name, "embeddings")
            if modality == "multimodal" and isinstance(
                provider, (GeminiProvider, NativeEmbeddingProvider)
            ):
                from app.services.vision.regions import region_image

                require_consent(
                    session, [document.id], provider_name, "multimodal_embeddings"
                )
                inputs = []
                for chunk in batch:
                    provenance = session.exec(
                        select(ChunkProvenance).where(
                            col(ChunkProvenance.chunk_id) == chunk.id
                        )
                    ).first()
                    element = (
                        session.get(DocumentElement, provenance.element_id)
                        if provenance
                        else None
                    )
                    page = (
                        session.get(DocumentPage, element.page_id) if element else None
                    )
                    image = (
                        region_image(document, page, element)
                        if element and page and element.element_type == "figure"
                        else None
                    )
                    inputs.append(
                        EmbeddingInput(
                            text=""
                            if element
                            and element.structured_content.get("native_reference")
                            else chunk.contextualized_text,
                            image=image,
                            media=MediaInput(
                                data=LocalStorage()
                                .path(element.structured_content["media_key"])
                                .read_bytes(),
                                mime_type=element.structured_content["mime_type"],
                            )
                            if element and element.start_seconds is not None
                            else None,
                        )
                    )
                vectors = provider.embed_multimodal(
                    model, inputs, dimensions, before_send=authorize_send
                )
            elif isinstance(provider, GeminiProvider):
                vectors = provider.embed(
                    model,
                    [chunk.contextualized_text for chunk in batch],
                    dimensions,
                    before_send=authorize_send,
                )
            else:
                vectors = provider.embed(
                    model, [chunk.contextualized_text for chunk in batch], dimensions
                )
            for chunk, vector in zip(batch, vectors, strict=True):
                session.add(
                    ChunkEmbedding(
                        chunk_id=chunk.id, index_id=index.id, embedding=vector
                    )
                )
        job.progress = min(95, int(processed / total_chunks * 95))
        job.checkpoint = processed
        job.stage, job.updated_at = "embedding", now()
        session.add(job)
        session.commit()
    check_cancel(session, job)
    count = session.exec(
        select(func.count())
        .select_from(ChunkEmbedding)
        .where(col(ChunkEmbedding.index_id) == index.id)
    ).one()
    current_chunk_count = session.exec(
        select(func.count())
        .select_from(Chunk)
        .where(col(Chunk.version_id) == index.version_id)
    ).one()
    session.refresh(document)
    previous_version = parameters.get("previous_version_id")
    version_unchanged = index.version_id == document.current_version_id or (
        native_preparation
        and (str(document.current_version_id) if document.current_version_id else None)
        == previous_version
    )
    if count != current_chunk_count or not version_unchanged:
        raise ProviderError(
            "INDEX_VALIDATION",
            "El índice no coincide con la versión y los fragmentos actuales.",
        )
    index.status = "READY"
    document.current_version_id = target_version
    document.active_index_id = index.id
    version = session.get(DocumentVersion, target_version)
    degraded = bool(version and version.artifact_manifest.get("ocr_pending_pages"))
    document.status = "DEGRADED" if degraded else "READY"
    session.add_all([index, document])
    update_job(session, job, state="SUCCEEDED", stage="indexed", progress=100)


def process_job(job_id: str) -> None:
    with Session(engine) as session:
        job = session.get(Job, uuid.UUID(job_id))
        if not job or job.state in TERMINAL_STATES:
            return
        document = session.get(Document, job.document_id)
        if not document:
            return
        # A dedicated connection holds the advisory lock across page commits.
        # Process death releases it, allowing safe redelivery/checkpoint recovery.
        lock_key = document.id.int % (2**63 - 1)
        with engine.connect() as lock:
            acquired = lock.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_key}
            ).scalar()
            if not acquired:
                return
            next_job = None
            try:
                update_job(
                    session, job, state="RUNNING", error_code=None, error_message=None
                )
                if job.kind == "extract":
                    if document.source_type == "pdf":
                        next_job = extract_document(session, job, document)
                    elif document.source_type == "spreadsheet":
                        from app.services.parsing.spreadsheet_extraction import (
                            extract_spreadsheet,
                        )

                        next_job = extract_spreadsheet(session, job, document)
                    else:
                        from app.services.parsing.media_analysis import prepare_media

                        next_job = prepare_media(session, job, document)
                elif job.kind == "media_analysis":
                    from app.services.parsing.media_analysis import analyze_media

                    if not document.current_version_id:
                        document.status, document.warning = "ANALYZING", None
                        session.add(document)
                        session.commit()
                    next_job = analyze_media(session, job, document)
                elif job.kind == "native_prepare":
                    from app.services.parsing.native_media import prepare_native_media

                    if not document.active_index_id:
                        document.status = "NATIVE_PREPARING"
                        session.add(document)
                        session.commit()
                    next_job = prepare_native_media(session, job, document)
                elif job.kind == "index":
                    index_document(session, job, document)
                elif job.kind in {"questions", "summary"}:
                    from app.services.rag.enrichment import enrich_document

                    enrich_document(session, job, document)
                    update_job(
                        session, job, state="SUCCEEDED", stage=job.kind, progress=100
                    )
                else:
                    raise ProviderError("UNKNOWN_JOB", "Tipo de trabajo desconocido.")
            except Exception as error:
                session.rollback()
                session.refresh(job)
                failure = (
                    error if isinstance(error, ProviderError) else safe_error(error)
                )
                if isinstance(error, ValueError):
                    failure = ProviderError(
                        "PARSING_FAILED",
                        "No fue posible procesar la fuente con el motor configurado.",
                    )
                if (
                    job.kind == "index"
                    and job.parameters.get("auto_index_local")
                    and not document.active_index_id
                ):
                    document.status = restored_text_state(session, document)
                    session.add(document)
                if (
                    job.kind == "index"
                    and job.parameters.get("native_preparation")
                    and not document.active_index_id
                ):
                    document.status, document.warning = "MEDIA_READY", failure.message
                    session.add(document)
                if (
                    job.kind in {"media_analysis", "native_prepare"}
                    and not document.current_version_id
                ):
                    document.status = (
                        "MEDIA_READY"
                        if failure.code == "CANCELLED" or job.kind == "native_prepare"
                        else "ANALYSIS_FAILED"
                    )
                    document.warning = failure.message
                    session.add(document)
                update_job(
                    session,
                    job,
                    state="CANCELLED" if failure.code == "CANCELLED" else "FAILED",
                    error_code=failure.code,
                    error_message=failure.message,
                )
            finally:
                lock.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": lock_key})
            if next_job:
                enqueue(next_job)


@celery_app.task(name="research.process")
def process_task(job_id: str) -> None:
    process_job(job_id)


@celery_app.task(name="research.dispatch")
def dispatch_pending() -> None:
    with Session(engine) as session:
        for job in session.exec(
            select(Job).where(col(Job.state).notin_(list(TERMINAL_STATES)))
        ).all():  # type: ignore[attr-defined]
            if job.state == "QUEUED" or job.updated_at.replace(
                tzinfo=UTC
            ) < datetime.now(UTC) - timedelta(minutes=5):
                enqueue(job)


@worker_ready.connect
def startup_dispatch(**_kwargs: object) -> None:
    dispatch_pending()
