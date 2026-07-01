"""add enhance jobs

Revision ID: 20260630_0066
Revises: 20260625_0065
Create Date: 2026-06-30
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260630_0066"
down_revision = "20260625_0065"
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
    if "enhance_jobs" not in table_names:
        op.create_table(
            "enhance_jobs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("owner_user_id", sa.String(length=36), nullable=False),
            sa.Column("source_kind", sa.String(length=22), nullable=False),
            sa.Column("source_ref", sa.String(length=36), nullable=False),
            sa.Column("source_width", sa.Integer(), nullable=False),
            sa.Column("source_height", sa.Integer(), nullable=False),
            sa.Column("source_mime_type", sa.String(length=100), nullable=False),
            sa.Column("strategy", sa.String(length=6), nullable=False),
            sa.Column("params_json", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(length=9), nullable=False),
            sa.Column("progress_completed", sa.Integer(), nullable=False),
            sa.Column("progress_total", sa.Integer(), nullable=False),
            sa.Column("progress_updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("result_manifest_json", sa.JSON(), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("generation_config_mode", sa.String(length=20), nullable=False),
            sa.Column("requested_generation_config_id", sa.String(length=36), nullable=True),
            sa.Column("used_generation_config_id", sa.String(length=36), nullable=True),
            sa.Column("resource_group_id", sa.String(length=36), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    enhance_job_indexes = _index_names("enhance_jobs")
    if "ix_enhance_jobs_owner_status_created" not in enhance_job_indexes:
        op.create_index(
            "ix_enhance_jobs_owner_status_created",
            "enhance_jobs",
            ["owner_user_id", "status", "created_at"],
            unique=False,
        )
    if "ix_enhance_jobs_source" not in enhance_job_indexes:
        op.create_index("ix_enhance_jobs_source", "enhance_jobs", ["source_kind", "source_ref"], unique=False)
    if "ix_enhance_jobs_resource_group_id" not in enhance_job_indexes:
        op.create_index("ix_enhance_jobs_resource_group_id", "enhance_jobs", ["resource_group_id"], unique=False)

    if "enhance_job_inputs" not in table_names:
        op.create_table(
            "enhance_job_inputs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("owner_user_id", sa.String(length=36), nullable=False),
            sa.Column("storage_path", sa.String(length=500), nullable=False),
            sa.Column("storage_backend", sa.String(length=50), nullable=True),
            sa.Column("storage_bucket", sa.String(length=255), nullable=True),
            sa.Column("storage_object_key", sa.String(length=500), nullable=True),
            sa.Column("mime_type", sa.String(length=100), nullable=False),
            sa.Column("width", sa.Integer(), nullable=False),
            sa.Column("height", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_enhance_job_inputs_owner_created" not in _index_names("enhance_job_inputs"):
        op.create_index(
            "ix_enhance_job_inputs_owner_created",
            "enhance_job_inputs",
            ["owner_user_id", "created_at"],
            unique=False,
        )


def downgrade() -> None:
    table_names = _table_names()
    if "enhance_job_inputs" in table_names:
        if "ix_enhance_job_inputs_owner_created" in _index_names("enhance_job_inputs"):
            op.drop_index("ix_enhance_job_inputs_owner_created", table_name="enhance_job_inputs")
        op.drop_table("enhance_job_inputs")

    if "enhance_jobs" in table_names:
        enhance_job_indexes = _index_names("enhance_jobs")
        if "ix_enhance_jobs_resource_group_id" in enhance_job_indexes:
            op.drop_index("ix_enhance_jobs_resource_group_id", table_name="enhance_jobs")
        if "ix_enhance_jobs_source" in enhance_job_indexes:
            op.drop_index("ix_enhance_jobs_source", table_name="enhance_jobs")
        if "ix_enhance_jobs_owner_status_created" in enhance_job_indexes:
            op.drop_index("ix_enhance_jobs_owner_status_created", table_name="enhance_jobs")
        op.drop_table("enhance_jobs")
