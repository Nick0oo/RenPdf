"""Saved research, evidence-linked study cards and explicit self-assessment.

Revision ID: b531d1e3a920
Revises: a421c9f2b810
"""

import sqlalchemy as sa
from alembic import op

revision = "b531d1e3a920"
down_revision = "a421c9f2b810"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("researchentry",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("question", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=False),
        sa.Column("source_message_ids", sa.JSON(), nullable=False),
        sa.Column("document_ids", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_researchentry_workspace_id", "researchentry", ["workspace_id"])
    op.create_table("studydeck",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspace.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_studydeck_workspace_id", "studydeck", ["workspace_id"])
    op.create_table("studycard",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("deck_id", sa.Uuid(), sa.ForeignKey("studydeck.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question", sa.String(), nullable=False),
        sa.Column("answer", sa.String(), nullable=False),
        sa.Column("document_id", sa.Uuid(), sa.ForeignKey("document.id", ondelete="SET NULL"), nullable=True),
        sa.Column("version_id", sa.Uuid(), sa.ForeignKey("documentversion.id", ondelete="SET NULL"), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("source_message_id", sa.Uuid(), sa.ForeignKey("chatmessage.id", ondelete="SET NULL"), nullable=True),
        sa.Column("citation_label", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("review_count", sa.Integer(), nullable=False),
    )
    op.create_index("ix_studycard_deck_id", "studycard", ["deck_id"])
    op.create_index("ix_studycard_due_at", "studycard", ["due_at"])
    op.create_table("studyreview",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("card_id", sa.Uuid(), sa.ForeignKey("studycard.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rating", sa.String(10), nullable=False),
        sa.Column("response", sa.String(), nullable=False),
        sa.Column("previous_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("next_due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_studyreview_card_id", "studyreview", ["card_id"])


def downgrade() -> None:
    for table in ("studyreview", "studycard", "studydeck", "researchentry"):
        op.drop_table(table)
