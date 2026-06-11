from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, foreign, mapped_column, relationship

from inspiration_one_backend.domain.enums import (
    CopyStatus,
    ImageSessionAssetKind,
    JobStatus,
    PosterKind,
    ResourceLibraryAssetKind,
    ResourceLibrarySourceType,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
    WorkflowRunStatus,
)
from inspiration_one_backend.domain.rbac import ADMIN_USER_ID

DEFAULT_GENERATION_RESOURCE_GROUP_ID = "00000000-0000-0000-0000-000000000100"
DEFAULT_GENERATION_RESOURCE_GROUP_KEY = "default"


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid4())


def enum_value_column(enum_cls: type) -> SqlEnum:
    return SqlEnum(
        enum_cls,
        name=enum_cls.__name__.lower(),
        values_callable=lambda members: [member.value for member in members],
        validate_strings=True,
        native_enum=False,
        create_constraint=False,
        length=max(len(member.value) for member in enum_cls),
    )


def child_parent_join(child_column: Any, parent_column: Any) -> Any:
    return foreign(child_column) == parent_column


def parent_child_join(parent_column: Any, child_column: Any) -> Any:
    return parent_column == foreign(child_column)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class AppSetting(Base, TimestampMixin):
    """运行时配置的键值存储（可在运行时覆盖环境变量配置）。"""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class AuthRole(Base, TimestampMixin):
    """账号角色；管理员角色由 is_admin 固定表达全权限。"""

    __tablename__ = "auth_roles"
    __table_args__ = (
        Index("uq_auth_roles_code", "code", unique=True),
        Index("ix_auth_roles_archived_at", "archived_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    users: Mapped[list[AuthUser]] = relationship(
        back_populates="role",
        primaryjoin=lambda: parent_child_join(AuthRole.id, AuthUser.role_id),
        foreign_keys=lambda: [AuthUser.role_id],
    )


class AuthUser(Base, TimestampMixin):
    """可登录账号；password_hash 为空表示待设置密码。"""

    __tablename__ = "auth_users"
    __table_args__ = (
        Index("uq_auth_users_username", "username", unique=True),
        Index("ix_auth_users_role_id", "role_id"),
        Index("ix_auth_users_archived_at", "archived_at"),
        Index(
            "uq_auth_users_single_active_admin",
            "is_admin",
            unique=True,
            postgresql_where=text("is_admin = true AND archived_at IS NULL"),
            sqlite_where=text("is_admin = 1 AND archived_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(80), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role_id: Mapped[str] = mapped_column(String(36))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_salt: Mapped[str | None] = mapped_column(String(64), nullable=True)
    password_setup_token_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_setup_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    role: Mapped[AuthRole] = relationship(
        back_populates="users",
        primaryjoin=lambda: child_parent_join(AuthUser.role_id, AuthRole.id),
        foreign_keys=lambda: [AuthUser.role_id],
    )
    ui_preferences: Mapped[UserUiPreference | None] = relationship(
        back_populates="user",
        primaryjoin=lambda: parent_child_join(AuthUser.id, UserUiPreference.user_id),
        foreign_keys=lambda: [UserUiPreference.user_id],
        uselist=False,
    )


class UserUiPreference(Base, TimestampMixin):
    """账号级 UI 偏好，只影响当前用户的展示方式。"""

    __tablename__ = "user_ui_preferences"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ui_layout_scheme: Mapped[str] = mapped_column(String(32), default="classic")
    mask_sensitive_images_in_inspirations: Mapped[bool] = mapped_column(Boolean, default=True)
    mask_sensitive_images_in_image_chat: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped[AuthUser] = relationship(
        back_populates="ui_preferences",
        primaryjoin=lambda: child_parent_join(UserUiPreference.user_id, AuthUser.id),
        foreign_keys=lambda: [UserUiPreference.user_id],
    )


class RbacMenu(Base):
    """前端一级入口权限。"""

    __tablename__ = "rbac_menus"

    code: Mapped[str] = mapped_column(String(80), primary_key=True)
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    api_permissions: Mapped[list[RbacApiPermission]] = relationship(
        back_populates="menu",
        primaryjoin=lambda: parent_child_join(RbacMenu.code, RbacApiPermission.menu_code),
        foreign_keys=lambda: [RbacApiPermission.menu_code],
    )


class RbacApiPermission(Base):
    """接口权限；挂在菜单下展示，后端独立校验 code。"""

    __tablename__ = "rbac_api_permissions"
    __table_args__ = (
        Index("ix_rbac_api_permissions_menu_code", "menu_code"),
        Index("ix_rbac_api_permissions_enabled", "enabled"),
    )

    code: Mapped[str] = mapped_column(String(120), primary_key=True)
    menu_code: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    menu: Mapped[RbacMenu] = relationship(
        back_populates="api_permissions",
        primaryjoin=lambda: child_parent_join(RbacApiPermission.menu_code, RbacMenu.code),
        foreign_keys=lambda: [RbacApiPermission.menu_code],
    )


class RoleMenuPermission(Base):
    __tablename__ = "role_menu_permissions"

    role_id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
    )
    menu_code: Mapped[str] = mapped_column(
        String(80),
        primary_key=True,
    )


class RoleApiPermission(Base):
    __tablename__ = "role_api_permissions"

    role_id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
    )
    permission_code: Mapped[str] = mapped_column(
        String(120),
        primary_key=True,
    )


class UserDailyUsageStat(Base, TimestampMixin):
    """用户维度每日生成统计。"""

    __tablename__ = "user_daily_usage_stats"
    __table_args__ = (
        Index("uq_user_daily_usage_stats_user_date_purpose", "user_id", "stat_date", "purpose", unique=True),
        Index("ix_user_daily_usage_stats_stat_date", "stat_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(String(36))
    stat_date: Mapped[date] = mapped_column(Date, nullable=False)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    timeout_count: Mapped[int] = mapped_column(Integer, default=0)
    throttled_count: Mapped[int] = mapped_column(Integer, default=0)
    generated_unit_count: Mapped[int] = mapped_column(Integer, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[AuthUser] = relationship(
        primaryjoin=lambda: child_parent_join(UserDailyUsageStat.user_id, AuthUser.id),
        foreign_keys=lambda: [UserDailyUsageStat.user_id],
    )


class GenerationResourceGroup(Base, TimestampMixin):
    """供应商+生成能力分组，普通生成入口只选择分组。"""

    __tablename__ = "generation_resource_groups"
    __table_args__ = (
        Index("uq_generation_resource_groups_key", "key", unique=True),
        Index("ix_generation_resource_groups_enabled", "enabled"),
        Index("ix_generation_resource_groups_archived_at", "archived_at"),
        Index("ix_generation_resource_groups_sort", "sort_order", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    blur_images_by_default: Mapped[bool] = mapped_column(Boolean, default=False)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UserGenerationResourceGroupGrant(Base):
    """账号级供应商能力分组授权。"""

    __tablename__ = "user_generation_resource_group_grants"
    __table_args__ = (Index("ix_user_generation_resource_group_grants_group", "resource_group_id"),)

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    resource_group_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GenerationConfigResourceGroup(Base):
    """生成配置和供应商能力分组的多对多绑定。"""

    __tablename__ = "generation_config_resource_groups"
    __table_args__ = (Index("ix_generation_config_resource_groups_group", "resource_group_id"),)

    generation_config_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    resource_group_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    generation_config: Mapped[GenerationConfig] = relationship(
        back_populates="resource_group_links",
        primaryjoin=lambda: parent_child_join(GenerationConfig.id, GenerationConfigResourceGroup.generation_config_id),
        foreign_keys=lambda: [GenerationConfigResourceGroup.generation_config_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(
            GenerationConfigResourceGroup.resource_group_id,
            GenerationResourceGroup.id,
        ),
        foreign_keys=lambda: [GenerationConfigResourceGroup.resource_group_id],
    )


class CanvasTemplateCategory(Base, TimestampMixin):
    """数据库化画布模板分类，支持全局和用户个人范围。"""

    __tablename__ = "canvas_template_categories"
    __table_args__ = (
        Index(
            "uq_canvas_template_categories_global_name",
            "name",
            unique=True,
            postgresql_where=text("scope = 'global'"),
            sqlite_where=text("scope = 'global'"),
        ),
        Index(
            "uq_canvas_template_categories_user_owner_name",
            "owner_user_id",
            "name",
            unique=True,
            postgresql_where=text("scope = 'user'"),
            sqlite_where=text("scope = 'user'"),
        ),
        Index("ix_canvas_template_categories_scope", "scope"),
        Index("ix_canvas_template_categories_enabled", "enabled"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    owner_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(CanvasTemplateCategory.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [CanvasTemplateCategory.owner_user_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(CanvasTemplateCategory.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [CanvasTemplateCategory.disabled_by_user_id],
    )


class CanvasTemplate(Base, TimestampMixin):
    """数据库化画布模板，支持全局模板和用户个人模板。"""

    __tablename__ = "canvas_templates"
    __table_args__ = (
        Index("uq_canvas_templates_key", "key", unique=True),
        Index("ix_canvas_templates_scope", "scope"),
        Index("ix_canvas_templates_entry_mode", "entry_mode"),
        Index("ix_canvas_templates_category_id", "category_id"),
        Index("ix_canvas_templates_enabled", "enabled"),
        Index("ix_canvas_templates_archived_at", "archived_at"),
        Index("ix_canvas_templates_review_status", "review_status"),
        Index("ix_canvas_templates_sort_order", "sort_order"),
        Index(
            "ix_canvas_templates_scope_owner_entry_category_sort",
            "scope",
            "owner_user_id",
            "entry_mode",
            "category_id",
            "sort_order",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    owner_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    category_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(40), default="full_canvas")
    entry_mode: Mapped[str] = mapped_column(String(20), default="image")
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    template_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[str] = mapped_column(String(20), default="none")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )

    owner: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(CanvasTemplate.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [CanvasTemplate.owner_user_id],
    )
    category: Mapped[CanvasTemplateCategory | None] = relationship(
        primaryjoin=lambda: child_parent_join(CanvasTemplate.category_id, CanvasTemplateCategory.id),
        foreign_keys=lambda: [CanvasTemplate.category_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(CanvasTemplate.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [CanvasTemplate.disabled_by_user_id],
    )
    reviewed_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(CanvasTemplate.reviewed_by_user_id, AuthUser.id),
        foreign_keys=lambda: [CanvasTemplate.reviewed_by_user_id],
    )


class ProviderProfile(Base, TimestampMixin):
    """统一供应商档案，持有连接信息和可用能力。"""

    __tablename__ = "provider_profiles"
    __table_args__ = (
        Index("ix_provider_profiles_enabled", "enabled"),
        Index("ix_provider_profiles_archived_at", "archived_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    provider_type: Mapped[str] = mapped_column(String(40), default="openai_compatible")
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    capabilities_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    default_models_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    generation_configs: Mapped[list[GenerationConfig]] = relationship(
        back_populates="provider_profile",
        primaryjoin=lambda: parent_child_join(ProviderProfile.id, GenerationConfig.provider_profile_id),
        foreign_keys=lambda: [GenerationConfig.provider_profile_id],
    )


class GenerationConfig(Base, TimestampMixin):
    """可调度的文案/图片生成配置，运行时生成 provider 的唯一配置来源。"""

    __tablename__ = "generation_configs"
    __table_args__ = (
        Index("ix_generation_configs_purpose", "purpose"),
        Index("ix_generation_configs_enabled", "enabled"),
        Index("ix_generation_configs_archived_at", "archived_at"),
        Index("ix_generation_configs_sort", "purpose", "priority", "created_at"),
        Index("ix_generation_configs_resource_group", "resource_group_id", "purpose", "enabled"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    provider_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_profile_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    resource_group_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    model_settings_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    availability_window_minutes: Mapped[int] = mapped_column(Integer, default=5)
    failure_threshold: Mapped[int] = mapped_column(Integer, default=3)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=10)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    provider_profile: Mapped[ProviderProfile | None] = relationship(
        back_populates="generation_configs",
        primaryjoin=lambda: child_parent_join(GenerationConfig.provider_profile_id, ProviderProfile.id),
        foreign_keys=lambda: [GenerationConfig.provider_profile_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(GenerationConfig.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [GenerationConfig.resource_group_id],
    )
    resource_group_links: Mapped[list[GenerationConfigResourceGroup]] = relationship(
        back_populates="generation_config",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(GenerationConfig.id, GenerationConfigResourceGroup.generation_config_id),
        foreign_keys=lambda: [GenerationConfigResourceGroup.generation_config_id],
        order_by=lambda: (GenerationConfigResourceGroup.created_at, GenerationConfigResourceGroup.resource_group_id),
    )
    state: Mapped[GenerationConfigState | None] = relationship(
        back_populates="generation_config",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(GenerationConfig.id, GenerationConfigState.generation_config_id),
        foreign_keys=lambda: [GenerationConfigState.generation_config_id],
        uselist=False,
    )
    daily_stats: Mapped[list[GenerationConfigDailyStat]] = relationship(
        back_populates="generation_config",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(GenerationConfig.id, GenerationConfigDailyStat.generation_config_id),
        foreign_keys=lambda: [GenerationConfigDailyStat.generation_config_id],
    )


class GenerationConfigState(Base, TimestampMixin):
    """生成配置运行态：当前并发、失败窗口和冻结信息。"""

    __tablename__ = "generation_config_states"

    generation_config_id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
    )
    current_concurrency: Mapped[int] = mapped_column(Integer, default=0)
    frozen_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_window_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_count_in_window: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    generation_config: Mapped[GenerationConfig] = relationship(
        back_populates="state",
        primaryjoin=lambda: child_parent_join(GenerationConfigState.generation_config_id, GenerationConfig.id),
        foreign_keys=lambda: [GenerationConfigState.generation_config_id],
    )


class GenerationConfigDailyStat(Base, TimestampMixin):
    """按当前机器时区自然日聚合的生成配置统计。"""

    __tablename__ = "generation_config_daily_stats"
    __table_args__ = (
        Index(
            "uq_generation_config_daily_stats_config_date",
            "generation_config_id",
            "stat_date",
            unique=True,
        ),
        Index("ix_generation_config_daily_stats_stat_date", "stat_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    generation_config_id: Mapped[str] = mapped_column(
        String(36),
    )
    stat_date: Mapped[date] = mapped_column(Date, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)
    timeout_count: Mapped[int] = mapped_column(Integer, default=0)
    throttled_count: Mapped[int] = mapped_column(Integer, default=0)
    generated_unit_count: Mapped[int] = mapped_column(Integer, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    freeze_count: Mapped[int] = mapped_column(Integer, default=0)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    generation_config: Mapped[GenerationConfig] = relationship(
        back_populates="daily_stats",
        primaryjoin=lambda: child_parent_join(GenerationConfigDailyStat.generation_config_id, GenerationConfig.id),
        foreign_keys=lambda: [GenerationConfigDailyStat.generation_config_id],
    )


class ProviderBinding(Base, TimestampMixin):
    """用途绑定，表达文案/图片当前使用哪个供应商和接口。"""

    __tablename__ = "provider_bindings"
    __table_args__ = (Index("uq_provider_bindings_purpose", "purpose", unique=True),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_profile_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    model_settings_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    provider_profile: Mapped[ProviderProfile | None] = relationship(
        primaryjoin=lambda: child_parent_join(ProviderBinding.provider_profile_id, ProviderProfile.id),
        foreign_keys=lambda: [ProviderBinding.provider_profile_id],
    )


class UserCanvasTemplate(Base, TimestampMixin):
    """用户保存的可复用画布节点组模板。"""

    __tablename__ = "user_canvas_templates"
    __table_args__ = (Index("ix_user_canvas_templates_archived_at", "archived_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(40), default="node_group")
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    template_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResourceLibraryGroup(Base, TimestampMixin):
    """用户个人资源库分组。"""

    __tablename__ = "resource_library_groups"
    __table_args__ = (
        Index("ix_resource_library_groups_owner_user_id", "owner_user_id"),
        Index("ix_resource_library_groups_owner_archived", "owner_user_id", "archived_at"),
        Index(
            "uq_resource_library_groups_owner_name_active",
            "owner_user_id",
            "name",
            unique=True,
            postgresql_where=text("archived_at IS NULL"),
            sqlite_where=text("archived_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), default=ADMIN_USER_ID)
    name: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped[AuthUser] = relationship(
        primaryjoin=lambda: child_parent_join(ResourceLibraryGroup.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [ResourceLibraryGroup.owner_user_id],
    )
    asset_links: Mapped[list[ResourceLibraryAssetGroup]] = relationship(
        back_populates="group",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(ResourceLibraryGroup.id, ResourceLibraryAssetGroup.group_id),
        foreign_keys=lambda: [ResourceLibraryAssetGroup.group_id],
    )


class ResourceLibraryAsset(Base, TimestampMixin):
    """用户个人资源库资产。"""

    __tablename__ = "resource_library_assets"
    __table_args__ = (
        Index("ix_resource_library_assets_owner_user_id", "owner_user_id"),
        Index("ix_resource_library_assets_kind", "kind"),
        Index("ix_resource_library_assets_enabled", "enabled"),
        Index("ix_resource_library_assets_owner_archived", "owner_user_id", "archived_at"),
        Index(
            "uq_resource_library_assets_owner_source",
            "owner_user_id",
            "source_type",
            "source_resource_id",
            unique=True,
            postgresql_where=text("source_resource_id IS NOT NULL AND archived_at IS NULL"),
            sqlite_where=text("source_resource_id IS NOT NULL AND archived_at IS NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(String(36), default=ADMIN_USER_ID)
    kind: Mapped[ResourceLibraryAssetKind] = mapped_column(enum_value_column(ResourceLibraryAssetKind))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(500))
    storage_backend: Mapped[str | None] = mapped_column(String(50), nullable=True)
    storage_bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_type: Mapped[ResourceLibrarySourceType] = mapped_column(enum_value_column(ResourceLibrarySourceType))
    source_resource_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped[AuthUser] = relationship(
        primaryjoin=lambda: child_parent_join(ResourceLibraryAsset.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [ResourceLibraryAsset.owner_user_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(ResourceLibraryAsset.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [ResourceLibraryAsset.disabled_by_user_id],
    )
    group_links: Mapped[list[ResourceLibraryAssetGroup]] = relationship(
        back_populates="asset",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(ResourceLibraryAsset.id, ResourceLibraryAssetGroup.asset_id),
        foreign_keys=lambda: [ResourceLibraryAssetGroup.asset_id],
    )


class ResourceLibraryAssetGroup(Base):
    """个人资源库资产与分组的多对多关系。"""

    __tablename__ = "resource_library_asset_groups"
    __table_args__ = (Index("ix_resource_library_asset_groups_group", "group_id"),)

    asset_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    group_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    asset: Mapped[ResourceLibraryAsset] = relationship(
        back_populates="group_links",
        primaryjoin=lambda: child_parent_join(ResourceLibraryAssetGroup.asset_id, ResourceLibraryAsset.id),
        foreign_keys=lambda: [ResourceLibraryAssetGroup.asset_id],
    )
    group: Mapped[ResourceLibraryGroup] = relationship(
        back_populates="asset_links",
        primaryjoin=lambda: child_parent_join(ResourceLibraryAssetGroup.group_id, ResourceLibraryGroup.id),
        foreign_keys=lambda: [ResourceLibraryAssetGroup.group_id],
    )


class Inspiration(Base, TimestampMixin):
    __tablename__ = "inspirations"
    __table_args__ = (
        Index("ix_inspirations_owner_user_id", "owner_user_id"),
        Index("ix_inspirations_resource_group_id", "resource_group_id"),
        Index("ix_inspirations_enabled", "enabled"),
        Index("ix_inspirations_deleted_at", "deleted_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36),
        default=ADMIN_USER_ID,
    )
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    source_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource_group_id: Mapped[str] = mapped_column(
        String(36),
        default=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    current_confirmed_copy_set_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )

    owner: Mapped[AuthUser] = relationship(
        primaryjoin=lambda: child_parent_join(Inspiration.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [Inspiration.owner_user_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(Inspiration.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [Inspiration.resource_group_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(Inspiration.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [Inspiration.disabled_by_user_id],
    )
    deleted_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(Inspiration.deleted_by_user_id, AuthUser.id),
        foreign_keys=lambda: [Inspiration.deleted_by_user_id],
    )
    source_assets: Mapped[list[SourceAsset]] = relationship(
        back_populates="inspiration",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(Inspiration.id, SourceAsset.inspiration_id),
        foreign_keys=lambda: [SourceAsset.inspiration_id],
    )
    creative_briefs: Mapped[list[CreativeBrief]] = relationship(
        back_populates="inspiration",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(Inspiration.id, CreativeBrief.inspiration_id),
        foreign_keys=lambda: [CreativeBrief.inspiration_id],
    )
    copy_sets: Mapped[list[CopySet]] = relationship(
        back_populates="inspiration",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(Inspiration.id, CopySet.inspiration_id),
        foreign_keys=lambda: [CopySet.inspiration_id],
    )
    confirmed_copy_set: Mapped[CopySet | None] = relationship(
        primaryjoin=lambda: child_parent_join(Inspiration.current_confirmed_copy_set_id, CopySet.id),
        foreign_keys=lambda: [Inspiration.current_confirmed_copy_set_id],
        post_update=True,
    )
    poster_variants: Mapped[list[PosterVariant]] = relationship(
        back_populates="inspiration",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(Inspiration.id, PosterVariant.inspiration_id),
        foreign_keys=lambda: [PosterVariant.inspiration_id],
    )
    image_sessions: Mapped[list[ImageSession]] = relationship(
        back_populates="inspiration",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(Inspiration.id, ImageSession.inspiration_id),
        foreign_keys=lambda: [ImageSession.inspiration_id],
    )
    workflows: Mapped[list[InspirationWorkflow]] = relationship(
        back_populates="inspiration",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(Inspiration.id, InspirationWorkflow.inspiration_id),
        foreign_keys=lambda: [InspirationWorkflow.inspiration_id],
    )


class InspirationWorkflow(Base, TimestampMixin):
    """灵感产物创意工作流：一个灵感产物可以保留多个历史 DAG，当前使用 active=True 的工作流。"""

    __tablename__ = "inspiration_workflows"
    __table_args__ = (
        Index(
            "uq_inspiration_workflows_one_active_per_inspiration",
            "inspiration_id",
            unique=True,
            postgresql_where=text("active = true"),
            sqlite_where=text("active = 1"),
        ),
        Index("ix_inspiration_workflows_initial_entry_mode", "initial_entry_mode"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    inspiration_id: Mapped[str] = mapped_column(String(36))
    title: Mapped[str] = mapped_column(String(255), default="灵感产物创意工作流")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    initial_entry_mode: Mapped[str] = mapped_column(String(20), default="image")

    inspiration: Mapped[Inspiration] = relationship(
        back_populates="workflows",
        primaryjoin=lambda: child_parent_join(InspirationWorkflow.inspiration_id, Inspiration.id),
        foreign_keys=lambda: [InspirationWorkflow.inspiration_id],
    )
    nodes: Mapped[list[WorkflowNode]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(InspirationWorkflow.id, WorkflowNode.workflow_id),
        foreign_keys=lambda: [WorkflowNode.workflow_id],
    )
    edges: Mapped[list[WorkflowEdge]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(InspirationWorkflow.id, WorkflowEdge.workflow_id),
        foreign_keys=lambda: [WorkflowEdge.workflow_id],
    )
    runs: Mapped[list[WorkflowRun]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(InspirationWorkflow.id, WorkflowRun.workflow_id),
        foreign_keys=lambda: [WorkflowRun.workflow_id],
    )


class WorkflowNode(Base, TimestampMixin):
    """工作流节点配置与最近一次输出。"""

    __tablename__ = "workflow_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(String(36))
    node_type: Mapped[WorkflowNodeType] = mapped_column(enum_value_column(WorkflowNodeType))
    title: Mapped[str] = mapped_column(String(255))
    position_x: Mapped[int] = mapped_column(default=0)
    position_y: Mapped[int] = mapped_column(default=0)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[WorkflowNodeStatus] = mapped_column(
        enum_value_column(WorkflowNodeStatus),
        default=WorkflowNodeStatus.IDLE,
    )
    output_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    workflow: Mapped[InspirationWorkflow] = relationship(
        back_populates="nodes",
        primaryjoin=lambda: child_parent_join(WorkflowNode.workflow_id, InspirationWorkflow.id),
        foreign_keys=lambda: [WorkflowNode.workflow_id],
    )
    outgoing_edges: Mapped[list[WorkflowEdge]] = relationship(
        back_populates="source_node",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(WorkflowNode.id, WorkflowEdge.source_node_id),
        foreign_keys=lambda: [WorkflowEdge.source_node_id],
    )
    incoming_edges: Mapped[list[WorkflowEdge]] = relationship(
        back_populates="target_node",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(WorkflowNode.id, WorkflowEdge.target_node_id),
        foreign_keys=lambda: [WorkflowEdge.target_node_id],
    )
    node_runs: Mapped[list[WorkflowNodeRun]] = relationship(
        back_populates="node",
        primaryjoin=lambda: parent_child_join(WorkflowNode.id, WorkflowNodeRun.node_id),
        foreign_keys=lambda: [WorkflowNodeRun.node_id],
    )


class WorkflowEdge(Base):
    """工作流有向边，表达节点间数据依赖。"""

    __tablename__ = "workflow_edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(String(36))
    source_node_id: Mapped[str] = mapped_column(String(36))
    target_node_id: Mapped[str] = mapped_column(String(36))
    source_handle: Mapped[str | None] = mapped_column(String(80), nullable=True)
    target_handle: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    workflow: Mapped[InspirationWorkflow] = relationship(
        back_populates="edges",
        primaryjoin=lambda: child_parent_join(WorkflowEdge.workflow_id, InspirationWorkflow.id),
        foreign_keys=lambda: [WorkflowEdge.workflow_id],
    )
    source_node: Mapped[WorkflowNode] = relationship(
        back_populates="outgoing_edges",
        primaryjoin=lambda: child_parent_join(WorkflowEdge.source_node_id, WorkflowNode.id),
        foreign_keys=lambda: [WorkflowEdge.source_node_id],
    )
    target_node: Mapped[WorkflowNode] = relationship(
        back_populates="incoming_edges",
        primaryjoin=lambda: child_parent_join(WorkflowEdge.target_node_id, WorkflowNode.id),
        foreign_keys=lambda: [WorkflowEdge.target_node_id],
    )


class WorkflowRun(Base):
    """一次工作流执行记录。"""

    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[WorkflowRunStatus] = mapped_column(
        enum_value_column(WorkflowRunStatus),
        default=WorkflowRunStatus.RUNNING,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_retryable: Mapped[bool] = mapped_column(Boolean, default=True)
    progress_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    workflow: Mapped[InspirationWorkflow] = relationship(
        back_populates="runs",
        primaryjoin=lambda: child_parent_join(WorkflowRun.workflow_id, InspirationWorkflow.id),
        foreign_keys=lambda: [WorkflowRun.workflow_id],
    )
    node_runs: Mapped[list[WorkflowNodeRun]] = relationship(
        back_populates="workflow_run",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(WorkflowRun.id, WorkflowNodeRun.workflow_run_id),
        foreign_keys=lambda: [WorkflowNodeRun.workflow_run_id],
    )


class WorkflowNodeRun(Base):
    """一次运行内单个节点的输出与关联产物。"""

    __tablename__ = "workflow_node_runs"

    __table_args__ = (
        Index("ix_workflow_node_runs_run_node", "workflow_run_id", "node_id"),
        Index(
            "uq_workflow_node_runs_one_active_per_node",
            "node_id",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
            sqlite_where=text("status IN ('queued', 'running')"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workflow_run_id: Mapped[str] = mapped_column(String(36))
    node_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[WorkflowNodeStatus] = mapped_column(enum_value_column(WorkflowNodeStatus))
    output_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    copy_set_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    poster_variant_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    image_session_asset_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    resource_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    workflow_run: Mapped[WorkflowRun] = relationship(
        back_populates="node_runs",
        primaryjoin=lambda: child_parent_join(WorkflowNodeRun.workflow_run_id, WorkflowRun.id),
        foreign_keys=lambda: [WorkflowNodeRun.workflow_run_id],
    )
    node: Mapped[WorkflowNode] = relationship(
        back_populates="node_runs",
        primaryjoin=lambda: child_parent_join(WorkflowNodeRun.node_id, WorkflowNode.id),
        foreign_keys=lambda: [WorkflowNodeRun.node_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(WorkflowNodeRun.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [WorkflowNodeRun.resource_group_id],
    )


class SourceAsset(Base):
    """灵感产物源素材（原始图/参考图），一个灵感产物最多一张原始图。"""

    __tablename__ = "source_assets"
    __table_args__ = (
        Index(
            "uq_source_assets_one_original_per_inspiration",
            "inspiration_id",
            unique=True,
            postgresql_where=text("kind = 'original_image'"),
            sqlite_where=text("kind = 'original_image'"),
        ),
        Index("ix_source_assets_enabled", "enabled"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    inspiration_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[SourceAssetKind] = mapped_column(enum_value_column(SourceAssetKind))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(500))
    storage_backend: Mapped[str | None] = mapped_column(String(50), nullable=True)
    storage_bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_poster_variant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    inspiration: Mapped[Inspiration] = relationship(
        back_populates="source_assets",
        primaryjoin=lambda: child_parent_join(SourceAsset.inspiration_id, Inspiration.id),
        foreign_keys=lambda: [SourceAsset.inspiration_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(SourceAsset.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [SourceAsset.disabled_by_user_id],
    )


class CreativeBrief(Base):
    """AI 对灵感产物的理解结果：定位/受众/卖点/禁忌词。"""

    __tablename__ = "creative_briefs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    inspiration_id: Mapped[str] = mapped_column(String(36))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    provider_name: Mapped[str] = mapped_column(String(50))
    model_name: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(32))
    resource_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    inspiration: Mapped[Inspiration] = relationship(
        back_populates="creative_briefs",
        primaryjoin=lambda: child_parent_join(CreativeBrief.inspiration_id, Inspiration.id),
        foreign_keys=lambda: [CreativeBrief.inspiration_id],
    )
    copy_sets: Mapped[list[CopySet]] = relationship(
        back_populates="creative_brief",
        primaryjoin=lambda: parent_child_join(CreativeBrief.id, CopySet.creative_brief_id),
        foreign_keys=lambda: [CopySet.creative_brief_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(CreativeBrief.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [CreativeBrief.resource_group_id],
    )


class CopySet(Base, TimestampMixin):
    """文案版本，记录 AI 原始输出与人工编辑历史。"""

    __tablename__ = "copy_sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    inspiration_id: Mapped[str] = mapped_column(String(36))
    creative_brief_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    status: Mapped[CopyStatus] = mapped_column(enum_value_column(CopyStatus), default=CopyStatus.DRAFT)

    structured_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_structured_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    provider_name: Mapped[str] = mapped_column(String(50))
    model_name: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(32))
    resource_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    inspiration: Mapped[Inspiration] = relationship(
        back_populates="copy_sets",
        primaryjoin=lambda: child_parent_join(CopySet.inspiration_id, Inspiration.id),
        foreign_keys=lambda: [CopySet.inspiration_id],
    )
    creative_brief: Mapped[CreativeBrief | None] = relationship(
        back_populates="copy_sets",
        primaryjoin=lambda: child_parent_join(CopySet.creative_brief_id, CreativeBrief.id),
        foreign_keys=lambda: [CopySet.creative_brief_id],
    )
    poster_variants: Mapped[list[PosterVariant]] = relationship(
        back_populates="copy_set",
        primaryjoin=lambda: parent_child_join(CopySet.id, PosterVariant.copy_set_id),
        foreign_keys=lambda: [PosterVariant.copy_set_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(CopySet.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [CopySet.resource_group_id],
    )


class PosterVariant(Base):
    """已生成的海报变体，关联文案和存储路径。"""

    __tablename__ = "poster_variants"
    __table_args__ = (Index("ix_poster_variants_enabled", "enabled"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    inspiration_id: Mapped[str] = mapped_column(String(36))
    copy_set_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[PosterKind] = mapped_column(enum_value_column(PosterKind))
    template_name: Mapped[str] = mapped_column(String(100))
    mime_type: Mapped[str] = mapped_column(String(50), default="image/png")
    storage_path: Mapped[str] = mapped_column(String(500))
    storage_backend: Mapped[str | None] = mapped_column(String(50), nullable=True)
    storage_bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    resource_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    width: Mapped[int] = mapped_column()
    height: Mapped[int] = mapped_column()
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    inspiration: Mapped[Inspiration] = relationship(
        back_populates="poster_variants",
        primaryjoin=lambda: child_parent_join(PosterVariant.inspiration_id, Inspiration.id),
        foreign_keys=lambda: [PosterVariant.inspiration_id],
    )
    copy_set: Mapped[CopySet] = relationship(
        back_populates="poster_variants",
        primaryjoin=lambda: child_parent_join(PosterVariant.copy_set_id, CopySet.id),
        foreign_keys=lambda: [PosterVariant.copy_set_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(PosterVariant.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [PosterVariant.disabled_by_user_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(PosterVariant.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [PosterVariant.resource_group_id],
    )


class ImageSession(Base, TimestampMixin):
    """连续生图会话，含多轮对话历史与生成结果。"""

    __tablename__ = "image_sessions"
    __table_args__ = (
        Index("ix_image_sessions_owner_user_id", "owner_user_id"),
        Index("ix_image_sessions_resource_group_id", "resource_group_id"),
        Index("ix_image_sessions_enabled", "enabled"),
        Index("ix_image_sessions_deleted_at", "deleted_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36),
        default=ADMIN_USER_ID,
    )
    inspiration_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    resource_group_id: Mapped[str] = mapped_column(
        String(36),
        default=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    title: Mapped[str] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )

    owner: Mapped[AuthUser] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSession.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [ImageSession.owner_user_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSession.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [ImageSession.disabled_by_user_id],
    )
    deleted_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSession.deleted_by_user_id, AuthUser.id),
        foreign_keys=lambda: [ImageSession.deleted_by_user_id],
    )
    inspiration: Mapped[Inspiration | None] = relationship(
        back_populates="image_sessions",
        primaryjoin=lambda: child_parent_join(ImageSession.inspiration_id, Inspiration.id),
        foreign_keys=lambda: [ImageSession.inspiration_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSession.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [ImageSession.resource_group_id],
    )
    assets: Mapped[list[ImageSessionAsset]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        primaryjoin=lambda: parent_child_join(ImageSession.id, ImageSessionAsset.session_id),
        foreign_keys=lambda: [ImageSessionAsset.session_id],
    )
    rounds: Mapped[list[ImageSessionRound]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ImageSessionRound.created_at",
        primaryjoin=lambda: parent_child_join(ImageSession.id, ImageSessionRound.session_id),
        foreign_keys=lambda: [ImageSessionRound.session_id],
    )
    generation_tasks: Mapped[list[ImageSessionGenerationTask]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ImageSessionGenerationTask.created_at",
        primaryjoin=lambda: parent_child_join(ImageSession.id, ImageSessionGenerationTask.session_id),
        foreign_keys=lambda: [ImageSessionGenerationTask.session_id],
    )


class ImageSessionAsset(Base):
    __tablename__ = "image_session_assets"
    __table_args__ = (
        Index("ix_image_session_assets_owner_user_id", "owner_user_id"),
        Index("ix_image_session_assets_enabled", "enabled"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36),
        default=ADMIN_USER_ID,
    )
    session_id: Mapped[str] = mapped_column(String(36))
    kind: Mapped[ImageSessionAssetKind] = mapped_column(enum_value_column(ImageSessionAssetKind))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(500))
    storage_backend: Mapped[str | None] = mapped_column(String(50), nullable=True)
    storage_bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    storage_object_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped[AuthUser] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSessionAsset.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [ImageSessionAsset.owner_user_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSessionAsset.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [ImageSessionAsset.disabled_by_user_id],
    )
    session: Mapped[ImageSession] = relationship(
        back_populates="assets",
        primaryjoin=lambda: child_parent_join(ImageSessionAsset.session_id, ImageSession.id),
        foreign_keys=lambda: [ImageSessionAsset.session_id],
    )
    generated_in_round: Mapped[ImageSessionRound | None] = relationship(
        back_populates="generated_asset",
        primaryjoin=lambda: parent_child_join(ImageSessionAsset.id, ImageSessionRound.generated_asset_id),
        foreign_keys=lambda: [ImageSessionRound.generated_asset_id],
    )
    gallery_entry: Mapped[ImageGalleryEntry | None] = relationship(
        back_populates="asset",
        primaryjoin=lambda: parent_child_join(ImageSessionAsset.id, ImageGalleryEntry.image_session_asset_id),
        foreign_keys=lambda: [ImageGalleryEntry.image_session_asset_id],
        uselist=False,
    )


class ImageSessionRound(Base):
    __tablename__ = "image_session_rounds"
    __table_args__ = (
        Index("uq_image_session_rounds_generated_asset_id", "generated_asset_id", unique=True),
        Index("ix_image_session_rounds_generation_group_id", "generation_group_id"),
        Index("ix_image_session_rounds_base_asset_id", "base_asset_id"),
        Index("ix_image_session_rounds_session_resource_group", "session_id", "resource_group_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(String(36))
    prompt: Mapped[str] = mapped_column(Text)
    assistant_message: Mapped[str] = mapped_column(Text)
    size: Mapped[str] = mapped_column(String(32))
    model_name: Mapped[str] = mapped_column(String(100))
    provider_name: Mapped[str] = mapped_column(String(50))
    prompt_version: Mapped[str] = mapped_column(String(32))
    provider_response_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    previous_response_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    image_generation_call_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    provider_request_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    provider_output_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    generation_config_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    generation_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resource_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    candidate_index: Mapped[int] = mapped_column(Integer, default=1)
    candidate_count: Mapped[int] = mapped_column(Integer, default=1)
    base_asset_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    base_asset_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    selected_reference_asset_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    generated_asset_id: Mapped[str] = mapped_column(
        String(36),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[ImageSession] = relationship(
        back_populates="rounds",
        primaryjoin=lambda: child_parent_join(ImageSessionRound.session_id, ImageSession.id),
        foreign_keys=lambda: [ImageSessionRound.session_id],
    )
    generated_asset: Mapped[ImageSessionAsset] = relationship(
        back_populates="generated_in_round",
        primaryjoin=lambda: child_parent_join(ImageSessionRound.generated_asset_id, ImageSessionAsset.id),
        foreign_keys=lambda: [ImageSessionRound.generated_asset_id],
    )
    base_asset: Mapped[ImageSessionAsset | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSessionRound.base_asset_id, ImageSessionAsset.id),
        foreign_keys=lambda: [ImageSessionRound.base_asset_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSessionRound.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [ImageSessionRound.resource_group_id],
    )


class ImageSessionGenerationTask(Base):
    """连续生图 durable 后台任务记录，数据库是 authoritative state。"""

    __tablename__ = "image_session_generation_tasks"
    __table_args__ = (
        Index("ix_image_session_generation_tasks_session_id", "session_id"),
        Index("ix_image_session_generation_tasks_status", "status"),
        Index("ix_image_session_generation_tasks_session_resource_group", "session_id", "resource_group_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[JobStatus] = mapped_column(enum_value_column(JobStatus), default=JobStatus.QUEUED)
    prompt: Mapped[str] = mapped_column(Text)
    size: Mapped[str] = mapped_column(String(32))
    base_asset_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    base_asset_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    selected_reference_asset_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    tool_options: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    generation_config_mode: Mapped[str] = mapped_column(String(20), default="auto")
    requested_generation_config_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    used_generation_config_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    generation_count: Mapped[int] = mapped_column(Integer, default=1)
    completed_candidates: Mapped[int] = mapped_column(Integer, default=0)
    active_candidate_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    progress_phase: Mapped[str | None] = mapped_column(String(64), nullable=True)
    progress_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    provider_response_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_response_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    progress_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_generation_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resource_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    is_retryable: Mapped[bool] = mapped_column(Boolean, default=True)

    session: Mapped[ImageSession] = relationship(
        back_populates="generation_tasks",
        primaryjoin=lambda: child_parent_join(ImageSessionGenerationTask.session_id, ImageSession.id),
        foreign_keys=lambda: [ImageSessionGenerationTask.session_id],
    )
    base_asset: Mapped[ImageSessionAsset | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSessionGenerationTask.base_asset_id, ImageSessionAsset.id),
        foreign_keys=lambda: [ImageSessionGenerationTask.base_asset_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageSessionGenerationTask.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [ImageSessionGenerationTask.resource_group_id],
    )


class ImageGalleryEntry(Base):
    """全局精选画廊条目，引用连续生图生成资产，不复制图片文件。"""

    __tablename__ = "image_gallery_entries"
    __table_args__ = (
        Index("uq_image_gallery_entries_asset_id", "image_session_asset_id", unique=True),
        Index("ix_image_gallery_entries_round_id", "image_session_round_id"),
        Index("ix_image_gallery_entries_created_at", "created_at"),
        Index("ix_image_gallery_entries_enabled", "enabled"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36),
        default=ADMIN_USER_ID,
    )
    image_session_asset_id: Mapped[str] = mapped_column(
        String(36),
    )
    image_session_round_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    resource_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped[AuthUser] = relationship(
        primaryjoin=lambda: child_parent_join(ImageGalleryEntry.owner_user_id, AuthUser.id),
        foreign_keys=lambda: [ImageGalleryEntry.owner_user_id],
    )
    disabled_by: Mapped[AuthUser | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageGalleryEntry.disabled_by_user_id, AuthUser.id),
        foreign_keys=lambda: [ImageGalleryEntry.disabled_by_user_id],
    )
    asset: Mapped[ImageSessionAsset] = relationship(
        back_populates="gallery_entry",
        primaryjoin=lambda: child_parent_join(ImageGalleryEntry.image_session_asset_id, ImageSessionAsset.id),
        foreign_keys=lambda: [ImageGalleryEntry.image_session_asset_id],
    )
    round: Mapped[ImageSessionRound | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageGalleryEntry.image_session_round_id, ImageSessionRound.id),
        foreign_keys=lambda: [ImageGalleryEntry.image_session_round_id],
    )
    resource_group: Mapped[GenerationResourceGroup | None] = relationship(
        primaryjoin=lambda: child_parent_join(ImageGalleryEntry.resource_group_id, GenerationResourceGroup.id),
        foreign_keys=lambda: [ImageGalleryEntry.resource_group_id],
    )
