"""add image to code jobs

Revision ID: 20260703_0068
Revises: 20260701_0067
Create Date: 2026-07-03
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260703_0068"
down_revision = "20260701_0067"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    table_names = _table_names()
    if "image_to_code_jobs" not in table_names:
        op.create_table(
            "image_to_code_jobs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("owner_user_id", sa.String(length=36), nullable=False),
            sa.Column("source_kind", sa.String(length=22), nullable=False),
            sa.Column("source_ref", sa.String(length=36), nullable=False),
            sa.Column("source_width", sa.Integer(), nullable=False),
            sa.Column("source_height", sa.Integer(), nullable=False),
            sa.Column("source_mime_type", sa.String(length=100), nullable=False),
            sa.Column("delivery_mode", sa.String(length=12), nullable=False),
            sa.Column("job_params_json", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(length=9), nullable=False),
            sa.Column("progress_phase", sa.String(length=64), nullable=True),
            sa.Column("progress_completed", sa.Integer(), nullable=False),
            sa.Column("progress_total", sa.Integer(), nullable=False),
            sa.Column("progress_updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("result_manifest_json", sa.JSON(), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    image_to_code_indexes = _index_names("image_to_code_jobs")
    if "ix_image_to_code_jobs_owner_status_created" not in image_to_code_indexes:
        op.create_index(
            "ix_image_to_code_jobs_owner_status_created",
            "image_to_code_jobs",
            ["owner_user_id", "status", "created_at"],
            unique=False,
        )
    if "ix_image_to_code_jobs_source" not in image_to_code_indexes:
        op.create_index(
            "ix_image_to_code_jobs_source",
            "image_to_code_jobs",
            ["source_kind", "source_ref"],
            unique=False,
        )


def downgrade() -> None:
    table_names = _table_names()
    if "image_to_code_jobs" not in table_names:
        return
    image_to_code_indexes = _index_names("image_to_code_jobs")
    if "ix_image_to_code_jobs_source" in image_to_code_indexes:
        op.drop_index("ix_image_to_code_jobs_source", table_name="image_to_code_jobs")
    if "ix_image_to_code_jobs_owner_status_created" in image_to_code_indexes:
        op.drop_index("ix_image_to_code_jobs_owner_status_created", table_name="image_to_code_jobs")
    op.drop_table("image_to_code_jobs")
