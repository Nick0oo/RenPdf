import uuid
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.domain import (
    ChatMessage,
    Conversation,
    Document,
    DocumentVersion,
    Workspace,
    WorkspaceDocument,
)
from app.learning_domain import ResearchEntry, StudyCard, StudyDeck, StudyReview
from app.schemas.learning import CardPublic, DeckPublic, ResearchPublic, SourceAnswer
from app.services.documents.access import owned_workspace
from app.services.rag.chat import message_sources


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def owned_deck(
    session: Session, owner_id: uuid.UUID, identifier: uuid.UUID
) -> StudyDeck:
    deck = session.get(StudyDeck, identifier)
    if not deck:
        raise HTTPException(404, "Mazo no encontrado")
    owned_workspace(session, owner_id, deck.workspace_id)
    return deck


def owned_card(
    session: Session, owner_id: uuid.UUID, identifier: uuid.UUID
) -> StudyCard:
    card = session.get(StudyCard, identifier)
    if not card:
        raise HTTPException(404, "Ficha no encontrada")
    owned_deck(session, owner_id, card.deck_id)
    return card


def workspace_answer(
    session: Session, workspace_id: uuid.UUID, identifier: uuid.UUID
) -> ChatMessage:
    message = session.get(ChatMessage, identifier)
    conversation = (
        session.get(Conversation, message.conversation_id) if message else None
    )
    if not message or not conversation or conversation.workspace_id != workspace_id:
        raise HTTPException(404, "Respuesta no encontrada en el workspace")
    if message.role != "assistant" or message.state != "COMPLETE":
        raise HTTPException(409, "La respuesta debe estar terminada")
    if not message_sources(session, message.id):
        raise HTTPException(409, "La respuesta no tiene evidencia citada para guardar")
    return message


def workspace_document(
    session: Session, workspace_id: uuid.UUID, identifier: uuid.UUID
) -> Document:
    document = session.get(Document, identifier)
    workspace = session.get(Workspace, workspace_id)
    if (
        not document
        or not workspace
        or document.owner_id != workspace.owner_id
        or not session.get(WorkspaceDocument, (workspace_id, identifier))
    ):
        raise HTTPException(404, "Fuente no encontrada en el workspace")
    return document


def research_public(session: Session, entry: ResearchEntry) -> ResearchPublic:
    result = ResearchPublic.model_validate(entry)
    for value in entry.source_message_ids:
        identifier = uuid.UUID(value)
        message = session.get(ChatMessage, identifier)
        conversation = (
            session.get(Conversation, message.conversation_id) if message else None
        )
        available = bool(
            message and conversation and conversation.workspace_id == entry.workspace_id
        )
        result.answers.append(
            SourceAnswer(
                message_id=identifier,
                available=available,
                content=message.content if available and message else "",
                provider=message.provider if available and message else None,
                model=message.model if available and message else None,
                citations=message_sources(session, identifier) if available else [],
            )
        )
    return result


def card_public(session: Session, card: StudyCard) -> CardPublic:
    result = CardPublic.model_validate(card)
    document = session.get(Document, card.document_id) if card.document_id else None
    version = session.get(DocumentVersion, card.version_id) if card.version_id else None
    result.source_available = bool(
        document and version and version.document_id == document.id
    )
    result.source_title = document.title if document else None
    if card.source_message_id:
        result.evidence = next(
            (
                item
                for item in message_sources(session, card.source_message_id)
                if item.label == card.citation_label
            ),
            None,
        )
    return result


def deck_public(session: Session, deck: StudyDeck) -> DeckPublic:
    cards = session.exec(
        select(StudyCard).where(col(StudyCard.deck_id) == deck.id)
    ).all()
    identifiers = [card.id for card in cards]
    reviews = (
        session.exec(
            select(StudyReview).where(col(StudyReview.card_id).in_(identifiers))
        ).all()
        if identifiers
        else []
    )
    result = DeckPublic.model_validate(deck)
    result.cards = len(cards)
    result.due_cards = sum(utc(card.due_at) <= datetime.now(UTC) for card in cards)
    result.reviews = len(reviews)
    return result
