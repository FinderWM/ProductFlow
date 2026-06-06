"""add generation resource groups

Revision ID: 20260606_0041
Revises: 20260603_0040
Create Date: 2026-06-06
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision = "20260606_0041"
down_revision = "20260603_0040"
branch_labels = None
depends_on = None

DEFAULT_RESOURCE_GROUP_ID = "00000000-0000-0000-0000-000000000100"
DEFAULT_RESOURCE_GROUP_KEY = "default"
DEFAULT_RESOURCE_GROUP_NAME = "默认分组"

RESOURCE_GROUP_RESULT_TABLES = (
    "creative_briefs",
    "copy_sets",
    "poster_variants",
    "workflow_node_runs",
    "image_session_rounds",
    "image_session_generation_tasks",
    "image_gallery_entries",
)


def upgrade() -> None:
    now = datetime.now(UTC)
    op.create_table(
        "generation_resource_groups",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("key", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_generation_resource_groups_key", "generation_resource_groups", ["key"], unique=True)
    op.create_index("ix_generation_resource_groups_enabled", "generation_resource_groups", ["enabled"], unique=False)
    op.create_index(
        "ix_generation_resource_groups_archived_at",
        "generation_resource_groups",
        ["archived_at"],
        unique=False,
    )
    op.create_index(
        "ix_generation_resource_groups_sort",
        "generation_resource_groups",
        ["sort_order", "created_at"],
        unique=False,
    )

    resource_groups = sa.table(
        "generation_resource_groups",
        sa.column("id", sa.String()),
        sa.column("key", sa.String()),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("sort_order", sa.Integer()),
        sa.column("enabled", sa.Boolean()),
        sa.column("archived_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        resource_groups,
        [
            {
                "id": DEFAULT_RESOURCE_GROUP_ID,
                "key": DEFAULT_RESOURCE_GROUP_KEY,
                "name": DEFAULT_RESOURCE_GROUP_NAME,
                "description": "系统内置默认供应商生成能力分组",
                "sort_order": 0,
                "enabled": True,
                "archived_at": None,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )

    op.create_table(
        "user_generation_resource_group_grants",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("resource_group_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "resource_group_id"),
    )
    op.create_index(
        "ix_user_generation_resource_group_grants_group",
        "user_generation_resource_group_grants",
        ["resource_group_id"],
        unique=False,
    )

    with op.batch_alter_table("generation_configs") as batch_op:
        batch_op.add_column(
            sa.Column(
                "resource_group_id",
                sa.String(length=36),
                nullable=False,
                server_default=DEFAULT_RESOURCE_GROUP_ID,
            )
        )
        batch_op.create_index(
            "ix_generation_configs_resource_group",
            ["resource_group_id", "purpose", "enabled"],
            unique=False,
        )
    with op.batch_alter_table("generation_configs") as batch_op:
        batch_op.alter_column(
            "resource_group_id",
            existing_type=sa.String(length=36),
            nullable=False,
            server_default=None,
        )

    for table_name in RESOURCE_GROUP_RESULT_TABLES:
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(sa.Column("resource_group_id", sa.String(length=36), nullable=True))
            batch_op.create_index(f"ix_{table_name}_resource_group_id", ["resource_group_id"], unique=False)

    _backfill_result_resource_groups()


def downgrade() -> None:
    for table_name in reversed(RESOURCE_GROUP_RESULT_TABLES):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_index(f"ix_{table_name}_resource_group_id")
            batch_op.drop_column("resource_group_id")

    with op.batch_alter_table("generation_configs") as batch_op:
        batch_op.drop_index("ix_generation_configs_resource_group")
        batch_op.drop_column("resource_group_id")

    op.drop_index("ix_user_generation_resource_group_grants_group", table_name="user_generation_resource_group_grants")
    op.drop_table("user_generation_resource_group_grants")

    op.drop_index("ix_generation_resource_groups_sort", table_name="generation_resource_groups")
    op.drop_index("ix_generation_resource_groups_archived_at", table_name="generation_resource_groups")
    op.drop_index("ix_generation_resource_groups_enabled", table_name="generation_resource_groups")
    op.drop_index("uq_generation_resource_groups_key", table_name="generation_resource_groups")
    op.drop_table("generation_resource_groups")


def _backfill_result_resource_groups() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    columns_by_table = {
        table_name: {column["name"] for column in inspector.get_columns(table_name)}
        for table_name in table_names
    }

    for table_name in ("creative_briefs", "copy_sets", "poster_variants"):
        if table_name in table_names:
            bind.execute(
                sa.text(f'UPDATE "{table_name}" SET resource_group_id = :group_id WHERE resource_group_id IS NULL'),
                {"group_id": DEFAULT_RESOURCE_GROUP_ID},
            )

    if "workflow_node_runs" in table_names:
        workflow_columns = columns_by_table["workflow_node_runs"]
        workflow_marker_columns = [
            column_name
            for column_name in (
                "used_generation_config_id",
                "copy_set_id",
                "poster_variant_id",
                "image_session_asset_id",
            )
            if column_name in workflow_columns
        ]
        workflow_marker_condition = (
            " OR ".join(f"{column_name} IS NOT NULL" for column_name in workflow_marker_columns)
            if workflow_marker_columns
            else "1 = 1"
        )
        bind.execute(
            sa.text(
                f"""
                UPDATE workflow_node_runs
                SET resource_group_id = :group_id
                WHERE resource_group_id IS NULL
                  AND ({workflow_marker_condition})
                """
            ),
            {"group_id": DEFAULT_RESOURCE_GROUP_ID},
        )

    if "image_session_rounds" in table_names and "generation_config_id" in columns_by_table["image_session_rounds"]:
        bind.execute(
            sa.text(
                """
                UPDATE image_session_rounds
                SET resource_group_id = :group_id
                WHERE resource_group_id IS NULL
                  AND generation_config_id IS NOT NULL
                """
            ),
            {"group_id": DEFAULT_RESOURCE_GROUP_ID},
        )

    if "image_session_generation_tasks" in table_names:
        task_columns = columns_by_table["image_session_generation_tasks"]
        task_marker_columns = [
            column_name
            for column_name in ("used_generation_config_id", "requested_generation_config_id")
            if column_name in task_columns
        ]
        task_marker_condition = (
            " OR ".join(f"{column_name} IS NOT NULL" for column_name in task_marker_columns)
            if task_marker_columns
            else "1 = 1"
        )
        bind.execute(
            sa.text(
                f"""
                UPDATE image_session_generation_tasks
                SET resource_group_id = :group_id
                WHERE resource_group_id IS NULL
                  AND ({task_marker_condition})
                """
            ),
            {"group_id": DEFAULT_RESOURCE_GROUP_ID},
        )

    if "image_gallery_entries" in table_names and "image_session_round_id" in columns_by_table["image_gallery_entries"]:
        bind.execute(
            sa.text(
                """
                UPDATE image_gallery_entries
                SET resource_group_id = :group_id
                WHERE resource_group_id IS NULL
                  AND image_session_round_id IS NOT NULL
                """
            ),
            {"group_id": DEFAULT_RESOURCE_GROUP_ID},
        )
