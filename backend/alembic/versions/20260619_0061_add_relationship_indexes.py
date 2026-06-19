"""add relationship fk indexes

Revision ID: 20260619_0061
Revises: 20260619_0060
Create Date: 2026-06-19
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260619_0061"
down_revision = "20260619_0060"
branch_labels = None
depends_on = None


# 补齐被 selectinload / 关系加载频繁使用、却缺索引的外键列，避免子表全表扫。
# (index_name, table_name, columns)
_INDEXES: tuple[tuple[str, str, list[str]], ...] = (
    ("ix_image_session_assets_session_id", "image_session_assets", ["session_id"]),
    ("ix_copy_sets_inspiration_id", "copy_sets", ["inspiration_id"]),
    ("ix_creative_briefs_inspiration_id", "creative_briefs", ["inspiration_id"]),
    ("ix_poster_variants_inspiration_id", "poster_variants", ["inspiration_id"]),
    ("ix_poster_variants_copy_set_id", "poster_variants", ["copy_set_id"]),
    ("ix_workflow_runs_workflow_id", "workflow_runs", ["workflow_id"]),
    ("ix_workflow_nodes_workflow_id", "workflow_nodes", ["workflow_id"]),
    ("ix_workflow_edges_workflow_id", "workflow_edges", ["workflow_id"]),
    ("ix_workflow_edges_source_node_id", "workflow_edges", ["source_node_id"]),
    ("ix_workflow_edges_target_node_id", "workflow_edges", ["target_node_id"]),
)


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    existing_by_table: dict[str, set[str]] = {}
    for index_name, table_name, columns in _INDEXES:
        existing = existing_by_table.setdefault(table_name, _index_names(table_name))
        if index_name not in existing:
            op.create_index(index_name, table_name, columns)
            existing.add(index_name)


def downgrade() -> None:
    for index_name, table_name, _columns in reversed(_INDEXES):
        if index_name in _index_names(table_name):
            op.drop_index(index_name, table_name=table_name)
