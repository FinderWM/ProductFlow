"""add auth session watermarks

Revision ID: 20260619_0060
Revises: 20260617_0059
Create Date: 2026-06-19
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260619_0060"
down_revision = "20260617_0059"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    columns = _column_names("auth_users")
    for column_name in ("session_revoked_after", "last_login_at", "last_seen_at"):
        if column_name not in columns:
            op.add_column("auth_users", sa.Column(column_name, sa.DateTime(timezone=True), nullable=True))

    indexes = _index_names("auth_users")
    if "ix_auth_users_session_revoked_after" not in indexes:
        op.create_index("ix_auth_users_session_revoked_after", "auth_users", ["session_revoked_after"])
    if "ix_auth_users_last_seen_at" not in indexes:
        op.create_index("ix_auth_users_last_seen_at", "auth_users", ["last_seen_at"])


def downgrade() -> None:
    indexes = _index_names("auth_users")
    for index_name in ("ix_auth_users_last_seen_at", "ix_auth_users_session_revoked_after"):
        if index_name in indexes:
            op.drop_index(index_name, table_name="auth_users")

    columns = _column_names("auth_users")
    for column_name in ("last_seen_at", "last_login_at", "session_revoked_after"):
        if column_name in columns:
            op.drop_column("auth_users", column_name)
