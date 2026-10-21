"""Spreadsheet sources and exact worksheet/cell provenance.

Revision ID: d752f305c142
Revises: c641e2f4b031
"""
import sqlalchemy as sa
from alembic import op

revision = "d752f305c142"
down_revision = "c641e2f4b031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document", sa.Column("sheet_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("documentelement", sa.Column("sheet_name", sa.String(length=255), nullable=True))
    op.add_column("documentelement", sa.Column("cell_range", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("documentelement", "cell_range")
    op.drop_column("documentelement", "sheet_name")
    op.drop_column("document", "sheet_count")
