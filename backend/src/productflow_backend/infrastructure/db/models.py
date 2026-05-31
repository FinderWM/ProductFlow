from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from productflow_backend.domain.enums import (
    CopyStatus,
    ImageSessionAssetKind,
    JobStatus,
    PosterKind,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
    WorkflowRunStatus,
)
from productflow_backend.domain.rbac import ADMIN_USER_ID


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
    )


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

    users: Mapped[list[AuthUser]] = relationship(back_populates="role")


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
    role_id: Mapped[str] = mapped_column(String(36), ForeignKey("auth_roles.id", ondelete="RESTRICT"))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    password_hash: Mapped[str | None] = mapped_column(String(32), nullable=True)
    password_salt: Mapped[str | None] = mapped_column(String(32), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    role: Mapped[AuthRole] = relationship(back_populates="users")


class RbacMenu(Base):
    """前端一级入口权限。"""

    __tablename__ = "rbac_menus"

    code: Mapped[str] = mapped_column(String(80), primary_key=True)
    title: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    api_permissions: Mapped[list[RbacApiPermission]] = relationship(back_populates="menu")


class RbacApiPermission(Base):
    """接口权限；挂在菜单下展示，后端独立校验 code。"""

    __tablename__ = "rbac_api_permissions"
    __table_args__ = (
        Index("ix_rbac_api_permissions_menu_code", "menu_code"),
        Index("ix_rbac_api_permissions_enabled", "enabled"),
    )

    code: Mapped[str] = mapped_column(String(120), primary_key=True)
    menu_code: Mapped[str] = mapped_column(String(80), ForeignKey("rbac_menus.code", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    menu: Mapped[RbacMenu] = relationship(back_populates="api_permissions")


class RoleMenuPermission(Base):
    __tablename__ = "role_menu_permissions"

    role_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("auth_roles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    menu_code: Mapped[str] = mapped_column(
        String(80),
        ForeignKey("rbac_menus.code", ondelete="CASCADE"),
        primary_key=True,
    )


class RoleApiPermission(Base):
    __tablename__ = "role_api_permissions"

    role_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("auth_roles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_code: Mapped[str] = mapped_column(
        String(120),
        ForeignKey("rbac_api_permissions.code", ondelete="CASCADE"),
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
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("auth_users.id", ondelete="RESTRICT"))
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

    user: Mapped[AuthUser] = relationship()


class CanvasTemplateCategory(Base, TimestampMixin):
    """数据库化画布模板分类，支持全局和用户个人范围。"""

    __tablename__ = "canvas_template_categories"
    __table_args__ = (
        CheckConstraint("scope IN ('global', 'user')", name="ck_canvas_template_categories_scope"),
        CheckConstraint(
            "(scope = 'global' AND owner_user_id IS NULL) OR (scope = 'user' AND owner_user_id IS NOT NULL)",
            name="ck_canvas_template_categories_owner_scope",
        ),
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
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner: Mapped[AuthUser | None] = relationship(foreign_keys=[owner_user_id])
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])


class CanvasTemplate(Base, TimestampMixin):
    """数据库化画布模板，支持全局模板和用户个人模板。"""

    __tablename__ = "canvas_templates"
    __table_args__ = (
        CheckConstraint("scope IN ('global', 'user')", name="ck_canvas_templates_scope"),
        CheckConstraint("entry_mode IN ('image', 'copy', 'tail')", name="ck_canvas_templates_entry_mode"),
        CheckConstraint(
            "(scope = 'global' AND owner_user_id IS NULL) OR (scope = 'user' AND owner_user_id IS NOT NULL)",
            name="ck_canvas_templates_owner_scope",
        ),
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
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        nullable=True,
    )
    category_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("canvas_template_categories.id", ondelete="SET NULL"),
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
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[str] = mapped_column(String(20), default="none")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )

    owner: Mapped[AuthUser | None] = relationship(foreign_keys=[owner_user_id])
    category: Mapped[CanvasTemplateCategory | None] = relationship(foreign_keys=[category_id])
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])
    reviewed_by: Mapped[AuthUser | None] = relationship(foreign_keys=[reviewed_by_user_id])


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
    generation_configs: Mapped[list[GenerationConfig]] = relationship(back_populates="provider_profile")


