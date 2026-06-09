"""add generation config resource group links

Revision ID: 20260609_0050
Revises: 20260609_0049
Create Date: 2026-06-09
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision = "20260609_0050"
down_revision = "20260609_0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "generation_config_resource_groups" not in inspector.get_table_names():
        op.create_table(
            "generation_config_resource_groups",
            sa.Column("generation_config_id", sa.String(length=36), nullable=False),
            sa.Column("resource_group_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("generation_config_id", "resource_group_id"),
        )
        op.create_index(
            "ix_generation_config_resource_groups_group",
            "generation_config_resource_groups",
            ["resource_group_id"],
            unique=False,
        )

    _backfill_generation_config_resource_groups()


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "generation_config_resource_groups" not in inspector.get_table_names():
        return

    op.drop_index(
        "ix_generation_config_resource_groups_group",
        table_name="generation_config_resource_groups",
    )
    op.drop_table("generation_config_resource_groups")


def _backfill_generation_config_resource_groups() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    if "generation_configs" not in table_names or "generation_config_resource_groups" not in table_names:
        return
    generation_config_columns = {column["name"] for column in inspector.get_columns("generation_configs")}
    if "resource_group_id" not in generation_config_columns:
        return

    existing_pairs = {
        (row["generation_config_id"], row["resource_group_id"])
        for row in bind.execute(
            sa.text(
                """
                SELECT generation_config_id, resource_group_id
                FROM generation_config_resource_groups
                """
            )
        ).mappings()
    }
    now = datetime.now(UTC)
    for row in bind.execute(
        sa.text(
            """
            SELECT id, resource_group_id
            FROM generation_configs
            WHERE resource_group_id IS NOT NULL
            """
        )
    ).mappings():
        pair = (row["id"], row["resource_group_id"])
        if pair in existing_pairs:
            continue
        bind.execute(
            sa.text(
                """
                INSERT INTO generation_config_resource_groups
                    (generation_config_id, resource_group_id, created_at)
                VALUES
                    (:generation_config_id, :resource_group_id, :created_at)
                """
            ),
            {
                "generation_config_id": row["id"],
                "resource_group_id": row["resource_group_id"],
                "created_at": now,
            },
        )
