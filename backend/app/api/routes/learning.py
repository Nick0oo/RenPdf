import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from app.api.deps import CurrentUser, SessionDep
from app.domain import Workspace
from app.learning_domain import ResearchEntry, StudyCard, StudyDeck, StudyReview
from app.schemas.learning import (
    CardInput,
    CardPublic,
    DeckInput,
    DeckPublic,
    ProgressPublic,
    ResearchInput,
    ResearchPublic,
    ReviewInput,
    ReviewPublic,
)
from app.services.documents.access import owned_workspace
from app.services.learning.access import (
    card_public,
    deck_public,
    owned_card,
    owned_deck,
    research_public,
    utc,
    workspace_answer,
    workspace_document,
)
from app.services.rag.chat import message_sources

router = APIRouter(prefix="/learning", tags=["learning"])


@router.get("/research", response_model=list[ResearchPublic])
def list_research(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
):
    statement = (
        select(ResearchEntry)
        .join(Workspace, col(Workspace.id) == col(ResearchEntry.workspace_id))
        .where(col(Workspace.owner_id) == current_user.id)
    )
    if workspace_id:
        owned_workspace(session, current_user.id, workspace_id)
        statement = statement.where(col(ResearchEntry.workspace_id) == workspace_id)
    rows = session.exec(statement.order_by(col(ResearchEntry.created_at).desc())).all()
    return [research_public(session, row) for row in rows]


def validate_research(
    body: ResearchInput, session: SessionDep, current_user: CurrentUser
):
    owned_workspace(session, current_user.id, body.workspace_id)
    for identifier in body.document_ids:
        workspace_document(session, body.workspace_id, identifier)
    messages = [
        workspace_answer(session, body.workspace_id, identifier)
        for identifier in dict.fromkeys(body.source_message_ids)
    ]
    if body.kind in {"summary", "comparison"} and not messages:
        raise HTTPException(
            422, "Guarda una respuesta con citas reales para crear este informe"
        )
    cited_documents = {
        item.document_id
        for message in messages
        for item in message_sources(session, message.id)
    }
    if body.kind == "comparison" and len(cited_documents) < 2:
        raise HTTPException(
            422, "La comparación necesita evidencia citada de al menos dos PDFs"
        )
    if body.document_ids and not cited_documents <= set(body.document_ids):
        raise HTTPException(422, "La evidencia incluye PDFs fuera de la selección")
    return messages