class GenerationConfig(Base, TimestampMixin):
    """可调度的文案/图片生成配置，运行时生成 provider 的唯一配置来源。"""

    __tablename__ = "generation_configs"
    __table_args__ = (
        Index("ix_generation_configs_purpose", "purpose"),
        Index("ix_generation_configs_enabled", "enabled"),
        Index("ix_generation_configs_archived_at", "archived_at"),
        Index("ix_generation_configs_sort", "purpose", "priority", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    provider_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_profile_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("provider_profiles.id", ondelete="SET NULL"),
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

    provider_profile: Mapped[ProviderProfile | None] = relationship(back_populates="generation_configs")
    state: Mapped[GenerationConfigState | None] = relationship(
        back_populates="generation_config",
        cascade="all, delete-orphan",
        uselist=False,
    )
    daily_stats: Mapped[list[GenerationConfigDailyStat]] = relationship(
        back_populates="generation_config",
        cascade="all, delete-orphan",
    )


class GenerationConfigState(Base, TimestampMixin):
    """生成配置运行态：当前并发、失败窗口和冻结信息。"""

    __tablename__ = "generation_config_states"

    generation_config_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("generation_configs.id", ondelete="CASCADE"),
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

    generation_config: Mapped[GenerationConfig] = relationship(back_populates="state")


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
        ForeignKey("generation_configs.id", ondelete="CASCADE"),
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

    generation_config: Mapped[GenerationConfig] = relationship(back_populates="daily_stats")


class ProviderBinding(Base, TimestampMixin):
    """用途绑定，表达文案/图片当前使用哪个供应商和接口。"""

    __tablename__ = "provider_bindings"
    __table_args__ = (Index("uq_provider_bindings_purpose", "purpose", unique=True),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_kind: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_profile_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("provider_profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    model_settings_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    provider_profile: Mapped[ProviderProfile | None] = relationship()


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


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    __table_args__ = (
        Index("ix_products_owner_user_id", "owner_user_id"),
        Index("ix_products_enabled", "enabled"),
        Index("ix_products_deleted_at", "deleted_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        default=ADMIN_USER_ID,
    )
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    source_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    current_confirmed_copy_set_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "copy_sets.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_products_current_confirmed_copy_set_id",
        ),
        nullable=True,
    )

    owner: Mapped[AuthUser] = relationship(foreign_keys=[owner_user_id])
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])
    deleted_by: Mapped[AuthUser | None] = relationship(foreign_keys=[deleted_by_user_id])
    source_assets: Mapped[list[SourceAsset]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        foreign_keys="SourceAsset.product_id",
    )
    creative_briefs: Mapped[list[CreativeBrief]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )
    copy_sets: Mapped[list[CopySet]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
        foreign_keys="CopySet.product_id",
    )
    confirmed_copy_set: Mapped[CopySet | None] = relationship(
        foreign_keys=[current_confirmed_copy_set_id],
        post_update=True,
    )
    poster_variants: Mapped[list[PosterVariant]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )
    image_sessions: Mapped[list[ImageSession]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )
    workflows: Mapped[list[ProductWorkflow]] = relationship(
        back_populates="product",
        cascade="all, delete-orphan",
    )


class ProductWorkflow(Base, TimestampMixin):
    """商品创意工作流：一个商品可以保留多个历史 DAG，当前使用 active=True 的工作流。"""

    __tablename__ = "product_workflows"
    __table_args__ = (
        CheckConstraint(
            "initial_entry_mode IN ('image', 'copy', 'tail', 'blank')",
            name="ck_product_workflows_initial_entry_mode",
        ),
        Index(
            "uq_product_workflows_one_active_per_product",
            "product_id",
            unique=True,
            postgresql_where=text("active = true"),
            sqlite_where=text("active = 1"),
        ),
        Index("ix_product_workflows_initial_entry_mode", "initial_entry_mode"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(255), default="商品创意工作流")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    initial_entry_mode: Mapped[str] = mapped_column(String(20), default="image")

    product: Mapped[Product] = relationship(back_populates="workflows")
    nodes: Mapped[list[WorkflowNode]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
    )
    edges: Mapped[list[WorkflowEdge]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowEdge.workflow_id",
    )
    runs: Mapped[list[WorkflowRun]] = relationship(
        back_populates="workflow",
        cascade="all, delete-orphan",
    )


class WorkflowNode(Base, TimestampMixin):
    """工作流节点配置与最近一次输出。"""

    __tablename__ = "workflow_nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("product_workflows.id", ondelete="CASCADE"))
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

    workflow: Mapped[ProductWorkflow] = relationship(back_populates="nodes")
    outgoing_edges: Mapped[list[WorkflowEdge]] = relationship(
        back_populates="source_node",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowEdge.source_node_id",
    )
    incoming_edges: Mapped[list[WorkflowEdge]] = relationship(
        back_populates="target_node",
        cascade="all, delete-orphan",
        foreign_keys="WorkflowEdge.target_node_id",
    )
    node_runs: Mapped[list[WorkflowNodeRun]] = relationship(back_populates="node")


class WorkflowEdge(Base):
    """工作流有向边，表达节点间数据依赖。"""

    __tablename__ = "workflow_edges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("product_workflows.id", ondelete="CASCADE"))
    source_node_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_nodes.id", ondelete="CASCADE"))
    target_node_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_nodes.id", ondelete="CASCADE"))
    source_handle: Mapped[str | None] = mapped_column(String(80), nullable=True)
    target_handle: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    workflow: Mapped[ProductWorkflow] = relationship(back_populates="edges", foreign_keys=[workflow_id])
    source_node: Mapped[WorkflowNode] = relationship(back_populates="outgoing_edges", foreign_keys=[source_node_id])
    target_node: Mapped[WorkflowNode] = relationship(back_populates="incoming_edges", foreign_keys=[target_node_id])


class WorkflowRun(Base):
    """一次工作流执行记录。"""

    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workflow_id: Mapped[str] = mapped_column(String(36), ForeignKey("product_workflows.id", ondelete="CASCADE"))
    status: Mapped[WorkflowRunStatus] = mapped_column(
        enum_value_column(WorkflowRunStatus),
        default=WorkflowRunStatus.RUNNING,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_retryable: Mapped[bool] = mapped_column(Boolean, default=True)
    progress_metadata: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)

    workflow: Mapped[ProductWorkflow] = relationship(back_populates="runs")
    node_runs: Mapped[list[WorkflowNodeRun]] = relationship(
        back_populates="workflow_run",
        cascade="all, delete-orphan",
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
    workflow_run_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_runs.id", ondelete="CASCADE"))
    node_id: Mapped[str] = mapped_column(String(36), ForeignKey("workflow_nodes.id", ondelete="CASCADE"))
    status: Mapped[WorkflowNodeStatus] = mapped_column(enum_value_column(WorkflowNodeStatus))
    output_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    copy_set_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("copy_sets.id", ondelete="SET NULL"),
        nullable=True,
    )
    poster_variant_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("poster_variants.id", ondelete="SET NULL"),
        nullable=True,
    )
    image_session_asset_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("image_session_assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    workflow_run: Mapped[WorkflowRun] = relationship(back_populates="node_runs")
    node: Mapped[WorkflowNode] = relationship(back_populates="node_runs")


class SourceAsset(Base):
    """商品源素材（原始图/参考图），一个商品最多一张原始图。"""

    __tablename__ = "source_assets"
    __table_args__ = (
        Index(
            "uq_source_assets_one_original_per_product",
            "product_id",
            unique=True,
            postgresql_where=text("kind = 'original_image'"),
            sqlite_where=text("kind = 'original_image'"),
        ),
        Index("ix_source_assets_enabled", "enabled"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"))
    kind: Mapped[SourceAssetKind] = mapped_column(enum_value_column(SourceAssetKind))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(500))
    source_poster_variant_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship(back_populates="source_assets", foreign_keys=[product_id])
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])


class CreativeBrief(Base):
    """AI 对商品的理解结果：定位/受众/卖点/禁忌词。"""

    __tablename__ = "creative_briefs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    provider_name: Mapped[str] = mapped_column(String(50))
    model_name: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship(back_populates="creative_briefs")
    copy_sets: Mapped[list[CopySet]] = relationship(back_populates="creative_brief")


class CopySet(Base, TimestampMixin):
    """文案版本，记录 AI 原始输出与人工编辑历史。"""

    __tablename__ = "copy_sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"))
    creative_brief_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("creative_briefs.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[CopyStatus] = mapped_column(enum_value_column(CopyStatus), default=CopyStatus.DRAFT)

    structured_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_structured_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    provider_name: Mapped[str] = mapped_column(String(50))
    model_name: Mapped[str] = mapped_column(String(100))
    prompt_version: Mapped[str] = mapped_column(String(32))
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    product: Mapped[Product] = relationship(
        back_populates="copy_sets",
        foreign_keys=[product_id],
    )
    creative_brief: Mapped[CreativeBrief | None] = relationship(back_populates="copy_sets")
    poster_variants: Mapped[list[PosterVariant]] = relationship(back_populates="copy_set")


class PosterVariant(Base):
    """已生成的海报变体，关联文案和存储路径。"""

    __tablename__ = "poster_variants"
    __table_args__ = (Index("ix_poster_variants_enabled", "enabled"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    product_id: Mapped[str] = mapped_column(String(36), ForeignKey("products.id", ondelete="CASCADE"))
    copy_set_id: Mapped[str] = mapped_column(String(36), ForeignKey("copy_sets.id", ondelete="CASCADE"))
    kind: Mapped[PosterKind] = mapped_column(enum_value_column(PosterKind))
    template_name: Mapped[str] = mapped_column(String(100))
    mime_type: Mapped[str] = mapped_column(String(50), default="image/png")
    storage_path: Mapped[str] = mapped_column(String(500))
    width: Mapped[int] = mapped_column()
    height: Mapped[int] = mapped_column()
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship(back_populates="poster_variants")
    copy_set: Mapped[CopySet] = relationship(back_populates="poster_variants")
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])


class ImageSession(Base, TimestampMixin):
    """连续生图会话，含多轮对话历史与生成结果。"""

    __tablename__ = "image_sessions"
    __table_args__ = (
        Index("ix_image_sessions_owner_user_id", "owner_user_id"),
        Index("ix_image_sessions_enabled", "enabled"),
        Index("ix_image_sessions_deleted_at", "deleted_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        default=ADMIN_USER_ID,
    )
    product_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(255))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )

    owner: Mapped[AuthUser] = relationship(foreign_keys=[owner_user_id])
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])
    deleted_by: Mapped[AuthUser | None] = relationship(foreign_keys=[deleted_by_user_id])
    product: Mapped[Product | None] = relationship(back_populates="image_sessions")
    assets: Mapped[list[ImageSessionAsset]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
    )
    rounds: Mapped[list[ImageSessionRound]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ImageSessionRound.created_at",
    )
    generation_tasks: Mapped[list[ImageSessionGenerationTask]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ImageSessionGenerationTask.created_at",
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
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        default=ADMIN_USER_ID,
    )
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("image_sessions.id", ondelete="CASCADE"))
    kind: Mapped[ImageSessionAssetKind] = mapped_column(enum_value_column(ImageSessionAssetKind))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(500))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped[AuthUser] = relationship(foreign_keys=[owner_user_id])
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])
    session: Mapped[ImageSession] = relationship(back_populates="assets")
    generated_in_round: Mapped[ImageSessionRound | None] = relationship(
        back_populates="generated_asset",
        foreign_keys="ImageSessionRound.generated_asset_id",
    )


