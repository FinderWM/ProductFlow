"""add user ui preferences

Revision ID: 20260609_0049
Revises: 20260608_0048
Create Date: 2026-06-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260609_0049"
down_revision = "20260608_0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "user_ui_preferences" in inspector.get_table_names():
        return

    op.create_table(
        "user_ui_preferences",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column(
            "mask_sensitive_images_in_inspirations",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "mask_sensitive_images_in_image_chat",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("user_id"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "user_ui_preferences" not in inspector.get_table_names():
        return

    op.drop_table("user_ui_preferences")
