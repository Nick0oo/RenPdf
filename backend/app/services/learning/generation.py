"""Generate cited learning material using the same auditable RAG as chat."""

import json
import uuid

from fastapi import HTTPException
from sqlmodel import Session

from app.domain import ChatMessage, Conversation
from app.learning_domain import ResearchEntry, StudyCard, StudyDeck
from app.schemas.learning import LearningGenerationInput, LearningGenerationPublic
from app.schemas.research import QuestionInput
from app.services.documents.access import owned_workspace
from app.services.learning.access import (
    card_public,
    deck_public,
    owned_deck,
    research_public,
    workspace_document,
)
from app.services.learning.generation_payload import StudyGeneration
from app.services.models.contracts import ProviderError
from app.services.models.routing import resolve_policy
from app.services.rag.chat import chat_events, message_sources


def generate_material(
    session: Session, owner_id: uuid.UUID, body: LearningGenerationInput
) -> LearningGenerationPublic:
    workspace = owned_workspace(session, owner_id, body.workspace_id)
    documents = [
        workspace_document(session, workspace.id, identifier)
        for identifier in body.document_ids
    ]
    if any(not document.current_version_id for document in documents):
        raise HTTPException(
            409,
            "Prepara las fuentes seleccionadas antes de generar material de estudio.",
        )
    deck = owned_deck(session, owner_id, body.deck_id) if body.deck_id else None
    if deck and deck.workspace_id != workspace.id:
        raise HTTPException(422, "El mazo debe pertenecer al workspace seleccionado.")
    policy = resolve_policy(
        session, owner_id, workspace.id, "chat", body.provider, body.model
    )
    if not policy.model:
        raise HTTPException(422, "Selecciona un modelo para generar el material.")
    title = (
        body.title
        or {
            "summary": "Resumen para repasar",
            "questions": "Preguntas para repasar",
            "deck": "Mazo de repaso",
        }[body.kind]
    )
    conversation = Conversation(
        workspace_id=workspace.id,
        title=f"{'Laboratorio' if body.kind != 'deck' else 'Estudio'} · {title}"[:200],
        provider=policy.provider,
        model=policy.model,
    )
    session.add(conversation)
    session.commit()
    conversation_id = conversation.id
    # Without a focus, use balanced reading windows rather than querying the
    # meaningless terms "generate flashcards" against the document contents.
    question = body.focus or "Resume los puntos principales con sus fuentes."
    study = StudyGeneration(body.kind, body.count)
    completed = None
    for packet in chat_events(
        conversation_id,
        owner_id,
        QuestionInput(question=question, document_ids=body.document_ids),
        body.document_ids,
        study=study,
    ):
        if packet.startswith("event: error\n"):
            failure = json.loads(packet.split("\ndata: ", 1)[1])
            raise ProviderError(failure["code"], failure["message"])
        if packet.startswith("event: done\n"):
            completed = json.loads(packet.split("\ndata: ", 1)[1])
    if not completed:
        raise ProviderError(
            "LEARNING_GENERATION_FAILED",
            "No se completó la generación. Revisa la ejecución antes de reintentar.",
        )
    session.expire_all()
    message = session.get(ChatMessage, uuid.UUID(completed["message_id"]))
    evidence = message_sources(session, message.id) if message else []
    if not message or message.state != "COMPLETE" or not evidence:
        raise ProviderError(
            "LEARNING_NO_EVIDENCE",
            "Las fuentes no aportaron citas para crear material. Ajusta el enfoque o revisa la extracción.",
        )
    if body.kind != "summary" and not study.result:
        raise ProviderError(
            "INVALID_STUDY_OUTPUT",
            "No se generaron preguntas con evidencia suficiente.",
        )
    # Recheck membership after inference. A source can be detached while a model
    # is running; never save a deck that has silently changed workspace scope.
    owned_workspace(session, owner_id, body.workspace_id)
    for item in evidence:
        workspace_document(session, workspace.id, item.document_id)
    if body.deck_id:
        deck = owned_deck(session, owner_id, body.deck_id)
    entries, cards = [], []
    if body.kind in {"summary", "questions"}:
        entry = ResearchEntry(
            workspace_id=workspace.id,
            kind="summary" if body.kind == "summary" else "question",
            title=body.title
            or (study.result.title if study and study.result else title),
            question=question,
            document_ids=[str(identifier) for identifier in body.document_ids],
            source_message_ids=[str(message.id)],
        )
        session.add(entry)
        entries.append(entry)
    if study and study.result:
        if not deck:
            deck = StudyDeck(
                workspace_id=workspace.id,
                name=(body.title or study.result.title)[:120],
                description="Preguntas y respuestas generadas por IA a partir de una muestra de las fuentes seleccionadas. Comprueba sus citas al repasar.",
            )
            session.add(deck)
            session.flush()
        by_label = {item.label: item for item in evidence}
        for item in study.result.items:
            source = by_label[item.source_ids[0]]
            card = StudyCard(
                deck_id=deck.id,
                question=item.question,
                answer=item.cited_answer(),
                source_message_id=message.id,
                citation_label=source.label,
                document_id=source.document_id,
                version_id=source.version_id,
                page_number=source.page_number or 1,
            )
            session.add(card)
            cards.append(card)
    session.flush()
    trace = dict(message.usage.get("trace", {}))
    trace["learning"] = {
        **trace.get("learning", {}),
        "kind": body.kind,
        "generated_items": len(cards),
        "research_ids": [str(entry.id) for entry in entries],
        "deck_id": str(deck.id) if deck else None,
        "storage_state": "saved",
    }
    message.usage = {**message.usage, "trace": trace}
    session.add(message)
    session.commit()
    return LearningGenerationPublic(
        kind=body.kind,
        conversation_id=conversation_id,
        message_id=message.id,
        research=[research_public(session, entry) for entry in entries],
        deck=deck_public(session, deck) if deck else None,
        cards=[card_public(session, card) for card in cards],
        coverage={
            **trace.get("document_coverage", {}),
            "partial": True,
            "retrieval_mode": trace.get("retrieval", {}).get("mode"),
        },
    )
