"""drop image storage url

Revision ID: 20260602_0037
Revises: 20260602_0036
Create Date: 2026-06-02
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260602_0037"
down_revision = "20260602_0036"
branch_labels = None
depends_on = None

IMAGE_TABLES = ("source_assets", "poster_variants", "image_session_assets")


def _table_exists(bind: sa.engine.Connection, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_names(bind: sa.engine.Connection, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in IMAGE_TABLES:
        if not _table_exists(bind, table_name):
            continue
        if "storage_url" not in _column_names(bind, table_name):
            continue
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_column("storage_url")


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in IMAGE_TABLES:
        if not _table_exists(bind, table_name):
            continue
        if "storage_url" in _column_names(bind, table_name):
            continue
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(sa.Column("storage_url", sa.String(length=1000), nullable=True))
