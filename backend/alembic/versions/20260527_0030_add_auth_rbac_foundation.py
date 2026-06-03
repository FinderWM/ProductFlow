"""add auth rbac foundation

Revision ID: 20260527_0030
Revises: 20260526_0029
Create Date: 2026-05-27
"""

from __future__ import annotations

from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision = "20260527_0030"
down_revision = "20260526_0029"
branch_labels = None
depends_on = None

ADMIN_ROLE_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_ROLE_ID = "00000000-0000-0000-0000-000000000002"
ADMIN_USER_ID = "00000000-0000-0000-0000-000000000010"

MENU_DEFINITIONS = (
    ("inspirations", "灵感", 10),
    ("image_chat", "生图", 20),
    ("gallery", "画廊", 30),
    ("status", "状态", 40),
    ("usage_stats", "个人统计", 50),
    ("settings", "设置", 90),
    ("rbac", "权限管理", 100),
)

API_PERMISSION_DEFINITIONS = (
    ("inspirations:read", "inspirations", "查看灵感", "查看灵感列表、详情和历史", 10),
    ("inspirations:write", "inspirations", "维护灵感", "创建、编辑、归档灵感资源", 20),
    ("inspirations:generate", "inspirations", "灵感生成", "发起灵感工作流生成", 30),
    ("image_chat:read", "image_chat", "查看连续生图", "查看连续生图会话和图片", 10),
    ("image_chat:write", "image_chat", "维护连续生图", "创建和编辑连续生图会话", 20),
    ("image_chat:generate", "image_chat", "连续生图生成", "发起连续生图生成任务", 30),
    ("gallery:read", "gallery", "查看画廊", "查看画廊条目", 10),
    ("gallery:write", "gallery", "保存画廊", "将生成图保存到画廊", 20),
    ("status:read", "status", "查看状态", "查看生成队列和配置状态", 10),
    ("usage_stats:read", "usage_stats", "查看个人统计", "查看用户维度使用统计", 10),
    ("settings:read", "settings", "查看设置", "查看系统设置和供应商配置", 10),
    ("settings:write", "settings", "维护设置", "修改系统设置和供应商配置", 20),
    ("rbac:manage", "rbac", "管理权限", "管理用户、角色和授权", 10),
    ("resources:moderate", "rbac", "治理资源", "屏蔽或恢复用户资源", 20),
    ("templates:manage_global", "rbac", "管理全局模板", "维护全局画布模板和分类", 30),
)

DEFAULT_ROLE_MENU_CODES = {
    "inspirations",
    "image_chat",
    "gallery",
    "status",
    "usage_stats",
}

DEFAULT_ROLE_API_PERMISSION_CODES = {
    "inspirations:read",
    "inspirations:write",
    "inspirations:generate",
    "image_chat:read",
    "image_chat:write",
    "image_chat:generate",
    "gallery:read",
    "gallery:write",
    "status:read",
    "usage_stats:read",
}


def _has_foreign_key(table_name: str, constraint_name: str) -> bool:
    return any(
        foreign_key.get("name") == constraint_name
        for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
    )