class ImageSessionRound(Base):
    __tablename__ = "image_session_rounds"
    __table_args__ = (
        Index("uq_image_session_rounds_generated_asset_id", "generated_asset_id", unique=True),
        Index("ix_image_session_rounds_generation_group_id", "generation_group_id"),
        Index("ix_image_session_rounds_base_asset_id", "base_asset_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("image_sessions.id", ondelete="CASCADE"))
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
        ForeignKey("generation_configs.id", ondelete="SET NULL"),
        nullable=True,
    )
    generation_group_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    candidate_index: Mapped[int] = mapped_column(Integer, default=1)
    candidate_count: Mapped[int] = mapped_column(Integer, default=1)
    base_asset_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("image_session_assets.id", ondelete="SET NULL", name="fk_image_session_rounds_base_asset_id"),
        nullable=True,
    )
    selected_reference_asset_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    generated_asset_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("image_session_assets.id", ondelete="CASCADE"),
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[ImageSession] = relationship(back_populates="rounds")
    generated_asset: Mapped[ImageSessionAsset] = relationship(
        back_populates="generated_in_round",
        foreign_keys=[generated_asset_id],
    )
    base_asset: Mapped[ImageSessionAsset | None] = relationship(foreign_keys=[base_asset_id])


class ImageSessionGenerationTask(Base):
    """连续生图 durable 后台任务记录，数据库是 authoritative state。"""

    __tablename__ = "image_session_generation_tasks"
    __table_args__ = (
        Index("ix_image_session_generation_tasks_session_id", "session_id"),
        Index("ix_image_session_generation_tasks_status", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("image_sessions.id", ondelete="CASCADE"))
    status: Mapped[JobStatus] = mapped_column(enum_value_column(JobStatus), default=JobStatus.QUEUED)
    prompt: Mapped[str] = mapped_column(Text)
    size: Mapped[str] = mapped_column(String(32))
    base_asset_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "image_session_assets.id",
            ondelete="SET NULL",
            name="fk_image_session_generation_tasks_base_asset_id",
        ),
        nullable=True,
    )
    selected_reference_asset_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    tool_options: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    generation_config_mode: Mapped[str] = mapped_column(String(20), default="auto")
    requested_generation_config_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("generation_configs.id", ondelete="SET NULL", name="fk_img_task_requested_gen_config"),
        nullable=True,
    )
    used_generation_config_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("generation_configs.id", ondelete="SET NULL", name="fk_img_task_used_gen_config"),
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    is_retryable: Mapped[bool] = mapped_column(Boolean, default=True)

    session: Mapped[ImageSession] = relationship(back_populates="generation_tasks")
    base_asset: Mapped[ImageSessionAsset | None] = relationship(foreign_keys=[base_asset_id])


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
        ForeignKey("auth_users.id", ondelete="RESTRICT"),
        default=ADMIN_USER_ID,
    )
    image_session_asset_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "image_session_assets.id",
            ondelete="CASCADE",
            name="fk_image_gallery_entries_image_session_asset_id",
        ),
    )
    image_session_round_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "image_session_rounds.id",
            ondelete="SET NULL",
            name="fk_image_gallery_entries_image_session_round_id",
        ),
        nullable=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_by_user_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("auth_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    disabled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped[AuthUser] = relationship(foreign_keys=[owner_user_id])
    disabled_by: Mapped[AuthUser | None] = relationship(foreign_keys=[disabled_by_user_id])
    asset: Mapped[ImageSessionAsset] = relationship(foreign_keys=[image_session_asset_id])
    round: Mapped[ImageSessionRound | None] = relationship(foreign_keys=[image_session_round_id])