@router.post("/research", response_model=ResearchPublic)
def create_research(
    body: ResearchInput, session: SessionDep, current_user: CurrentUser
):
    messages = validate_research(body, session, current_user)
    row = ResearchEntry(
        **body.model_dump(exclude={"source_message_ids", "document_ids"}),
        source_message_ids=[str(message.id) for message in messages],
        document_ids=[str(identifier) for identifier in body.document_ids],
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return research_public(session, row)


@router.patch("/research/{entry_id}", response_model=ResearchPublic)
def update_research(
    entry_id: uuid.UUID,
    body: ResearchInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    row = session.get(ResearchEntry, entry_id)
    if not row:
        raise HTTPException(404, "Investigación no encontrada")
    owned_workspace(session, current_user.id, row.workspace_id)
    if body.workspace_id != row.workspace_id:
        raise HTTPException(422, "El workspace de la investigación no puede cambiar")
    messages = validate_research(body, session, current_user)
    row.sqlmodel_update(body.model_dump(exclude={"source_message_ids", "document_ids"}))
    row.source_message_ids = [str(message.id) for message in messages]
    row.document_ids = [str(identifier) for identifier in body.document_ids]
    session.add(row)
    session.commit()
    session.refresh(row)
    return research_public(session, row)


@router.delete("/research/{entry_id}")
def delete_research(
    entry_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
):
    row = session.get(ResearchEntry, entry_id)
    if not row:
        raise HTTPException(404, "Investigación no encontrada")
    owned_workspace(session, current_user.id, row.workspace_id)
    session.delete(row)
    session.commit()
    return {"deleted": True}


@router.get("/decks", response_model=list[DeckPublic])
def list_decks(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: uuid.UUID | None = None,
):
    statement = (
        select(StudyDeck)
        .join(Workspace, col(Workspace.id) == col(StudyDeck.workspace_id))
        .where(col(Workspace.owner_id) == current_user.id)
    )
    if workspace_id:
        owned_workspace(session, current_user.id, workspace_id)
        statement = statement.where(col(StudyDeck.workspace_id) == workspace_id)
    return [
        deck_public(session, row)
        for row in session.exec(
            statement.order_by(col(StudyDeck.created_at).desc())
        ).all()
    ]


@router.post("/decks", response_model=DeckPublic)
def create_deck(body: DeckInput, session: SessionDep, current_user: CurrentUser):
    owned_workspace(session, current_user.id, body.workspace_id)
    row = StudyDeck(**body.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return deck_public(session, row)


@router.patch("/decks/{deck_id}", response_model=DeckPublic)
def update_deck(
    deck_id: uuid.UUID, body: DeckInput, session: SessionDep, current_user: CurrentUser
):
    row = owned_deck(session, current_user.id, deck_id)
    if body.workspace_id != row.workspace_id:
        raise HTTPException(422, "El workspace del mazo no puede cambiar")
    row.sqlmodel_update(body.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)
    return deck_public(session, row)


@router.delete("/decks/{deck_id}")
def delete_deck(deck_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    session.delete(owned_deck(session, current_user.id, deck_id))
    session.commit()
    return {"deleted": True}


@router.get("/decks/{deck_id}/cards", response_model=list[CardPublic])
def list_cards(deck_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    owned_deck(session, current_user.id, deck_id)
    return [
        card_public(session, row)
        for row in session.exec(
            select(StudyCard)
            .where(col(StudyCard.deck_id) == deck_id)
            .order_by(col(StudyCard.created_at).desc())
        ).all()
    ]


def card_values(body: CardInput, session: SessionDep, current_user: CurrentUser):
    deck = owned_deck(session, current_user.id, body.deck_id)
    values = body.model_dump()
    if body.source_message_id:
        message = workspace_answer(session, deck.workspace_id, body.source_message_id)
        evidence = next(
            (
                item
                for item in message_sources(session, message.id)
                if item.label == body.citation_label
            ),
            None,
        )
        if not evidence:
            raise HTTPException(422, "La cita seleccionada no existe en esa respuesta")
        workspace_document(session, deck.workspace_id, evidence.document_id)
        values.update(
            document_id=evidence.document_id,
            version_id=evidence.version_id,
            page_number=evidence.page_number,
        )
    else:
        assert body.document_id is not None
        document = workspace_document(session, deck.workspace_id, body.document_id)
        if not document.current_version_id:
            raise HTTPException(409, "Procesa el PDF antes de vincular una ficha")
        if body.page_number > document.page_count:
            raise HTTPException(422, "La página no existe en el PDF")
        values.update(version_id=document.current_version_id, citation_label=None)
    return values


@router.post("/cards", response_model=CardPublic)
def create_card(body: CardInput, session: SessionDep, current_user: CurrentUser):
    row = StudyCard(**card_values(body, session, current_user))
    session.add(row)
    session.commit()
    session.refresh(row)
    return card_public(session, row)


@router.patch("/cards/{card_id}", response_model=CardPublic)
def update_card(
    card_id: uuid.UUID, body: CardInput, session: SessionDep, current_user: CurrentUser
):
    row = owned_card(session, current_user.id, card_id)
    if body.deck_id != row.deck_id:
        raise HTTPException(422, "El mazo de la ficha no puede cambiar")
    row.sqlmodel_update(card_values(body, session, current_user))
    session.add(row)
    session.commit()
    session.refresh(row)
    return card_public(session, row)


@router.delete("/cards/{card_id}")
def delete_card(card_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    session.delete(owned_card(session, current_user.id, card_id))
    session.commit()
    return {"deleted": True}


@router.post("/cards/{card_id}/reviews", response_model=ReviewPublic)
def review_card(
    card_id: uuid.UUID,
    body: ReviewInput,
    session: SessionDep,
    current_user: CurrentUser,
):
    owned_card(session, current_user.id, card_id)
    card = session.exec(
        select(StudyCard).where(col(StudyCard.id) == card_id).with_for_update()
    ).one()
    delay = {
        "again": timedelta(minutes=10),
        "hard": timedelta(days=1),
        "good": timedelta(days=3),
        "easy": timedelta(days=7),
    }[body.rating]
    next_due = datetime.now(UTC) + delay
    review = StudyReview(
        card_id=card.id,
        previous_due_at=card.due_at,
        next_due_at=next_due,
        **body.model_dump(),
    )
    card.due_at = next_due
    card.review_count += 1
    session.add_all([review, card])
    session.commit()
    session.refresh(review)
    return review


@router.get("/decks/{deck_id}/reviews", response_model=list[ReviewPublic])
def list_reviews(deck_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    owned_deck(session, current_user.id, deck_id)
    return session.exec(
        select(StudyReview)
        .join(StudyCard, col(StudyCard.id) == col(StudyReview.card_id))
        .where(col(StudyCard.deck_id) == deck_id)
        .order_by(col(StudyReview.created_at).desc())
        .limit(500)
    ).all()


@router.get("/decks/{deck_id}/progress", response_model=ProgressPublic)
def progress(deck_id: uuid.UUID, session: SessionDep, current_user: CurrentUser):
    owned_deck(session, current_user.id, deck_id)
    cards = session.exec(
        select(StudyCard).where(col(StudyCard.deck_id) == deck_id)
    ).all()
    reviews = session.exec(
        select(StudyReview)
        .join(StudyCard, col(StudyCard.id) == col(StudyReview.card_id))
        .where(col(StudyCard.deck_id) == deck_id)
    ).all()
    return ProgressPublic(
        cards=len(cards),
        due_cards=sum(utc(card.due_at) <= datetime.now(UTC) for card in cards),
        reviewed_cards=sum(card.review_count > 0 for card in cards),
        reviews=len(reviews),
        ratings={
            rating: sum(review.rating == rating for review in reviews)
            for rating in ("again", "hard", "good", "easy")
        },
    )
