"""add workflow waiting confirmation status

Revision ID: 20260603_0039
Revises: 20260602_0038
Create Date: 2026-06-03
"""

from __future__ import annotations

from alembic import op

revision = "20260603_0039"
down_revision = "20260602_0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE workflowrunstatus ADD VALUE IF NOT EXISTS 'waiting_confirmation'")


def downgrade() -> None:
    pass
