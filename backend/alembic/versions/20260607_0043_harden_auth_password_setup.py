"""harden auth password setup

Revision ID: 20260607_0043
Revises: 20260606_0042
Create Date: 2026-06-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260607_0043"
down_revision = "20260606_0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("auth_users") as batch_op:
        batch_op.alter_column("password_hash", existing_type=sa.String(length=32), type_=sa.String(length=255))
        batch_op.alter_column("password_salt", existing_type=sa.String(length=32), type_=sa.String(length=64))
        batch_op.add_column(sa.Column("password_setup_token_hash", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("password_setup_token_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("auth_users") as batch_op:
        batch_op.drop_column("password_setup_token_expires_at")
        batch_op.drop_column("password_setup_token_hash")
        batch_op.alter_column("password_salt", existing_type=sa.String(length=64), type_=sa.String(length=32))
        batch_op.alter_column("password_hash", existing_type=sa.String(length=255), type_=sa.String(length=32))
