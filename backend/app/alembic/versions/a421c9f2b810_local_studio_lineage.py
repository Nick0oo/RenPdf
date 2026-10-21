"""Persist local PDF derivatives and lineage without document contents.

Revision ID: a421c9f2b810
Revises: 7d81a5e050a2
"""

from alembic import op
import sqlalchemy as sa

revision = "a421c9f2b810"
down_revision = "7d81a5e050a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "studiooperation",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column("output_document_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("output_name", sa.String(255), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("sources", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["output_document_id"], ["document.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in ("owner_id", "workspace_id", "output_document_id", "created_at"):
        op.create_index(f"ix_studiooperation_{column}", "studiooperation", [column])


def downgrade() -> None:
    op.drop_table("studiooperation")
