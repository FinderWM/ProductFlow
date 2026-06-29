"""add deck workflow source tracking

Revision ID: 20260625_0065
Revises: 20260619_0064
Create Date: 2026-06-25
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260625_0065"
down_revision = "20260619_0064"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    table_names = _table_names()
    if "decks" in table_names:
        deck_columns = _column_names("decks")
        if "workflow_node_id" not in deck_columns:
            op.add_column("decks", sa.Column("workflow_node_id", sa.String(length=36), nullable=True))
        if "source_manifest_json" not in deck_columns:
            op.add_column("decks", sa.Column("source_manifest_json", sa.JSON(), nullable=True))
        if "ix_decks_workflow_node_id" not in _index_names("decks"):
            op.create_index("ix_decks_workflow_node_id", "decks", ["workflow_node_id"], unique=False)

    if "deck_slides" in table_names and "source_manifest_json" not in _column_names("deck_slides"):
        op.add_column("deck_slides", sa.Column("source_manifest_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    table_names = _table_names()
    if "deck_slides" in table_names and "source_manifest_json" in _column_names("deck_slides"):
        op.drop_column("deck_slides", "source_manifest_json")

    if "decks" not in table_names:
        return
    if "ix_decks_workflow_node_id" in _index_names("decks"):
        op.drop_index("ix_decks_workflow_node_id", table_name="decks")
    deck_columns = _column_names("decks")
    if "source_manifest_json" in deck_columns:
        op.drop_column("decks", "source_manifest_json")
    if "workflow_node_id" in deck_columns:
        op.drop_column("decks", "workflow_node_id")
