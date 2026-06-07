"""product resource group semantics

Revision ID: 20260606_0042
Revises: 20260606_0041
Create Date: 2026-06-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260606_0042"
down_revision = "20260606_0041"
branch_labels = None
depends_on = None

DEFAULT_RESOURCE_GROUP_ID = "00000000-0000-0000-0000-000000000100"
DEFAULT_RESOURCE_GROUP_KEY = "default"


def upgrade() -> None:
    with op.batch_alter_table("products") as batch_op:
        batch_op.add_column(
            sa.Column(
                "resource_group_id",
                sa.String(length=36),
                nullable=False,
                server_default=DEFAULT_RESOURCE_GROUP_ID,
            )
        )
        batch_op.create_index("ix_products_resource_group_id", ["resource_group_id"], unique=False)
    with op.batch_alter_table("products") as batch_op:
        batch_op.alter_column(
            "resource_group_id",
            existing_type=sa.String(length=36),
            nullable=False,
            server_default=None,
        )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE generation_resource_groups
            SET name = :name,
                description = :description
            WHERE id = :group_id
              AND key = :group_key
            """
        ),
        {
            "group_id": DEFAULT_RESOURCE_GROUP_ID,
            "group_key": DEFAULT_RESOURCE_GROUP_KEY,
            "name": DEFAULT_RESOURCE_GROUP_KEY,
            "description": "default 供应商生成能力分组",
        },
    )


def downgrade() -> None:
    with op.batch_alter_table("products") as batch_op:
        batch_op.drop_index("ix_products_resource_group_id")
        batch_op.drop_column("resource_group_id")
