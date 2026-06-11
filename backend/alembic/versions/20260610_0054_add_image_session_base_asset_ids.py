"""add image session multi base asset lists

Revision ID: 20260610_0054
Revises: 20260609_0053
Create Date: 2026-06-10
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260610_0054"
down_revision = "20260609_0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "image_session_rounds" in table_names:
        columns = {column["name"] for column in inspector.get_columns("image_session_rounds")}
        if "base_asset_ids" not in columns:
            op.add_column("image_session_rounds", sa.Column("base_asset_ids", sa.JSON(), nullable=True))

    if "image_session_generation_tasks" in table_names:
        columns = {column["name"] for column in inspector.get_columns("image_session_generation_tasks")}
        if "base_asset_ids" not in columns:
            op.add_column("image_session_generation_tasks", sa.Column("base_asset_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "image_session_generation_tasks" in table_names:
        columns = {column["name"] for column in inspector.get_columns("image_session_generation_tasks")}
        if "base_asset_ids" in columns:
            with op.batch_alter_table("image_session_generation_tasks") as batch_op:
                batch_op.drop_column("base_asset_ids")

    if "image_session_rounds" in table_names:
        columns = {column["name"] for column in inspector.get_columns("image_session_rounds")}
        if "base_asset_ids" in columns:
            with op.batch_alter_table("image_session_rounds") as batch_op:
                batch_op.drop_column("base_asset_ids")
