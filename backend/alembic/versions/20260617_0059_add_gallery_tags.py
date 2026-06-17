"""add gallery tags

Revision ID: 20260617_0059
Revises: 20260615_0058
Create Date: 2026-06-17
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260617_0059"
down_revision = "20260615_0058"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    table_names = _table_names()
    if "gallery_tags" not in table_names:
        op.create_table(
            "gallery_tags",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("priority", sa.Integer(), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
    gallery_tag_indexes = _index_names("gallery_tags")
    if "uq_gallery_tags_name_active" not in gallery_tag_indexes:
        op.create_index(
            "uq_gallery_tags_name_active",
            "gallery_tags",
            ["name"],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
            sqlite_where=sa.text("deleted_at IS NULL"),
        )
    if "ix_gallery_tags_deleted_enabled_priority_name" not in gallery_tag_indexes:
        op.create_index(
            "ix_gallery_tags_deleted_enabled_priority_name",
            "gallery_tags",
            ["deleted_at", "enabled", "priority", "name"],
            unique=False,
        )

    table_names = _table_names()
    if "image_gallery_entry_tags" not in table_names:
        op.create_table(
            "image_gallery_entry_tags",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("gallery_entry_id", sa.String(length=36), nullable=False),
            sa.Column("tag_id", sa.String(length=36), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
    entry_tag_indexes = _index_names("image_gallery_entry_tags")
    if "uq_image_gallery_entry_tags_active" not in entry_tag_indexes:
        op.create_index(
            "uq_image_gallery_entry_tags_active",
            "image_gallery_entry_tags",
            ["gallery_entry_id", "tag_id"],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
            sqlite_where=sa.text("deleted_at IS NULL"),
        )
    if "ix_image_gallery_entry_tags_entry_deleted" not in entry_tag_indexes:
        op.create_index(
            "ix_image_gallery_entry_tags_entry_deleted",
            "image_gallery_entry_tags",
            ["gallery_entry_id", "deleted_at"],
            unique=False,
        )
    if "ix_image_gallery_entry_tags_tag_deleted" not in entry_tag_indexes:
        op.create_index(
            "ix_image_gallery_entry_tags_tag_deleted",
            "image_gallery_entry_tags",
            ["tag_id", "deleted_at"],
            unique=False,
        )


def downgrade() -> None:
    table_names = _table_names()
    if "image_gallery_entry_tags" in table_names:
        entry_tag_indexes = _index_names("image_gallery_entry_tags")
        for index_name in (
            "ix_image_gallery_entry_tags_tag_deleted",
            "ix_image_gallery_entry_tags_entry_deleted",
            "uq_image_gallery_entry_tags_active",
        ):
            if index_name in entry_tag_indexes:
                op.drop_index(index_name, table_name="image_gallery_entry_tags")
        op.drop_table("image_gallery_entry_tags")

    table_names = _table_names()
    if "gallery_tags" in table_names:
        gallery_tag_indexes = _index_names("gallery_tags")
        for index_name in (
            "ix_gallery_tags_deleted_enabled_priority_name",
            "uq_gallery_tags_name_active",
        ):
            if index_name in gallery_tag_indexes:
                op.drop_index(index_name, table_name="gallery_tags")
        op.drop_table("gallery_tags")
