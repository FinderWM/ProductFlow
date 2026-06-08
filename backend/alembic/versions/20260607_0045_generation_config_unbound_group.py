"""allow unbound generation configs

Revision ID: 20260607_0045
Revises: 20260607_0044
Create Date: 2026-06-07
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260607_0045"
down_revision = "20260607_0044"
branch_labels = None
depends_on = None

DEFAULT_RESOURCE_GROUP_ID = "00000000-0000-0000-0000-000000000100"


def upgrade() -> None:
    with op.batch_alter_table("generation_configs") as batch_op:
        batch_op.alter_column(
            "resource_group_id",
            existing_type=sa.String(length=36),
            nullable=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE generation_configs
            SET resource_group_id = :resource_group_id
            WHERE resource_group_id IS NULL
            """
        ),
        {"resource_group_id": DEFAULT_RESOURCE_GROUP_ID},
    )
    with op.batch_alter_table("generation_configs") as batch_op:
        batch_op.alter_column(
            "resource_group_id",
            existing_type=sa.String(length=36),
            nullable=False,
        )
