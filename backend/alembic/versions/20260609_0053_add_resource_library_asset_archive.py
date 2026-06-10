"""add resource library asset archive visibility

Revision ID: 20260609_0053
Revises: 20260609_0052
Create Date: 2026-06-09
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260609_0053"
down_revision = "20260609_0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "resource_library_assets" not in table_names:
        return

    columns = {column["name"] for column in inspector.get_columns("resource_library_assets")}
    if "archived_at" not in columns:
        op.add_column("resource_library_assets", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))

    indexes = {index["name"] for index in inspector.get_indexes("resource_library_assets")}
    if "uq_resource_library_assets_owner_source" in indexes:
        op.drop_index("uq_resource_library_assets_owner_source", table_name="resource_library_assets")
    if "ix_resource_library_assets_owner_archived" not in indexes:
        op.create_index(
            "ix_resource_library_assets_owner_archived",
            "resource_library_assets",
            ["owner_user_id", "archived_at"],
        )
    op.create_index(
        "uq_resource_library_assets_owner_source",
        "resource_library_assets",
        ["owner_user_id", "source_type", "source_resource_id"],
        unique=True,
        sqlite_where=sa.text("source_resource_id IS NOT NULL AND archived_at IS NULL"),
        postgresql_where=sa.text("source_resource_id IS NOT NULL AND archived_at IS NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "resource_library_assets" not in table_names:
        return

    indexes = {index["name"] for index in inspector.get_indexes("resource_library_assets")}
    if "uq_resource_library_assets_owner_source" in indexes:
        op.drop_index("uq_resource_library_assets_owner_source", table_name="resource_library_assets")
    if "ix_resource_library_assets_owner_archived" in indexes:
        op.drop_index("ix_resource_library_assets_owner_archived", table_name="resource_library_assets")
    op.create_index(
        "uq_resource_library_assets_owner_source",
        "resource_library_assets",
        ["owner_user_id", "source_type", "source_resource_id"],
        unique=True,
        sqlite_where=sa.text("source_resource_id IS NOT NULL"),
        postgresql_where=sa.text("source_resource_id IS NOT NULL"),
    )

    columns = {column["name"] for column in inspector.get_columns("resource_library_assets")}
    if "archived_at" in columns:
        with op.batch_alter_table("resource_library_assets") as batch_op:
            batch_op.drop_column("archived_at")
