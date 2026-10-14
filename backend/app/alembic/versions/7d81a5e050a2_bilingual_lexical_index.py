"""Bilingual FTS expression index.

Revision ID: 7d81a5e050a2
Revises: 19ef30d98c01
"""
from alembic import op

revision = "7d81a5e050a2"
down_revision = "19ef30d98c01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE INDEX ix_chunk_fts ON chunk USING gin ((to_tsvector('spanish', contextualized_text) || to_tsvector('english', contextualized_text)))")


def downgrade() -> None:
    op.execute("DROP INDEX ix_chunk_fts")
