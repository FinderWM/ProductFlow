"""add gallery entry list indexes

Revision ID: 20260613_0057
Revises: 20260611_0056
Create Date: 2026-06-13
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260613_0057"
down_revision = "20260611_0056"
branch_labels = None
depends_on = None


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    indexes = _index_names("image_gallery_entries")
    if "ix_image_gallery_entries_enabled_created" not in indexes:
        op.create_index(
            "ix_image_gallery_entries_enabled_created",
            "image_gallery_entries",
            ["enabled", "created_at"],
            unique=False,
        )
    if "ix_image_gallery_entries_group_enabled_created" not in indexes:
        op.create_index(
            "ix_image_gallery_entries_group_enabled_created",
            "image_gallery_entries",
            ["resource_group_id", "enabled", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    indexes = _index_names("image_gallery_entries")
    if "ix_image_gallery_entries_group_enabled_created" in indexes:
        op.drop_index("ix_image_gallery_entries_group_enabled_created", table_name="image_gallery_entries")
    if "ix_image_gallery_entries_enabled_created" in indexes:
        op.drop_index("ix_image_gallery_entries_enabled_created", table_name="image_gallery_entries")
