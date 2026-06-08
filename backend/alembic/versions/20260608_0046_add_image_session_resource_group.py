"""add image session resource group

Revision ID: 20260608_0046
Revises: 20260607_0045
Create Date: 2026-06-08
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260608_0046"
down_revision = "20260607_0045"
branch_labels = None
depends_on = None

DEFAULT_RESOURCE_GROUP_ID = "00000000-0000-0000-0000-000000000100"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    image_session_columns = {column["name"] for column in inspector.get_columns("image_sessions")}

    if "resource_group_id" not in image_session_columns:
        with op.batch_alter_table("image_sessions") as batch_op:
            batch_op.add_column(sa.Column("resource_group_id", sa.String(length=36), nullable=True))

    _backfill_image_session_resource_groups()

    bind.execute(
        sa.text(
            """
            UPDATE generation_resource_groups
            SET name = :name,
                description = :description
            WHERE id = :resource_group_id
              AND key = :resource_group_key
            """
        ),
        {
            "resource_group_id": DEFAULT_RESOURCE_GROUP_ID,
            "resource_group_key": "default",
            "name": "default",
            "description": "default 供应商生成能力分组",
        },
    )

    bind.execute(
        sa.text(
            """
            UPDATE image_sessions
            SET resource_group_id = :resource_group_id
            WHERE resource_group_id IS NULL
            """
        ),
        {"resource_group_id": DEFAULT_RESOURCE_GROUP_ID},
    )
    _backfill_image_session_list_records()

    image_session_indexes = {index["name"] for index in inspector.get_indexes("image_sessions")}
    with op.batch_alter_table("image_sessions") as batch_op:
        batch_op.alter_column("resource_group_id", existing_type=sa.String(length=36), nullable=False)
        if "ix_image_sessions_resource_group_id" not in image_session_indexes:
            batch_op.create_index("ix_image_sessions_resource_group_id", ["resource_group_id"])

    _create_index_if_missing(
        inspector,
        table_name="image_session_rounds",
        index_name="ix_image_session_rounds_session_resource_group",
        columns=["session_id", "resource_group_id"],
    )
    _create_index_if_missing(
        inspector,
        table_name="image_session_generation_tasks",
        index_name="ix_image_session_generation_tasks_session_resource_group",
        columns=["session_id", "resource_group_id"],
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    _drop_index_if_present(
        inspector,
        table_name="image_session_generation_tasks",
        index_name="ix_image_session_generation_tasks_session_resource_group",
    )
    _drop_index_if_present(
        inspector,
        table_name="image_session_rounds",
        index_name="ix_image_session_rounds_session_resource_group",
    )
    image_session_columns = {column["name"] for column in inspector.get_columns("image_sessions")}
    if "resource_group_id" in image_session_columns:
        image_session_indexes = {index["name"] for index in inspector.get_indexes("image_sessions")}
        with op.batch_alter_table("image_sessions") as batch_op:
            if "ix_image_sessions_resource_group_id" in image_session_indexes:
                batch_op.drop_index("ix_image_sessions_resource_group_id")
            batch_op.drop_column("resource_group_id")


def _backfill_image_session_resource_groups() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE image_sessions
            SET resource_group_id = (
                SELECT image_session_rounds.resource_group_id
                FROM image_session_rounds
                WHERE image_session_rounds.session_id = image_sessions.id
                  AND image_session_rounds.resource_group_id IS NOT NULL
                ORDER BY image_session_rounds.created_at DESC, image_session_rounds.id DESC
                LIMIT 1
            )
            WHERE resource_group_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM image_session_rounds
                  WHERE image_session_rounds.session_id = image_sessions.id
                    AND image_session_rounds.resource_group_id IS NOT NULL
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE image_sessions
            SET resource_group_id = (
                SELECT image_session_generation_tasks.resource_group_id
                FROM image_session_generation_tasks
                WHERE image_session_generation_tasks.session_id = image_sessions.id
                  AND image_session_generation_tasks.resource_group_id IS NOT NULL
                ORDER BY image_session_generation_tasks.created_at DESC, image_session_generation_tasks.id DESC
                LIMIT 1
            )
            WHERE resource_group_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM image_session_generation_tasks
                  WHERE image_session_generation_tasks.session_id = image_sessions.id
                    AND image_session_generation_tasks.resource_group_id IS NOT NULL
              )
            """
        )
    )
    _backfill_image_session_list_records()


def _backfill_image_session_list_records() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE image_session_rounds
            SET resource_group_id = (
                SELECT image_sessions.resource_group_id
                FROM image_sessions
                WHERE image_sessions.id = image_session_rounds.session_id
            )
            WHERE resource_group_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM image_sessions
                  WHERE image_sessions.id = image_session_rounds.session_id
                    AND image_sessions.resource_group_id IS NOT NULL
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE image_session_generation_tasks
            SET resource_group_id = (
                SELECT image_sessions.resource_group_id
                FROM image_sessions
                WHERE image_sessions.id = image_session_generation_tasks.session_id
            )
            WHERE resource_group_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM image_sessions
                  WHERE image_sessions.id = image_session_generation_tasks.session_id
                    AND image_sessions.resource_group_id IS NOT NULL
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE image_gallery_entries
            SET resource_group_id = (
                SELECT image_session_rounds.resource_group_id
                FROM image_session_rounds
                WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id
            )
            WHERE resource_group_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM image_session_rounds
                  WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id
                    AND image_session_rounds.resource_group_id IS NOT NULL
              )
            """
        )
    )


def _create_index_if_missing(
    inspector: sa.Inspector,
    *,
    table_name: str,
    index_name: str,
    columns: list[str],
) -> None:
    index_names = {index["name"] for index in inspector.get_indexes(table_name)}
    if index_name in index_names:
        return
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.create_index(index_name, columns)


def _drop_index_if_present(inspector: sa.Inspector, *, table_name: str, index_name: str) -> None:
    index_names = {index["name"] for index in inspector.get_indexes(table_name)}
    if index_name not in index_names:
        return
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.drop_index(index_name)