def upgrade() -> None:
    op.create_table(
        "auth_roles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_auth_roles_code", "auth_roles", ["code"], unique=True)
    op.create_index("ix_auth_roles_archived_at", "auth_roles", ["archived_at"], unique=False)

    op.create_table(
        "auth_users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("username", sa.String(length=80), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("role_id", sa.String(length=36), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("password_hash", sa.String(length=32), nullable=True),
        sa.Column("password_salt", sa.String(length=32), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["auth_roles.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_auth_users_username", "auth_users", ["username"], unique=True)
    op.create_index("ix_auth_users_role_id", "auth_users", ["role_id"], unique=False)
    op.create_index("ix_auth_users_archived_at", "auth_users", ["archived_at"], unique=False)
    op.create_index(
        "uq_auth_users_single_active_admin",
        "auth_users",
        ["is_admin"],
        unique=True,
        postgresql_where=sa.text("is_admin = true AND archived_at IS NULL"),
        sqlite_where=sa.text("is_admin = 1 AND archived_at IS NULL"),
    )

    op.create_table(
        "rbac_menus",
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_table(
        "rbac_api_permissions",
        sa.Column("code", sa.String(length=120), nullable=False),
        sa.Column("menu_code", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["menu_code"], ["rbac_menus.code"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_index("ix_rbac_api_permissions_menu_code", "rbac_api_permissions", ["menu_code"], unique=False)
    op.create_index("ix_rbac_api_permissions_enabled", "rbac_api_permissions", ["enabled"], unique=False)

    op.create_table(
        "role_menu_permissions",
        sa.Column("role_id", sa.String(length=36), nullable=False),
        sa.Column("menu_code", sa.String(length=80), nullable=False),
        sa.ForeignKeyConstraint(["menu_code"], ["rbac_menus.code"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["auth_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "menu_code"),
    )
    op.create_table(
        "role_api_permissions",
        sa.Column("role_id", sa.String(length=36), nullable=False),
        sa.Column("permission_code", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["permission_code"], ["rbac_api_permissions.code"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["auth_roles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("role_id", "permission_code"),
    )

    op.create_table(
        "user_daily_usage_stats",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("stat_date", sa.Date(), nullable=False),
        sa.Column("purpose", sa.String(length=40), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("success_count", sa.Integer(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("timeout_count", sa.Integer(), nullable=False),
        sa.Column("throttled_count", sa.Integer(), nullable=False),
        sa.Column("generated_unit_count", sa.Integer(), nullable=False),
        sa.Column("total_latency_ms", sa.Integer(), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_failure_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_user_daily_usage_stats_user_date_purpose",
        "user_daily_usage_stats",
        ["user_id", "stat_date", "purpose"],
        unique=True,
    )
    op.create_index("ix_user_daily_usage_stats_stat_date", "user_daily_usage_stats", ["stat_date"], unique=False)

    op.create_table(
        "canvas_template_categories",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("disabled_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("scope IN ('global', 'user')", name="ck_canvas_template_categories_scope"),
        sa.CheckConstraint(
            "(scope = 'global' AND owner_user_id IS NULL) OR (scope = 'user' AND owner_user_id IS NOT NULL)",
            name="ck_canvas_template_categories_owner_scope",
        ),
        sa.ForeignKeyConstraint(["disabled_by_user_id"], ["auth_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["auth_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_canvas_template_categories_global_name",
        "canvas_template_categories",
        ["name"],
        unique=True,
        postgresql_where=sa.text("scope = 'global'"),
        sqlite_where=sa.text("scope = 'global'"),
    )
    op.create_index(
        "uq_canvas_template_categories_user_owner_name",
        "canvas_template_categories",
        ["owner_user_id", "name"],
        unique=True,
        postgresql_where=sa.text("scope = 'user'"),
        sqlite_where=sa.text("scope = 'user'"),
    )
    op.create_index("ix_canvas_template_categories_scope", "canvas_template_categories", ["scope"], unique=False)
    op.create_index("ix_canvas_template_categories_enabled", "canvas_template_categories", ["enabled"], unique=False)

    op.create_table(
        "canvas_templates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("scope", sa.String(length=20), nullable=False),
        sa.Column("owner_user_id", sa.String(length=36), nullable=True),
        sa.Column("category_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("template_json", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("disabled_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("scope IN ('global', 'user')", name="ck_canvas_templates_scope"),
        sa.CheckConstraint(
            "(scope = 'global' AND owner_user_id IS NULL) OR (scope = 'user' AND owner_user_id IS NOT NULL)",
            name="ck_canvas_templates_owner_scope",
        ),
        sa.ForeignKeyConstraint(["category_id"], ["canvas_template_categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["disabled_by_user_id"], ["auth_users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["auth_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_canvas_templates_key", "canvas_templates", ["key"], unique=True)
    op.create_index("ix_canvas_templates_scope", "canvas_templates", ["scope"], unique=False)
    op.create_index("ix_canvas_templates_category_id", "canvas_templates", ["category_id"], unique=False)
    op.create_index("ix_canvas_templates_enabled", "canvas_templates", ["enabled"], unique=False)
    op.create_index("ix_canvas_templates_archived_at", "canvas_templates", ["archived_at"], unique=False)

    _seed_auth_and_rbac()
    _add_core_resource_owner_columns()
    _add_core_resource_moderation_columns()


def downgrade() -> None:
    _drop_core_resource_moderation_columns()
    _drop_core_resource_owner_columns()

    op.drop_index("ix_canvas_templates_archived_at", table_name="canvas_templates")
    op.drop_index("ix_canvas_templates_enabled", table_name="canvas_templates")
    op.drop_index("ix_canvas_templates_category_id", table_name="canvas_templates")
    op.drop_index("ix_canvas_templates_scope", table_name="canvas_templates")
    op.drop_index("uq_canvas_templates_key", table_name="canvas_templates")
    op.drop_table("canvas_templates")

    op.drop_index("ix_canvas_template_categories_enabled", table_name="canvas_template_categories")
    op.drop_index("ix_canvas_template_categories_scope", table_name="canvas_template_categories")
    op.drop_index("uq_canvas_template_categories_user_owner_name", table_name="canvas_template_categories")
    op.drop_index("uq_canvas_template_categories_global_name", table_name="canvas_template_categories")
    op.drop_table("canvas_template_categories")

    op.drop_index("ix_user_daily_usage_stats_stat_date", table_name="user_daily_usage_stats")
    op.drop_index("uq_user_daily_usage_stats_user_date_purpose", table_name="user_daily_usage_stats")
    op.drop_table("user_daily_usage_stats")

    op.drop_table("role_api_permissions")
    op.drop_table("role_menu_permissions")
    op.drop_index("ix_rbac_api_permissions_enabled", table_name="rbac_api_permissions")
    op.drop_index("ix_rbac_api_permissions_menu_code", table_name="rbac_api_permissions")
    op.drop_table("rbac_api_permissions")
    op.drop_table("rbac_menus")
    op.drop_index("uq_auth_users_single_active_admin", table_name="auth_users")
    op.drop_index("ix_auth_users_archived_at", table_name="auth_users")
    op.drop_index("ix_auth_users_role_id", table_name="auth_users")
    op.drop_index("uq_auth_users_username", table_name="auth_users")
    op.drop_table("auth_users")
    op.drop_index("ix_auth_roles_archived_at", table_name="auth_roles")
    op.drop_index("uq_auth_roles_code", table_name="auth_roles")
    op.drop_table("auth_roles")


def _add_core_resource_owner_columns() -> None:
    _add_owner_column("products", "fk_products_owner_user_id", "ix_products_owner_user_id")
    _add_owner_column("image_sessions", "fk_image_sessions_owner_user_id", "ix_image_sessions_owner_user_id")
    _add_owner_column(
        "image_session_assets",
        "fk_image_session_assets_owner_user_id",
        "ix_image_session_assets_owner_user_id",
    )
    _add_owner_column(
        "image_gallery_entries",
        "fk_image_gallery_entries_owner_user_id",
        None,
    )


def _add_core_resource_moderation_columns() -> None:
    _add_moderation_columns("products", "fk_products_disabled_by_user_id", "ix_products_enabled")
    _add_moderation_columns("source_assets", "fk_source_assets_disabled_by_user_id", "ix_source_assets_enabled")
    _add_moderation_columns("poster_variants", "fk_poster_variants_disabled_by_user_id", "ix_poster_variants_enabled")
    _add_moderation_columns("image_sessions", "fk_image_sessions_disabled_by_user_id", "ix_image_sessions_enabled")
    _add_moderation_columns(
        "image_session_assets",
        "fk_image_session_assets_disabled_by_user_id",
        "ix_image_session_assets_enabled",
    )
    _add_moderation_columns(
        "image_gallery_entries",
        "fk_image_gallery_entries_disabled_by_user_id",
        "ix_image_gallery_entries_enabled",
    )


def _add_owner_column(table_name: str, fk_name: str, index_name: str | None) -> None:
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.add_column(
            sa.Column(
                "owner_user_id",
                sa.String(length=36),
                nullable=False,
                server_default=ADMIN_USER_ID,
            )
        )
        batch_op.create_foreign_key(
            fk_name,
            "auth_users",
            ["owner_user_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        if index_name is not None:
            batch_op.create_index(index_name, ["owner_user_id"], unique=False)

    with op.batch_alter_table(table_name) as batch_op:
        batch_op.alter_column(
            "owner_user_id",
            existing_type=sa.String(length=36),
            nullable=False,
            server_default=None,
        )


def _add_moderation_columns(table_name: str, fk_name: str, index_name: str | None) -> None:
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.add_column(sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch_op.add_column(sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column("disabled_by_user_id", sa.String(length=36), nullable=True))
        batch_op.add_column(sa.Column("disabled_reason", sa.Text(), nullable=True))
        batch_op.create_foreign_key(
            fk_name,
            "auth_users",
            ["disabled_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
        if index_name is not None:
            batch_op.create_index(index_name, ["enabled"], unique=False)

    with op.batch_alter_table(table_name) as batch_op:
        batch_op.alter_column(
            "enabled",
            existing_type=sa.Boolean(),
            nullable=False,
            server_default=None,
        )


def _drop_core_resource_owner_columns() -> None:
    _drop_owner_column(
        "image_gallery_entries",
        "fk_image_gallery_entries_owner_user_id",
        None,
    )
    _drop_owner_column(
        "image_session_assets",
        "fk_image_session_assets_owner_user_id",
        "ix_image_session_assets_owner_user_id",
    )
    _drop_owner_column("image_sessions", "fk_image_sessions_owner_user_id", "ix_image_sessions_owner_user_id")
    _drop_owner_column("products", "fk_products_owner_user_id", "ix_products_owner_user_id")


def _drop_core_resource_moderation_columns() -> None:
    _drop_moderation_columns(
        "image_gallery_entries",
        "fk_image_gallery_entries_disabled_by_user_id",
        "ix_image_gallery_entries_enabled",
    )
    _drop_moderation_columns(
        "image_session_assets",
        "fk_image_session_assets_disabled_by_user_id",
        "ix_image_session_assets_enabled",
    )
    _drop_moderation_columns(
        "image_sessions",
        "fk_image_sessions_disabled_by_user_id",
        "ix_image_sessions_enabled",
    )
    _drop_moderation_columns(
        "poster_variants",
        "fk_poster_variants_disabled_by_user_id",
        "ix_poster_variants_enabled",
    )
    _drop_moderation_columns(
        "source_assets",
        "fk_source_assets_disabled_by_user_id",
        "ix_source_assets_enabled",
    )
    _drop_moderation_columns("products", "fk_products_disabled_by_user_id", "ix_products_enabled")


def _drop_owner_column(table_name: str, fk_name: str, index_name: str | None) -> None:
    has_fk = _has_foreign_key(table_name, fk_name)
    with op.batch_alter_table(table_name) as batch_op:
        if index_name is not None:
            batch_op.drop_index(index_name)
        if has_fk:
            batch_op.drop_constraint(fk_name, type_="foreignkey")
        batch_op.drop_column("owner_user_id")


def _drop_moderation_columns(table_name: str, fk_name: str, index_name: str | None) -> None:
    has_fk = _has_foreign_key(table_name, fk_name)
    with op.batch_alter_table(table_name) as batch_op:
        if index_name is not None:
            batch_op.drop_index(index_name)
        if has_fk:
            batch_op.drop_constraint(fk_name, type_="foreignkey")
        batch_op.drop_column("disabled_reason")
        batch_op.drop_column("disabled_by_user_id")
        batch_op.drop_column("disabled_at")
        batch_op.drop_column("enabled")


def _seed_auth_and_rbac() -> None:
    now = datetime.now(UTC)
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO auth_roles (id, code, name, is_admin, archived_at, created_at, updated_at)
            VALUES
                (:admin_role_id, 'admin', '管理员', :admin_is_admin, NULL, :now, :now),
                (:default_role_id, 'member', '普通用户', :default_is_admin, NULL, :now, :now)
            """
        ),
        {
            "admin_role_id": ADMIN_ROLE_ID,
            "default_role_id": DEFAULT_ROLE_ID,
            "admin_is_admin": True,
            "default_is_admin": False,
            "now": now,
        },
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO auth_users (
                id, username, display_name, role_id, is_admin, password_hash, password_salt,
                enabled, archived_at, created_at, updated_at
            )
            VALUES (:id, 'libow', 'libow', :role_id, :is_admin, NULL, NULL, :enabled, NULL, :now, :now)
            """
        ),
        {"id": ADMIN_USER_ID, "role_id": ADMIN_ROLE_ID, "is_admin": True, "enabled": True, "now": now},
    )

    menus = sa.table(
        "rbac_menus",
        sa.column("code", sa.String()),
        sa.column("title", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("enabled", sa.Boolean()),
    )
    bind.execute(
        menus.insert(),
        [
            {"code": code, "title": title, "sort_order": sort_order, "enabled": True}
            for code, title, sort_order in MENU_DEFINITIONS
        ],
    )

    api_permissions = sa.table(
        "rbac_api_permissions",
        sa.column("code", sa.String()),
        sa.column("menu_code", sa.String()),
        sa.column("title", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("sort_order", sa.Integer()),
        sa.column("enabled", sa.Boolean()),
    )
    bind.execute(
        api_permissions.insert(),
        [
            {
                "code": code,
                "menu_code": menu_code,
                "title": title,
                "description": description,
                "sort_order": sort_order,
                "enabled": True,
            }
            for code, menu_code, title, description, sort_order in API_PERMISSION_DEFINITIONS
        ],
    )

    role_menu_permissions = sa.table(
        "role_menu_permissions",
        sa.column("role_id", sa.String()),
        sa.column("menu_code", sa.String()),
    )
    bind.execute(
        role_menu_permissions.insert(),
        [{"role_id": DEFAULT_ROLE_ID, "menu_code": menu_code} for menu_code in sorted(DEFAULT_ROLE_MENU_CODES)],
    )

    role_api_permissions = sa.table(
        "role_api_permissions",
        sa.column("role_id", sa.String()),
        sa.column("permission_code", sa.String()),
    )
    bind.execute(
        role_api_permissions.insert(),
        [
            {"role_id": DEFAULT_ROLE_ID, "permission_code": permission_code}
            for permission_code in sorted(DEFAULT_ROLE_API_PERMISSION_CODES)
        ],
    )
