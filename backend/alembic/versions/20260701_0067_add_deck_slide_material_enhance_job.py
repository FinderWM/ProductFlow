"""add deck slide material enhance job reference

Revision ID: 20260701_0067
Revises: 20260630_0066
Create Date: 2026-07-01
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260701_0067"
down_revision = "20260630_0066"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    if "deck_slides" not in _table_names():
        return
    if "material_enhance_job_id" not in _column_names("deck_slides"):
        op.add_column("deck_slides", sa.Column("material_enhance_job_id", sa.String(length=36), nullable=True))


def downgrade() -> None:
    if "deck_slides" not in _table_names():
        return
    if "material_enhance_job_id" in _column_names("deck_slides"):
        op.drop_column("deck_slides", "material_enhance_job_id")
