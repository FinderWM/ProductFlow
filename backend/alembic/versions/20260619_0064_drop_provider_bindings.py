"""drop legacy provider_bindings table

Revision ID: 20260619_0064
Revises: 20260619_0063
Create Date: 2026-06-19
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260619_0064"
down_revision = "20260619_0063"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def upgrade() -> None:
    # provider_bindings 仅为 generation_configs 的旧兼容镜像，运行时不读，导入也不再支持旧格式，故下线。
    if "provider_bindings" in _table_names():
        op.drop_table("provider_bindings")


def downgrade() -> None:
    if "provider_bindings" in _table_names():
        return
    op.create_table(
        "provider_bindings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("purpose", sa.String(length=40), nullable=False),
        sa.Column("provider_kind", sa.String(length=40), nullable=False),
        sa.Column("provider_profile_id", sa.String(length=36), nullable=True),
        sa.Column("model_settings_json", sa.JSON(), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_provider_bindings_purpose", "provider_bindings", ["purpose"], unique=True)
