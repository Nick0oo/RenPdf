"""Enable pgvector.

Revision ID: b8c14e53a902
Revises: fe56fa70289e
"""

from alembic import op

revision = "b8c14e53a902"
down_revision = "fe56fa70289e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS vector")
