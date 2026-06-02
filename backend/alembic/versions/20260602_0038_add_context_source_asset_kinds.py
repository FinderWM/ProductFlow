"""add context source asset kinds

Revision ID: 20260602_0038
Revises: 20260602_0037
Create Date: 2026-06-02
"""

from alembic import op

revision = "20260602_0038"
down_revision = "20260602_0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE sourceassetkind ADD VALUE IF NOT EXISTS 'context_image'")
            op.execute("ALTER TYPE sourceassetkind ADD VALUE IF NOT EXISTS 'context_document'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be safely removed without rebuilding the type.
    pass
