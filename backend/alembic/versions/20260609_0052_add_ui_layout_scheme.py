"""add ui layout scheme preference

Revision ID: 20260609_0052
Revises: 20260609_0051
Create Date: 2026-06-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260609_0052"
down_revision = "20260609_0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "user_ui_preferences" not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns("user_ui_preferences")}
    if "ui_layout_scheme" not in columns:
        op.add_column(
            "user_ui_preferences",
            sa.Column("ui_layout_scheme", sa.String(length=32), nullable=False, server_default="classic"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "user_ui_preferences" not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns("user_ui_preferences")}
    if "ui_layout_scheme" in columns:
        op.drop_column("user_ui_preferences", "ui_layout_scheme")
