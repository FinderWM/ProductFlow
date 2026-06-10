"""add personal resource library

Revision ID: 20260609_0051
Revises: 20260609_0050
Create Date: 2026-06-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260609_0051"
down_revision = "20260609_0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "resource_library_groups" not in table_names:
        op.create_table(
            "resource_library_groups",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("owner_user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_resource_library_groups_owner_user_id", "resource_library_groups", ["owner_user_id"])
        op.create_index(
            "ix_resource_library_groups_owner_archived",
            "resource_library_groups",
            ["owner_user_id", "archived_at"],
        )
        op.create_index(
            "uq_resource_library_groups_owner_name_active",
            "resource_library_groups",
            ["owner_user_id", "name"],
            unique=True,
            sqlite_where=sa.text("archived_at IS NULL"),
            postgresql_where=sa.text("archived_at IS NULL"),
        )

    if "resource_library_assets" not in table_names:
        op.create_table(
            "resource_library_assets",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("owner_user_id", sa.String(length=36), nullable=False),
            sa.Column("kind", sa.String(length=8), nullable=False),
            sa.Column("original_filename", sa.String(length=255), nullable=False),
            sa.Column("mime_type", sa.String(length=100), nullable=False),
            sa.Column("storage_path", sa.String(length=500), nullable=False),
            sa.Column("storage_backend", sa.String(length=50), nullable=True),
            sa.Column("storage_bucket", sa.String(length=255), nullable=True),
            sa.Column("storage_object_key", sa.String(length=500), nullable=True),
            sa.Column("source_type", sa.String(length=19), nullable=False),
            sa.Column("source_resource_id", sa.String(length=36), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("disabled_by_user_id", sa.String(length=36), nullable=True),
            sa.Column("disabled_reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_resource_library_assets_owner_user_id", "resource_library_assets", ["owner_user_id"])
        op.create_index("ix_resource_library_assets_kind", "resource_library_assets", ["kind"])
        op.create_index("ix_resource_library_assets_enabled", "resource_library_assets", ["enabled"])
        op.create_index(
            "uq_resource_library_assets_owner_source",
            "resource_library_assets",
            ["owner_user_id", "source_type", "source_resource_id"],
            unique=True,
            sqlite_where=sa.text("source_resource_id IS NOT NULL"),
            postgresql_where=sa.text("source_resource_id IS NOT NULL"),
        )

    if "resource_library_asset_groups" not in table_names:
        op.create_table(
            "resource_library_asset_groups",
            sa.Column("asset_id", sa.String(length=36), nullable=False),
            sa.Column("group_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("asset_id", "group_id"),
        )
        op.create_index(
            "ix_resource_library_asset_groups_group",
            "resource_library_asset_groups",
            ["group_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())

    if "resource_library_asset_groups" in table_names:
        op.drop_index("ix_resource_library_asset_groups_group", table_name="resource_library_asset_groups")
        op.drop_table("resource_library_asset_groups")
    if "resource_library_assets" in table_names:
        op.drop_index("uq_resource_library_assets_owner_source", table_name="resource_library_assets")
        op.drop_index("ix_resource_library_assets_enabled", table_name="resource_library_assets")
        op.drop_index("ix_resource_library_assets_kind", table_name="resource_library_assets")
        op.drop_index("ix_resource_library_assets_owner_user_id", table_name="resource_library_assets")
        op.drop_table("resource_library_assets")
    if "resource_library_groups" in table_names:
        op.drop_index("uq_resource_library_groups_owner_name_active", table_name="resource_library_groups")
        op.drop_index("ix_resource_library_groups_owner_archived", table_name="resource_library_groups")
        op.drop_index("ix_resource_library_groups_owner_user_id", table_name="resource_library_groups")
        op.drop_table("resource_library_groups")
