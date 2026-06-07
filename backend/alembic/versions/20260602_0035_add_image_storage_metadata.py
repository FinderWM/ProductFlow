"""add image storage metadata

Revision ID: 20260602_0035
Revises: 20260531_0034
Create Date: 2026-06-02
"""

from __future__ import annotations

import os

import sqlalchemy as sa

from alembic import op

revision = "20260602_0035"
down_revision = "20260531_0034"
branch_labels = None
depends_on = None

IMAGE_TABLES = ("source_assets", "poster_variants", "image_session_assets")


def _table_exists(bind: sa.engine.Connection, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_names(bind: sa.engine.Connection, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _backfill_backend() -> str:
    return (os.environ.get("STORAGE_BACKEND") or "local").strip().lower() or "local"


def _backfill_bucket(storage_backend: str) -> str | None:
    if storage_backend not in {"minio", "s3"}:
        return None
    bucket = (os.environ.get("S3_BUCKET") or "inspiration-one").strip()
    return bucket or None


def upgrade() -> None:
    bind = op.get_bind()
    storage_backend = _backfill_backend()
    storage_bucket = _backfill_bucket(storage_backend)

    for table_name in IMAGE_TABLES:
        if not _table_exists(bind, table_name):
            continue

        columns = _column_names(bind, table_name)
        missing_columns = [
            column
            for column in (
                sa.Column("storage_backend", sa.String(length=50), nullable=True),
                sa.Column("storage_bucket", sa.String(length=255), nullable=True),
                sa.Column("storage_object_key", sa.String(length=500), nullable=True),
            )
            if column.name not in columns
        ]
        if missing_columns:
            with op.batch_alter_table(table_name) as batch_op:
                for column in missing_columns:
                    batch_op.add_column(column)

        op.execute(
            sa.text(
                f"""
                UPDATE {table_name}
                SET storage_object_key = storage_path
                WHERE storage_object_key IS NULL
                  AND storage_path IS NOT NULL
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                UPDATE {table_name}
                SET storage_backend = :storage_backend
                WHERE storage_backend IS NULL
                  AND storage_object_key IS NOT NULL
                """
            ).bindparams(storage_backend=storage_backend)
        )
        if storage_bucket is not None:
            op.execute(
                sa.text(
                    f"""
                    UPDATE {table_name}
                    SET storage_bucket = :storage_bucket
                    WHERE storage_bucket IS NULL
                      AND storage_object_key IS NOT NULL
                    """
                ).bindparams(storage_bucket=storage_bucket)
            )


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in IMAGE_TABLES:
        if not _table_exists(bind, table_name):
            continue

        columns = _column_names(bind, table_name)
        removable_columns = [
            column_name
            for column_name in ("storage_object_key", "storage_bucket", "storage_backend")
            if column_name in columns
        ]
        if not removable_columns:
            continue

        with op.batch_alter_table(table_name) as batch_op:
            for column_name in removable_columns:
                batch_op.drop_column(column_name)
