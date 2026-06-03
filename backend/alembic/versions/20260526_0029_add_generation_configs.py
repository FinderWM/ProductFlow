"""add generation configs

Revision ID: 20260526_0029
Revises: 20260513_0028
Create Date: 2026-05-26
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision = "20260526_0029"
down_revision = "20260513_0028"
branch_labels = None
depends_on = None


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    return any(
        foreign_key.get("name") == constraint_name
        for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
    )


def upgrade() -> None:
    op.create_table(
        "generation_configs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("purpose", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("provider_kind", sa.String(length=40), nullable=False),
        sa.Column("provider_profile_id", sa.String(length=36), nullable=True),
        sa.Column("model_settings_json", sa.JSON(), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("max_concurrency", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("availability_window_minutes", sa.Integer(), nullable=False),
        sa.Column("failure_threshold", sa.Integer(), nullable=False),
        sa.Column("cooldown_minutes", sa.Integer(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["provider_profile_id"], ["provider_profiles.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_generation_configs_archived_at", "generation_configs", ["archived_at"], unique=False)
    op.create_index("ix_generation_configs_enabled", "generation_configs", ["enabled"], unique=False)
    op.create_index("ix_generation_configs_purpose", "generation_configs", ["purpose"], unique=False)
    op.create_index(
        "ix_generation_configs_sort",
        "generation_configs",
        ["purpose", "priority", "created_at"],
        unique=False,
    )

    op.create_table(
        "generation_config_states",
        sa.Column("generation_config_id", sa.String(length=36), nullable=False),
        sa.Column("current_concurrency", sa.Integer(), nullable=False),
        sa.Column("frozen_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_window_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_count_in_window", sa.Integer(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["generation_config_id"], ["generation_configs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("generation_config_id"),
    )

    op.create_table(
        "generation_config_daily_stats",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("generation_config_id", sa.String(length=36), nullable=False),
        sa.Column("stat_date", sa.Date(), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("success_count", sa.Integer(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("timeout_count", sa.Integer(), nullable=False),
        sa.Column("throttled_count", sa.Integer(), nullable=False),
        sa.Column("generated_unit_count", sa.Integer(), nullable=False),
        sa.Column("total_latency_ms", sa.Integer(), nullable=False),
        sa.Column("freeze_count", sa.Integer(), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["generation_config_id"], ["generation_configs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_generation_config_daily_stats_stat_date",
        "generation_config_daily_stats",
        ["stat_date"],
        unique=False,
    )
    op.create_index(
        "uq_generation_config_daily_stats_config_date",
        "generation_config_daily_stats",
        ["generation_config_id", "stat_date"],
        unique=True,
    )

    with op.batch_alter_table("image_session_rounds") as batch_op:
        batch_op.add_column(sa.Column("generation_config_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_image_session_rounds_generation_config_id",
            "generation_configs",
            ["generation_config_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("image_session_generation_tasks") as batch_op:
        batch_op.add_column(
            sa.Column("generation_config_mode", sa.String(length=20), nullable=False, server_default="auto")
        )
        batch_op.add_column(sa.Column("requested_generation_config_id", sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column("used_generation_config_id", sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            "fk_img_task_requested_gen_config",
            "generation_configs",
            ["requested_generation_config_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_img_task_used_gen_config",
            "generation_configs",
            ["used_generation_config_id"],
            ["id"],
            ondelete="SET NULL",
        )

    _migrate_provider_bindings()


def downgrade() -> None:
    has_used_config_fk = _has_foreign_key("image_session_generation_tasks", "fk_img_task_used_gen_config")
    has_requested_config_fk = _has_foreign_key(
        "image_session_generation_tasks",
        "fk_img_task_requested_gen_config",
    )
    with op.batch_alter_table("image_session_generation_tasks") as batch_op:
        if has_used_config_fk:
            batch_op.drop_constraint(
                "fk_img_task_used_gen_config",
                type_="foreignkey",
            )
        if has_requested_config_fk:
            batch_op.drop_constraint(
                "fk_img_task_requested_gen_config",
                type_="foreignkey",
            )
        batch_op.drop_column("used_generation_config_id")
        batch_op.drop_column("requested_generation_config_id")
        batch_op.drop_column("generation_config_mode")
    has_round_config_fk = _has_foreign_key("image_session_rounds", "fk_image_session_rounds_generation_config_id")
    with op.batch_alter_table("image_session_rounds") as batch_op:
        if has_round_config_fk:
            batch_op.drop_constraint("fk_image_session_rounds_generation_config_id", type_="foreignkey")
        batch_op.drop_column("generation_config_id")
    op.drop_index("uq_generation_config_daily_stats_config_date", table_name="generation_config_daily_stats")
    op.drop_index("ix_generation_config_daily_stats_stat_date", table_name="generation_config_daily_stats")
    op.drop_table("generation_config_daily_stats")
    op.drop_table("generation_config_states")
    op.drop_index("ix_generation_configs_sort", table_name="generation_configs")
    op.drop_index("ix_generation_configs_purpose", table_name="generation_configs")
    op.drop_index("ix_generation_configs_enabled", table_name="generation_configs")
    op.drop_index("ix_generation_configs_archived_at", table_name="generation_configs")
    op.drop_table("generation_configs")


def _migrate_provider_bindings() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "provider_bindings" not in inspector.get_table_names():
        _insert_default_configs(bind)
        return

    provider_bindings = sa.table(
        "provider_bindings",
        sa.column("purpose", sa.String()),
        sa.column("provider_kind", sa.String()),
        sa.column("provider_profile_id", sa.String()),
        sa.column("model_settings_json", sa.JSON()),
        sa.column("config_json", sa.JSON()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    rows = bind.execute(
        sa.select(
            provider_bindings.c.purpose,
            provider_bindings.c.provider_kind,
            provider_bindings.c.provider_profile_id,
            provider_bindings.c.model_settings_json,
            provider_bindings.c.config_json,
            provider_bindings.c.created_at,
            provider_bindings.c.updated_at,
        ).order_by(provider_bindings.c.purpose)
    ).mappings().all()
    if not rows:
        _insert_default_configs(bind)
        return

    for row in rows:
        _insert_generation_config(
            bind,
            purpose=row["purpose"],
            name="默认文案配置" if row["purpose"] == "text" else "默认图片配置",
            provider_kind=row["provider_kind"],
            provider_profile_id=row["provider_profile_id"],
            model_settings=row["model_settings_json"] or {},
            config=row["config_json"] or {},
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


def _insert_default_configs(bind: sa.engine.Connection) -> None:
    _insert_generation_config(
        bind,
        purpose="text",
        name="默认文案配置",
        provider_kind="mock",
        provider_profile_id=None,
        model_settings={"brief_model": "gpt-4o", "copy_model": "gpt-4o"},
        config={},
    )
    _insert_generation_config(
        bind,
        purpose="image",
        name="默认图片配置",
        provider_kind="mock",
        provider_profile_id=None,
        model_settings={"model": "gpt-5.4"},
        config={},
    )


def _insert_generation_config(
    bind: sa.engine.Connection,
    *,
    purpose: str,
    name: str,
    provider_kind: str,
    provider_profile_id: str | None,
    model_settings: dict,
    config: dict,
    created_at: datetime | None = None,
    updated_at: datetime | None = None,
) -> None:
    now = datetime.now(UTC)
    config_id = str(uuid.uuid4())
    generation_configs = sa.table(
        "generation_configs",
        sa.column("id", sa.String()),
        sa.column("purpose", sa.String()),
        sa.column("name", sa.String()),
        sa.column("provider_kind", sa.String()),
        sa.column("provider_profile_id", sa.String()),
        sa.column("model_settings_json", sa.JSON()),
        sa.column("config_json", sa.JSON()),
        sa.column("priority", sa.Integer()),
        sa.column("max_concurrency", sa.Integer()),
        sa.column("enabled", sa.Boolean()),
        sa.column("availability_window_minutes", sa.Integer()),
        sa.column("failure_threshold", sa.Integer()),
        sa.column("cooldown_minutes", sa.Integer()),
        sa.column("archived_at", sa.DateTime(timezone=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    generation_config_states = sa.table(
        "generation_config_states",
        sa.column("generation_config_id", sa.String()),
        sa.column("current_concurrency", sa.Integer()),
        sa.column("failure_count_in_window", sa.Integer()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    bind.execute(
        generation_configs.insert().values(
            id=config_id,
            purpose=purpose,
            name=name,
            provider_kind=provider_kind,
            provider_profile_id=None if provider_kind == "mock" else provider_profile_id,
            model_settings_json=model_settings,
            config_json=config,
            priority=100,
            max_concurrency=1,
            enabled=True,
            availability_window_minutes=5,
            failure_threshold=3,
            cooldown_minutes=10,
            archived_at=None,
            created_at=created_at or now,
            updated_at=updated_at or now,
        )
    )
    bind.execute(
        generation_config_states.insert().values(
            generation_config_id=config_id,
            current_concurrency=0,
            failure_count_in_window=0,
            created_at=now,
            updated_at=now,
        )
    )
