"""Audio/video sources with deterministic temporal provenance.

Revision ID: c641e2f4b031
Revises: b531d1e3a920
"""

import sqlalchemy as sa
from alembic import op

revision = "c641e2f4b031"
down_revision = "b531d1e3a920"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document", sa.Column("source_type", sa.String(), nullable=False, server_default="pdf"))
    op.add_column("document", sa.Column("mime_type", sa.String(), nullable=False, server_default="application/pdf"))
    op.add_column("document", sa.Column("duration_seconds", sa.Float(), nullable=True))
    op.add_column("documentpage", sa.Column("unit_kind", sa.String(), nullable=False, server_default="page"))
    op.add_column("documentelement", sa.Column("start_seconds", sa.Float(), nullable=True))
    op.add_column("documentelement", sa.Column("end_seconds", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("documentelement", "end_seconds")
    op.drop_column("documentelement", "start_seconds")
    op.drop_column("documentpage", "unit_kind")
    op.drop_column("document", "duration_seconds")
    op.drop_column("document", "mime_type")
    op.drop_column("document", "source_type")
