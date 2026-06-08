"""add generation resource group image blur flag

Revision ID: 20260608_0048
Revises: 20260608_0047
Create Date: 2026-06-08
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260608_0048"
down_revision = "20260608_0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("generation_resource_groups")}
    if "blur_images_by_default" in columns:
        return

    with op.batch_alter_table("generation_resource_groups") as batch_op:
        batch_op.add_column(
            sa.Column(
                "blur_images_by_default",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("generation_resource_groups")}
    if "blur_images_by_default" not in columns:
        return

    with op.batch_alter_table("generation_resource_groups") as batch_op:
        batch_op.drop_column("blur_images_by_default")
