"""add image storage url

Revision ID: 20260602_0036
Revises: 20260602_0035
Create Date: 2026-06-02
"""

from __future__ import annotations

import os
from urllib.parse import quote

import sqlalchemy as sa

from alembic import op

revision = "20260602_0036"
down_revision = "20260602_0035"
branch_labels = None
depends_on = None

IMAGE_TABLES = ("source_assets", "poster_variants", "image_session_assets")


def _table_exists(bind: sa.engine.Connection, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_names(bind: sa.engine.Connection, table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _storage_public_base_url() -> str | None:
    base_url = (os.environ.get("STORAGE_PUBLIC_BASE_URL") or os.environ.get("S3_ENDPOINT_URL") or "").strip()
    return base_url.rstrip("/") or None


def _storage_bucket() -> str | None:
    bucket = (os.environ.get("S3_BUCKET") or "productflow").strip().strip("/")
    return bucket or None


def _object_url(base_url: str, bucket: str, object_key: str) -> str:
    encoded_bucket = quote(bucket, safe="")
    encoded_key = "/".join(quote(part, safe="") for part in object_key.split("/"))
    return f"{base_url}/{encoded_bucket}/{encoded_key}"


def upgrade() -> None:
    bind = op.get_bind()
    public_base_url = _storage_public_base_url()
    bucket = _storage_bucket()

    for table_name in IMAGE_TABLES:
        if not _table_exists(bind, table_name):
            continue

        columns = _column_names(bind, table_name)
        if "storage_url" not in columns:
            with op.batch_alter_table(table_name) as batch_op:
                batch_op.add_column(sa.Column("storage_url", sa.String(length=1000), nullable=True))

        if public_base_url is None or bucket is None:
            continue

        rows = bind.execute(
            sa.text(
                f"""
                SELECT id, COALESCE(storage_object_key, storage_path) AS object_key
                FROM {table_name}
                WHERE storage_url IS NULL
                  AND COALESCE(storage_object_key, storage_path) IS NOT NULL
                """
            )
        ).mappings()
        for row in rows:
            bind.execute(
                sa.text(f"UPDATE {table_name} SET storage_url = :storage_url WHERE id = :id"),
                {"storage_url": _object_url(public_base_url, bucket, row["object_key"]), "id": row["id"]},
            )


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in IMAGE_TABLES:
        if not _table_exists(bind, table_name):
            continue
        if "storage_url" not in _column_names(bind, table_name):
            continue
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.drop_column("storage_url")
