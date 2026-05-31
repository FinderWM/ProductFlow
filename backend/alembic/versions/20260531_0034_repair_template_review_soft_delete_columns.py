"""repair template review and soft delete columns

Revision ID: 20260531_0034
Revises: 20260530_0033
Create Date: 2026-05-31
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260531_0034"
down_revision = "20260530_0033"
branch_labels = None
depends_on = None


def _table_exists(bind: sa.engine.Connection, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_names(bind: sa.engine.Connection, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_names(bind: sa.engine.Connection, table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _has_foreign_key(bind: sa.engine.Connection, table_name: str, constraint_name: str) -> bool:
    foreign_keys = sa.inspect(bind).get_foreign_keys(table_name)
    return any(foreign_key.get("name") == constraint_name for foreign_key in foreign_keys)


def _repair_canvas_template_columns(bind: sa.engine.Connection) -> None:
    if not _table_exists(bind, "canvas_templates"):
        return

    columns = _column_names(bind, "canvas_templates")
    missing_columns = [
        column
        for column in (
            sa.Column("review_status", sa.String(length=20), nullable=False, server_default="none"),
            sa.Column("review_note", sa.Text(), nullable=True),
            sa.Column("review_submitted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reviewed_by_user_id", sa.String(length=36), nullable=True),
        )
        if column.name not in columns
    ]
    future_columns = columns | {column.name for column in missing_columns}
    missing_fk = "reviewed_by_user_id" in future_columns and not _has_foreign_key(
        bind,
        "canvas_templates",
        "fk_canvas_templates_reviewed_by_user_id",
    )
    if missing_columns or missing_fk:
        with op.batch_alter_table("canvas_templates") as batch_op:
            for column in missing_columns:
                batch_op.add_column(column)
            if missing_fk:
                batch_op.create_foreign_key(
                    "fk_canvas_templates_reviewed_by_user_id",
                    "auth_users",
                    ["reviewed_by_user_id"],
                    ["id"],
                    ondelete="SET NULL",
                )

    if "ix_canvas_templates_review_status" not in _index_names(bind, "canvas_templates"):
        op.create_index("ix_canvas_templates_review_status", "canvas_templates", ["review_status"])


def _repair_soft_delete_columns(
    bind: sa.engine.Connection,
    table_name: str,
    index_name: str,
    foreign_key_name: str,
) -> None:
    if not _table_exists(bind, table_name):
        return

    columns = _column_names(bind, table_name)
    missing_columns = [
        column
        for column in (
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_by_user_id", sa.String(length=36), nullable=True),
        )
        if column.name not in columns
    ]
    future_columns = columns | {column.name for column in missing_columns}
    missing_fk = "deleted_by_user_id" in future_columns and not _has_foreign_key(
        bind,
        table_name,
        foreign_key_name,
    )
    if missing_columns or missing_fk:
        with op.batch_alter_table(table_name) as batch_op:
            for column in missing_columns:
                batch_op.add_column(column)
            if missing_fk:
                batch_op.create_foreign_key(
                    foreign_key_name,
                    "auth_users",
                    ["deleted_by_user_id"],
                    ["id"],
                    ondelete="SET NULL",
                )

    if index_name not in _index_names(bind, table_name):
        op.create_index(index_name, table_name, ["deleted_at"])


def upgrade() -> None:
    bind = op.get_bind()
    _repair_canvas_template_columns(bind)
    _repair_soft_delete_columns(
        bind,
        "products",
        "ix_products_deleted_at",
        "fk_products_deleted_by_user_id",
    )
    _repair_soft_delete_columns(
        bind,
        "image_sessions",
        "ix_image_sessions_deleted_at",
        "fk_image_sessions_deleted_by_user_id",
    )


def downgrade() -> None:
    # This is a no-op repair migration. The repaired columns belong to 0033 on clean databases.
    pass
