"""add generation config test results

Revision ID: 20260615_0058
Revises: 20260613_0057
Create Date: 2026-06-15
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260615_0058"
down_revision = "20260613_0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "generation_config_test_results" in inspector.get_table_names():
        return

    op.create_table(
        "generation_config_test_results",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("generation_config_id", sa.String(length=36), nullable=False),
        sa.Column("test_type", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("tested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("provider_kind", sa.String(length=40), nullable=True),
        sa.Column("model_summary_json", sa.JSON(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_generation_config_test_results_config_tested_at",
        "generation_config_test_results",
        ["generation_config_id", "tested_at"],
        unique=False,
    )
    op.create_index(
        "ix_generation_config_test_results_test_type",
        "generation_config_test_results",
        ["test_type"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "generation_config_test_results" not in inspector.get_table_names():
        return

    index_names = {index["name"] for index in inspector.get_indexes("generation_config_test_results")}
    if "ix_generation_config_test_results_test_type" in index_names:
        op.drop_index("ix_generation_config_test_results_test_type", table_name="generation_config_test_results")
    if "ix_generation_config_test_results_config_tested_at" in index_names:
        op.drop_index(
            "ix_generation_config_test_results_config_tested_at",
            table_name="generation_config_test_results",
        )
    op.drop_table("generation_config_test_results")
