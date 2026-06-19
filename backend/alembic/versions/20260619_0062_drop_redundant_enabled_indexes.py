"""drop redundant low-cardinality enabled indexes

Revision ID: 20260619_0062
Revises: 20260619_0061
Create Date: 2026-06-19
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260619_0062"
down_revision = "20260619_0061"
branch_labels = None
depends_on = None


# 单列布尔 enabled 索引基数极低、规划器基本不用，仅增写入开销；含 enabled 前缀的组合索引另行保留。
# (index_name, table_name)
_ENABLED_INDEXES: tuple[tuple[str, str], ...] = (
    ("ix_rbac_api_permissions_enabled", "rbac_api_permissions"),
    ("ix_generation_resource_groups_enabled", "generation_resource_groups"),
    ("ix_canvas_template_categories_enabled", "canvas_template_categories"),
    ("ix_canvas_templates_enabled", "canvas_templates"),
    ("ix_provider_profiles_enabled", "provider_profiles"),
    ("ix_generation_configs_enabled", "generation_configs"),
    ("ix_resource_library_assets_enabled", "resource_library_assets"),
    ("ix_inspirations_enabled", "inspirations"),
    ("ix_source_assets_enabled", "source_assets"),
    ("ix_poster_variants_enabled", "poster_variants"),
    ("ix_image_sessions_enabled", "image_sessions"),
    ("ix_image_session_assets_enabled", "image_session_assets"),
    ("ix_image_gallery_entries_enabled", "image_gallery_entries"),
)


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    existing_by_table: dict[str, set[str]] = {}
    for index_name, table_name in _ENABLED_INDEXES:
        existing = existing_by_table.setdefault(table_name, _index_names(table_name))
        if index_name in existing:
            op.drop_index(index_name, table_name=table_name)
            existing.discard(index_name)


def downgrade() -> None:
    existing_by_table: dict[str, set[str]] = {}
    for index_name, table_name in reversed(_ENABLED_INDEXES):
        existing = existing_by_table.setdefault(table_name, _index_names(table_name))
        if index_name not in existing:
            op.create_index(index_name, table_name, ["enabled"])
            existing.add(index_name)
