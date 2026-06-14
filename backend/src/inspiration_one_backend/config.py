from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, ValidationError, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from inspiration_one_backend.domain.ui_layout import (
    DEFAULT_UI_LAYOUT_SCHEME,
    SUPPORTED_UI_LAYOUT_SCHEMES,
    is_supported_ui_layout_scheme,
)

ConfigInputType = Literal["text", "password", "number", "boolean", "select", "multi_select", "textarea"]
IMAGE_SIZE_PATTERN = re.compile(r"^\d+x\d+$")
DEFAULT_LOGIN_PAGE_TEMPLATE_ID = "command-orbit"
LOGIN_PAGE_TEMPLATE_IDS: tuple[str, ...] = ("command-orbit", "fluid-mist", "image-lab")
LOGIN_PAGE_TEMPLATE_NAMES: dict[str, str] = {
    "command-orbit": "Command Orbit",
    "fluid-mist": "Fluid Mist",
    "image-lab": "Image Lab",
}
LOGIN_PAGE_MODE_VALUES: tuple[str, ...] = ("random", *LOGIN_PAGE_TEMPLATE_IDS)
DEFAULT_LOGIN_PAGE_MODE = "random"
DEFAULT_LOGIN_PAGE_ENABLED_TEMPLATE_IDS_TEXT = ",".join(LOGIN_PAGE_TEMPLATE_IDS)
LOGIN_PAGE_CATEGORY = "登录页"
DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_BRAND_SUBTITLE = "Orbital access concept"
DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_HERO_TITLE = "进入你的创意工作台"
DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_HERO_DESCRIPTION = (
    "从灵感编排、图像会话到素材沉淀，Inspiration One 将创作链路收束成一座私有控制台。"
)
DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_TITLE = "欢迎回来，继续创作"
DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_DESCRIPTION = "登录你的工作台，开启灵感之旅"
DEFAULT_LOGIN_PAGE_IMAGE_LAB_HERO_DESCRIPTION = "登录页像一张摄影棚邀请函，先给情绪和记忆点，再承载最短的进入路径。"
LOGIN_PAGE_TEMPLATE_CONFIG_KEYS: dict[str, str] = {
    "command-orbit": "login_page_command_orbit_config",
    "fluid-mist": "login_page_fluid_mist_config",
    "image-lab": "login_page_image_lab_config",
}
LOGIN_PAGE_TEMPLATE_ID_BY_CONFIG_KEY: dict[str, str] = {
    config_key: template_id for template_id, config_key in LOGIN_PAGE_TEMPLATE_CONFIG_KEYS.items()
}
LOGIN_PAGE_TEMPLATE_CONFIG_DEFAULTS: dict[str, dict[str, str]] = {
    "command-orbit": {
        "brand_subtitle": DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_BRAND_SUBTITLE,
        "hero_title": DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_HERO_TITLE,
        "hero_description": DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_HERO_DESCRIPTION,
    },
    "fluid-mist": {
        "greeting_title": DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_TITLE,
        "greeting_description": DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_DESCRIPTION,
    },
    "image-lab": {
        "hero_description": DEFAULT_LOGIN_PAGE_IMAGE_LAB_HERO_DESCRIPTION,
        "hero_image_asset_id": "",
    },
}
LOGIN_PAGE_TEMPLATE_CONFIG_LIMITS: dict[str, dict[str, int]] = {
    "command-orbit": {
        "brand_subtitle": 48,
        "hero_title": 48,
        "hero_description": 180,
    },
    "fluid-mist": {
        "greeting_title": 48,
        "greeting_description": 120,
    },
    "image-lab": {
        "hero_description": 180,
        "hero_image_asset_id": 64,
    },
}
LOGIN_PAGE_LEGACY_CONFIG_KEYS: dict[str, dict[str, str]] = {
    "command-orbit": {
        "login_page_command_orbit_brand_subtitle": "brand_subtitle",
        "login_page_command_orbit_hero_title": "hero_title",
        "login_page_command_orbit_hero_description": "hero_description",
    },
    "fluid-mist": {
        "login_page_fluid_mist_greeting_title": "greeting_title",
        "login_page_fluid_mist_greeting_description": "greeting_description",
    },
    "image-lab": {
        "login_page_image_lab_hero_description": "hero_description",
        "login_page_image_lab_hero_image_asset_id": "hero_image_asset_id",
    },
}
LOGIN_PAGE_LEGACY_RUNTIME_CONFIG_KEYS: set[str] = {
    "login_page_selected_template_id",
    "login_page_enabled_template_ids",
    *{
        legacy_key
        for legacy_keys in LOGIN_PAGE_LEGACY_CONFIG_KEYS.values()
        for legacy_key in legacy_keys
    },
}
DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_CONFIG = json.dumps(
    LOGIN_PAGE_TEMPLATE_CONFIG_DEFAULTS["command-orbit"],
    ensure_ascii=False,
    separators=(",", ":"),
)
DEFAULT_LOGIN_PAGE_FLUID_MIST_CONFIG = json.dumps(
    LOGIN_PAGE_TEMPLATE_CONFIG_DEFAULTS["fluid-mist"],
    ensure_ascii=False,
    separators=(",", ":"),
)
DEFAULT_LOGIN_PAGE_IMAGE_LAB_CONFIG = json.dumps(
    LOGIN_PAGE_TEMPLATE_CONFIG_DEFAULTS["image-lab"],
    ensure_ascii=False,
    separators=(",", ":"),
)
DEFAULT_IMAGE_GENERATION_MAX_DIMENSION = 3840
IMAGE_GENERATION_MIN_DIMENSION = 512
IMAGE_GENERATION_DIMENSION_MULTIPLE = 16
IMAGE_GENERATION_MIN_MAX_DIMENSION = 512
IMAGE_GENERATION_MAX_MAX_DIMENSION = 8192
IMAGE_GENERATION_MAX_DIMENSION = DEFAULT_IMAGE_GENERATION_MAX_DIMENSION
IMAGE_GENERATION_MAX_PIXELS = 8_294_400
IMAGE_GENERATION_MAX_ASPECT_RATIO = 3.0
DEFAULT_IMAGE_SESSION_IDLE_TIMEOUT_MINUTES = 90
IMAGE_SESSION_IDLE_TIMEOUT_MIN_MINUTES = 1
IMAGE_SESSION_IDLE_TIMEOUT_MAX_MINUTES = 24 * 60
DEFAULT_IMAGE_SESSION_WORKER_FAILSAFE_TIME_LIMIT_MINUTES = 24 * 60
DEFAULT_IMAGE_SESSION_MAX_BASE_IMAGES = 6
IMAGE_SESSION_MIN_MAX_BASE_IMAGES = 0
IMAGE_SESSION_MAX_MAX_BASE_IMAGES = 20
DEFAULT_WORKFLOW_IMAGE_GENERATION_PROVIDER_TIMEOUT_SECONDS = 15 * 60
DEFAULT_GENERATION_CONFIG_AVAILABILITY_WINDOW_MINUTES = 5
DEFAULT_GENERATION_CONFIG_FAILURE_THRESHOLD = 3
DEFAULT_GENERATION_CONFIG_COOLDOWN_MINUTES = 10
DEFAULT_GALLERY_VIEW_DEDUP_WINDOW_MINUTES = 60
GALLERY_VIEW_DEDUP_WINDOW_MIN_MINUTES = 1
GALLERY_VIEW_DEDUP_WINDOW_MAX_MINUTES = 7 * 24 * 60
DEFAULT_GENERATION_TAIL_SPLITTER_MAX_ITEMS = 36
DEFAULT_WORKFLOW_NODE_MAX_RETRY_COUNT = 10
DEFAULT_WORKFLOW_NODE_RETRY_DELAY_MS = 2000
GENERATION_TAIL_SPLITTER_MIN_MAX_ITEMS = 1
GENERATION_TAIL_SPLITTER_MAX_MAX_ITEMS = 100
WORKFLOW_NODE_MIN_MAX_RETRY_COUNT = 0
WORKFLOW_NODE_MAX_MAX_RETRY_COUNT = 100
WORKFLOW_NODE_MIN_RETRY_DELAY_MS = 0
WORKFLOW_NODE_MAX_RETRY_DELAY_MS = 60 * 60 * 1000
GLOBAL_GENERATION_QUEUE_CAPACITY_CATEGORY = "全局生成配置 / 队列容量"
LEGACY_GENERATION_MAX_CONCURRENT_TASKS_KEY = "generation_max_concurrent_tasks"
TEXT_GENERATION_MAX_CONCURRENT_TASKS_KEY = "text_generation_max_concurrent_tasks"
IMAGE_GENERATION_MAX_CONCURRENT_TASKS_KEY = "image_generation_max_concurrent_tasks"
GLOBAL_GENERATION_SCHEDULER_DEFAULTS_CATEGORY = "全局生成配置 / 调度默认值"
GLOBAL_GENERATION_RECOVERY_CATEGORY = "全局生成配置 / 任务恢复"
GLOBAL_GENERATION_IMAGE_SESSION_CATEGORY = "全局生成配置 / 文/图生图"
GLOBAL_GENERATION_WORKFLOW_CATEGORY = "全局生成配置 / 工作流生成"
IMAGE_SIZE_CONFIG_KEYS = {"image_main_image_size", "image_promo_poster_size"}
PROMPT_CONFIG_KEYS = {
    "prompt_brief_system",
    "prompt_copy_system",
    "prompt_poster_image_template",
    "prompt_poster_image_edit_template",
    "prompt_poster_image_reference_policy",
    "prompt_image_chat_template",
    "prompt_image_prompt_polish_system",
    "prompt_tail_split_system",
}
IMAGE_TOOL_FIELD_KEYS: tuple[str, ...] = (
    "model",
    "quality",
    "output_format",
    "output_compression",
    "background",
    "moderation",
    "action",
    "input_fidelity",
    "partial_images",
)
IMAGE_TOOL_LEGACY_FIELD_KEYS: tuple[str, ...] = ("n",)
DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS: tuple[str, ...] = tuple(key for key in IMAGE_TOOL_FIELD_KEYS if key != "background")
DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS_TEXT = ",".join(DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS)
BACKEND_DIR = Path(__file__).resolve().parents[2]
DEFAULT_LOG_DIR = BACKEND_DIR / "storage" / "logs"
DEFAULT_PROMPT_BRIEF_SYSTEM = (
    "你是业务资料理解助手。请根据名称、分类、补充资料、目标用途和约束，输出简洁、结构化的中文 JSON。不要输出 markdown。"
)
DEFAULT_PROMPT_COPY_SYSTEM = (
    "你是内容生成助手。请输出中文 JSON，不输出 markdown，语言清晰、直接，可用于页面文案、视觉素材说明或内容草稿。"
)
DEFAULT_PROMPT_POSTER_IMAGE_TEMPLATE = """请根据本轮用户要求与显式连接的上游上下文生成图片。
用户要求：{instruction}
输出尺寸：{size}
上游上下文：
{context_block}
视觉参考规则：
{reference_policy}
{kind_requirements}
请直接生成图片，不要返回说明文字。"""
DEFAULT_PROMPT_POSTER_IMAGE_EDIT_TEMPLATE = DEFAULT_PROMPT_POSTER_IMAGE_TEMPLATE
DEFAULT_PROMPT_POSTER_IMAGE_REFERENCE_POLICY = (
    "如有输入图片，以输入图片中的主体、结构、材质、风格或场景作为视觉基准；"
    "文字资料较弱时优先遵循图片主体，不要替换成无关角色、IP、品牌或主题。"
    "文案只作为内容意图和排版辅助。"
)
DEFAULT_PROMPT_IMAGE_CHAT_TEMPLATE = """请根据本轮用户要求生成图片。
输出尺寸：{size}
{history_block}
本轮用户要求：{prompt}
请直接生成图片，不要返回说明文字。"""
DEFAULT_PROMPT_IMAGE_PROMPT_POLISH_SYSTEM = (
    "你是图片生成提示词编辑器。只输出润色后的中文画面描述，不要输出 markdown、标题或解释。"
    "保留原始主体、风格、构图和禁忌要求，补充清晰主体、光线、材质、背景、镜头和可执行视觉细节。"
)
DEFAULT_PROMPT_TAIL_SPLIT_SYSTEM = (
    "你是工作台长文本拆分器。把输入拆成多条彼此独立、适合后续单独生成视觉内容的方向。"
    "拆分数量必须根据实际内容决定，max_items 只是上限，不要为了填满上限硬拆或同义改写。"
    "只输出 JSON 对象，不要输出 markdown。"
)


@dataclass(frozen=True, slots=True)
class ConfigOption:
    value: str
    label: str


@dataclass(frozen=True, slots=True)
class ConfigDefinition:
    key: str
    label: str
    category: str
    input_type: ConfigInputType
    description: str = ""
    options: tuple[ConfigOption, ...] = ()
    secret: bool = False
    minimum: int | None = None
    maximum: int | None = None
    optional: bool = False


def parse_login_page_template_config(template_id: str, value: Any) -> dict[str, str]:
    if template_id not in LOGIN_PAGE_TEMPLATE_CONFIG_DEFAULTS:
        supported = ", ".join(LOGIN_PAGE_TEMPLATE_IDS)
        raise ValueError(f"登录页模板必须是以下之一: {supported}")

    defaults = LOGIN_PAGE_TEMPLATE_CONFIG_DEFAULTS[template_id]
    if isinstance(value, Mapping):
        raw_config = dict(value)
    elif isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            raw_config = {}
        else:
            try:
                decoded = json.loads(normalized)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{LOGIN_PAGE_TEMPLATE_NAMES[template_id]} 配置必须是 JSON 对象") from exc
            if not isinstance(decoded, Mapping):
                raise ValueError(f"{LOGIN_PAGE_TEMPLATE_NAMES[template_id]} 配置必须是 JSON 对象")
            raw_config = dict(decoded)
    elif value is None:
        raw_config = {}
    else:
        raise ValueError(f"{LOGIN_PAGE_TEMPLATE_NAMES[template_id]} 配置必须是 JSON 对象")

    unknown_fields = set(raw_config) - set(defaults)
    if unknown_fields:
        raise ValueError(
            f"{LOGIN_PAGE_TEMPLATE_NAMES[template_id]} 配置包含不支持字段: {', '.join(sorted(unknown_fields))}"
        )

    limits = LOGIN_PAGE_TEMPLATE_CONFIG_LIMITS[template_id]
    parsed: dict[str, str] = {}
    for field_name, default_value in defaults.items():
        raw_value = raw_config.get(field_name, default_value)
        normalized_value = "" if raw_value is None else str(raw_value).strip()
        maximum = limits.get(field_name)
        if maximum is not None and len(normalized_value) > maximum:
            raise ValueError(f"{LOGIN_PAGE_TEMPLATE_NAMES[template_id]} {field_name} 不能超过 {maximum} 个字符")
        parsed[field_name] = normalized_value or default_value
    return parsed


def normalize_login_page_template_config(template_id: str, value: Any) -> str:
    return json.dumps(
        parse_login_page_template_config(template_id, value),
        ensure_ascii=False,
        separators=(",", ":"),
    )


def normalize_login_page_template_config_by_key(key: str, value: Any) -> str:
    template_id = LOGIN_PAGE_TEMPLATE_ID_BY_CONFIG_KEY.get(key)
    if template_id is None:
        raise ValueError(f"未知登录页配置项: {key}")
    return normalize_login_page_template_config(template_id, value)


def migrate_legacy_login_page_config_values(values: Mapping[str, Any]) -> dict[str, Any]:
    migrated = dict(values)
    legacy_selected_template_id = str(migrated.pop("login_page_selected_template_id", "") or "").strip()
    migrated.pop("login_page_enabled_template_ids", None)

    if migrated.get("login_page_mode") == "selected":
        migrated["login_page_mode"] = (
            legacy_selected_template_id
            if legacy_selected_template_id in LOGIN_PAGE_TEMPLATE_IDS
            else DEFAULT_LOGIN_PAGE_TEMPLATE_ID
        )

    for template_id, legacy_keys in LOGIN_PAGE_LEGACY_CONFIG_KEYS.items():
        config_key = LOGIN_PAGE_TEMPLATE_CONFIG_KEYS[template_id]
        legacy_config = {
            field_name: migrated.pop(legacy_key)
            for legacy_key, field_name in legacy_keys.items()
            if legacy_key in migrated
        }
        if config_key not in migrated and legacy_config:
            migrated[config_key] = normalize_login_page_template_config(template_id, legacy_config)
    return migrated


class Settings(BaseSettings):
    """应用配置：环境变量 + 数据库覆盖。

    基础设施配置（数据库 / Redis / Secret 等）仅从环境变量读取，
    业务配置可在运行时通过 app_settings 表覆盖。历史 text/image provider 字段仅作为供应商迁移输入。
    """

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 29280
    backend_cors_origins: str = "http://localhost:29281,http://127.0.0.1:29281"
    session_cookie_secure: bool = False

    admin_access_key: str = Field(min_length=8)
    session_secret: str = Field(min_length=16)

    database_url: str
    redis_url: str
    storage_root: Path = Path("./backend/storage")
    storage_backend: Literal["local", "minio", "s3"] = "local"
    storage_public_base_url: str | None = None
    s3_endpoint_url: str | None = None
    s3_bucket: str = "inspiration-one"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_region: str = "us-east-1"

    log_dir: Path = DEFAULT_LOG_DIR
    log_level: str = "INFO"
    log_max_bytes: int = 10 * 1024 * 1024
    log_backup_count: int = 5
    log_retention_days: int = 14

    text_provider_kind: str = "mock"
    text_api_key: str | None = None
    text_base_url: str | None = None
    text_brief_model: str = "gpt-4o"
    text_copy_model: str = "gpt-4o"

    image_provider_kind: str = "mock"
    image_api_key: str | None = None
    image_base_url: str | None = None
    image_generate_model: str = "gpt-5.4"
    image_images_quality: str | None = None
    image_images_style: str | None = None
    image_responses_background_enabled: bool = True
    image_tool_model: str | None = None
    image_tool_quality: str | None = None
    image_tool_output_format: str | None = None
    image_tool_output_compression: int | None = Field(default=None, ge=0, le=100)
    image_tool_background: str | None = None
    image_tool_moderation: str | None = None
    image_tool_action: str | None = None
    image_tool_input_fidelity: str | None = None
    image_tool_partial_images: int | None = Field(default=None, ge=0, le=3)
    image_tool_n: int | None = Field(default=None, ge=1, le=10)
    image_tool_allowed_fields: str = DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS_TEXT
    image_generation_max_dimension: int = Field(
        default=DEFAULT_IMAGE_GENERATION_MAX_DIMENSION,
        ge=IMAGE_GENERATION_MIN_MAX_DIMENSION,
        le=IMAGE_GENERATION_MAX_MAX_DIMENSION,
    )
    image_session_max_base_images: int = Field(
        default=DEFAULT_IMAGE_SESSION_MAX_BASE_IMAGES,
        ge=IMAGE_SESSION_MIN_MAX_BASE_IMAGES,
        le=IMAGE_SESSION_MAX_MAX_BASE_IMAGES,
    )
    image_main_image_size: str = "1024x1024"
    image_promo_poster_size: str = "1024x1536"
    poster_generation_mode: str = "template"

    poster_font_path: Path = Path("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc")

    prompt_brief_system: str = DEFAULT_PROMPT_BRIEF_SYSTEM
    prompt_copy_system: str = DEFAULT_PROMPT_COPY_SYSTEM
    prompt_poster_image_template: str = DEFAULT_PROMPT_POSTER_IMAGE_TEMPLATE
    prompt_poster_image_edit_template: str = DEFAULT_PROMPT_POSTER_IMAGE_EDIT_TEMPLATE
    prompt_poster_image_reference_policy: str = DEFAULT_PROMPT_POSTER_IMAGE_REFERENCE_POLICY
    prompt_image_chat_template: str = DEFAULT_PROMPT_IMAGE_CHAT_TEMPLATE
    prompt_image_prompt_polish_system: str = DEFAULT_PROMPT_IMAGE_PROMPT_POLISH_SYSTEM
    prompt_tail_split_system: str = DEFAULT_PROMPT_TAIL_SPLIT_SYSTEM

    upload_max_image_bytes: int = 10 * 1024 * 1024
    upload_max_reference_images: int = 6
    upload_max_pixels: int = 16_000_000
    upload_allowed_image_mime_types: str = "image/png,image/jpeg,image/webp"

    generation_max_concurrent_tasks: int = Field(default=3, ge=1, le=20)
    text_generation_max_concurrent_tasks: int = Field(default=3, ge=1, le=20)
    image_generation_max_concurrent_tasks: int = Field(default=3, ge=1, le=20)
    generation_config_default_availability_window_minutes: int = Field(default=5, ge=1, le=24 * 60)
    generation_config_default_failure_threshold: int = Field(default=3, ge=1, le=100)
    generation_config_default_cooldown_minutes: int = Field(default=10, ge=1, le=24 * 60)
    generation_tail_splitter_max_items: int = Field(
        default=DEFAULT_GENERATION_TAIL_SPLITTER_MAX_ITEMS,
        ge=GENERATION_TAIL_SPLITTER_MIN_MAX_ITEMS,
        le=GENERATION_TAIL_SPLITTER_MAX_MAX_ITEMS,
    )
    workflow_node_max_retry_count: int = Field(
        default=DEFAULT_WORKFLOW_NODE_MAX_RETRY_COUNT,
        ge=WORKFLOW_NODE_MIN_MAX_RETRY_COUNT,
        le=WORKFLOW_NODE_MAX_MAX_RETRY_COUNT,
    )
    workflow_node_retry_delay_ms: int = Field(
        default=DEFAULT_WORKFLOW_NODE_RETRY_DELAY_MS,
        ge=WORKFLOW_NODE_MIN_RETRY_DELAY_MS,
        le=WORKFLOW_NODE_MAX_RETRY_DELAY_MS,
    )
    image_session_stale_running_after_minutes: int = Field(
        default=DEFAULT_IMAGE_SESSION_IDLE_TIMEOUT_MINUTES,
        ge=IMAGE_SESSION_IDLE_TIMEOUT_MIN_MINUTES,
        le=IMAGE_SESSION_IDLE_TIMEOUT_MAX_MINUTES,
    )
    image_session_worker_failsafe_time_limit_minutes: int = Field(
        default=DEFAULT_IMAGE_SESSION_WORKER_FAILSAFE_TIME_LIMIT_MINUTES,
        ge=IMAGE_SESSION_IDLE_TIMEOUT_MIN_MINUTES,
        le=IMAGE_SESSION_IDLE_TIMEOUT_MAX_MINUTES,
    )
    workflow_image_generation_provider_timeout_seconds: int = Field(
        default=DEFAULT_WORKFLOW_IMAGE_GENERATION_PROVIDER_TIMEOUT_SECONDS,
        ge=1,
        le=24 * 60 * 60,
    )
    ui_layout_scheme: str = DEFAULT_UI_LAYOUT_SCHEME
    gallery_show_generation_resource_group: bool = True
    gallery_view_dedup_window_minutes: int = Field(
        default=DEFAULT_GALLERY_VIEW_DEDUP_WINDOW_MINUTES,
        ge=GALLERY_VIEW_DEDUP_WINDOW_MIN_MINUTES,
        le=GALLERY_VIEW_DEDUP_WINDOW_MAX_MINUTES,
    )
    login_page_mode: str = DEFAULT_LOGIN_PAGE_MODE
    login_page_selected_template_id: str = ""
    login_page_enabled_template_ids: str = DEFAULT_LOGIN_PAGE_ENABLED_TEMPLATE_IDS_TEXT
    login_page_command_orbit_config: str = DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_CONFIG
    login_page_fluid_mist_config: str = DEFAULT_LOGIN_PAGE_FLUID_MIST_CONFIG
    login_page_image_lab_config: str = DEFAULT_LOGIN_PAGE_IMAGE_LAB_CONFIG
    login_page_command_orbit_brand_subtitle: str = DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_BRAND_SUBTITLE
    login_page_command_orbit_hero_title: str = DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_HERO_TITLE
    login_page_command_orbit_hero_description: str = DEFAULT_LOGIN_PAGE_COMMAND_ORBIT_HERO_DESCRIPTION
    login_page_fluid_mist_greeting_title: str = DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_TITLE
    login_page_fluid_mist_greeting_description: str = DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_DESCRIPTION
    login_page_image_lab_hero_description: str = DEFAULT_LOGIN_PAGE_IMAGE_LAB_HERO_DESCRIPTION
    login_page_image_lab_hero_image_asset_id: str = ""
    admin_access_required: bool = True
    deletion_enabled: bool = False

    @model_validator(mode="before")
    @classmethod
    def _fill_split_generation_capacity_defaults(cls, data: Any) -> Any:
        if not isinstance(data, Mapping):
            return data
        values = migrate_legacy_login_page_config_values(data)
        legacy_capacity = values.get("generation_max_concurrent_tasks")
        if legacy_capacity is not None:
            values.setdefault("text_generation_max_concurrent_tasks", legacy_capacity)
            values.setdefault("image_generation_max_concurrent_tasks", legacy_capacity)
        return values

    @field_validator("image_main_image_size", "image_promo_poster_size")
    @classmethod
    def _normalize_image_generation_fallback_size(cls, value: str, info: ValidationInfo) -> str:
        max_dimension = int(info.data.get("image_generation_max_dimension") or DEFAULT_IMAGE_GENERATION_MAX_DIMENSION)
        return normalize_image_generation_size(value, max_dimension=max_dimension)

    @field_validator(
        "image_tool_model",
        "image_tool_quality",
        "image_tool_output_format",
        "image_tool_background",
        "image_tool_moderation",
        "image_tool_action",
        "image_tool_input_fidelity",
        "image_images_quality",
        "image_images_style",
        mode="before",
    )
    @classmethod
    def _normalize_optional_image_tool_text(cls, value: Any) -> str | None:
        normalized = "" if value is None else str(value).strip()
        return normalized or None

    @field_validator("image_tool_output_compression", "image_tool_partial_images", "image_tool_n", mode="before")
    @classmethod
    def _normalize_optional_image_tool_int(cls, value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return int(value)

    @field_validator(
        "text_generation_max_concurrent_tasks",
        "image_generation_max_concurrent_tasks",
        mode="before",
    )
    @classmethod
    def _normalize_optional_generation_capacity(cls, value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return int(value)

    @field_validator("storage_backend", mode="before")
    @classmethod
    def _normalize_storage_backend(cls, value: Any) -> str:
        normalized = "" if value is None else str(value).strip().lower()
        return normalized or "local"

    @field_validator("storage_public_base_url", "s3_endpoint_url", "s3_access_key", "s3_secret_key", mode="before")
    @classmethod
    def _normalize_optional_storage_text(cls, value: Any) -> str | None:
        normalized = "" if value is None else str(value).strip()
        return normalized or None

    @field_validator("s3_bucket", "s3_region", mode="before")
    @classmethod
    def _normalize_storage_text(cls, value: Any) -> str:
        return "" if value is None else str(value).strip()

    @field_validator("ui_layout_scheme", mode="before")
    @classmethod
    def _normalize_ui_layout_scheme(cls, value: Any) -> str:
        normalized = DEFAULT_UI_LAYOUT_SCHEME if value is None else str(value).strip()
        if is_supported_ui_layout_scheme(normalized):
            return normalized
        supported = ", ".join(SUPPORTED_UI_LAYOUT_SCHEMES)
        raise ValueError(f"UI 布局方案必须是以下之一: {supported}")

    @field_validator("image_tool_allowed_fields", mode="before")
    @classmethod
    def _normalize_image_tool_allowed_fields(cls, value: Any) -> str:
        return normalize_image_tool_allowed_fields(value)

    @field_validator("login_page_mode", mode="before")
    @classmethod
    def _normalize_login_page_mode(cls, value: Any) -> str:
        normalized = DEFAULT_LOGIN_PAGE_MODE if value is None else str(value).strip()
        if normalized in LOGIN_PAGE_MODE_VALUES:
            return normalized
        supported = ", ".join(LOGIN_PAGE_MODE_VALUES)
        raise ValueError(f"登录页选择必须是以下之一: {supported}")

    @field_validator("login_page_selected_template_id", mode="before")
    @classmethod
    def _normalize_login_page_selected_template_id(cls, value: Any) -> str:
        normalized = "" if value is None else str(value).strip()
        if not normalized or normalized in LOGIN_PAGE_TEMPLATE_IDS:
            return normalized
        supported = ", ".join(LOGIN_PAGE_TEMPLATE_IDS)
        raise ValueError(f"指定登录页必须是以下之一: {supported}")

    @field_validator("login_page_enabled_template_ids", mode="before")
    @classmethod
    def _normalize_login_page_enabled_template_ids(cls, value: Any) -> str:
        return normalize_login_page_template_ids(value)

    @field_validator(
        "login_page_command_orbit_config",
        "login_page_fluid_mist_config",
        "login_page_image_lab_config",
        mode="before",
    )
    @classmethod
    def _normalize_login_page_config(cls, value: Any, info: ValidationInfo) -> str:
        return normalize_login_page_template_config_by_key(info.field_name, value)

    @field_validator("login_page_image_lab_hero_image_asset_id", mode="before")
    @classmethod
    def _normalize_login_page_asset_id(cls, value: Any) -> str:
        normalized = "" if value is None else str(value).strip()
        if len(normalized) > 64:
            raise ValueError("登录页资源库图片 ID 不能超过 64 个字符")
        return normalized

    @model_validator(mode="after")
    def _validate_storage_backend_config(self) -> Settings:
        if self.storage_backend == "local":
            return self
        missing_fields = [
            label
            for label, value in (
                ("S3_ENDPOINT_URL", self.s3_endpoint_url),
                ("S3_BUCKET", self.s3_bucket),
                ("S3_ACCESS_KEY", self.s3_access_key),
                ("S3_SECRET_KEY", self.s3_secret_key),
                ("S3_REGION", self.s3_region),
            )
            if not value
        ]
        if missing_fields:
            raise ValueError(f"对象存储后端缺少环境变量: {', '.join(missing_fields)}")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]

    @property
    def allowed_image_mime_types(self) -> set[str]:
        return {
            mime_type.strip().lower()
            for mime_type in self.upload_allowed_image_mime_types.split(",")
            if mime_type.strip()
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Bootstrap settings loaded from env.

    Infrastructure settings such as database URL, Redis URL, session secret and
    admin key intentionally stay env-backed because the app needs them before it
    can read any database-stored configuration.
    """

    return Settings()


CONFIG_DEFINITIONS: tuple[ConfigDefinition, ...] = (
    ConfigDefinition(
        key="image_tool_allowed_fields",
        label="可用 Tool 字段",
        category="图片工具参数",
        input_type="multi_select",
        options=tuple(ConfigOption(key, key) for key in IMAGE_TOOL_FIELD_KEYS),
        description=(
            "控制前端可展示、后端可持久化并发送给 Responses image_generation tool 的高级字段；"
            "Images API n 由候选数量或下游承载节点数自动计算，不作为可选字段展示。"
        ),
    ),
    ConfigDefinition(
        key="image_tool_model",
        label="Tool 模型",
        category="图片工具参数",
        input_type="text",
        description="留空不发送；需要 provider 支持。",
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_quality",
        label="质量",
        category="图片工具参数",
        input_type="select",
        options=(
            ConfigOption("", "默认"),
            ConfigOption("auto", "Auto"),
            ConfigOption("low", "Low"),
            ConfigOption("medium", "Medium"),
            ConfigOption("high", "High"),
        ),
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_output_format",
        label="格式",
        category="图片工具参数",
        input_type="select",
        options=(
            ConfigOption("", "默认"),
            ConfigOption("png", "PNG"),
            ConfigOption("jpeg", "JPEG"),
            ConfigOption("webp", "WebP"),
        ),
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_output_compression",
        label="压缩",
        category="图片工具参数",
        input_type="number",
        description="0-100；留空不发送。",
        minimum=0,
        maximum=100,
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_background",
        label="背景",
        category="图片工具参数",
        input_type="select",
        options=(
            ConfigOption("", "默认"),
            ConfigOption("auto", "Auto"),
            ConfigOption("opaque", "Opaque"),
            ConfigOption("transparent", "Transparent"),
        ),
        description="仅在可用 Tool 字段勾选 background 后发送。",
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_moderation",
        label="审核",
        category="图片工具参数",
        input_type="select",
        options=(ConfigOption("", "默认"), ConfigOption("auto", "Auto"), ConfigOption("low", "Low")),
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_action",
        label="Action",
        category="图片工具参数",
        input_type="select",
        options=(
            ConfigOption("", "默认"),
            ConfigOption("auto", "Auto"),
            ConfigOption("generate", "Generate"),
            ConfigOption("edit", "Edit"),
        ),
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_input_fidelity",
        label="Input fidelity",
        category="图片工具参数",
        input_type="select",
        options=(ConfigOption("", "默认"), ConfigOption("low", "Low"), ConfigOption("high", "High")),
        optional=True,
    ),
    ConfigDefinition(
        key="image_tool_partial_images",
        label="Partial",
        category="图片工具参数",
        input_type="number",
        description="0-3；留空不发送。",
        minimum=0,
        maximum=3,
        optional=True,
    ),
    ConfigDefinition(
        key="image_generation_max_dimension",
        label="生图最大单边",
        category="图片生成",
        input_type="number",
        description="文/图生图和工作流生图的最大宽/高像素；总面积同时受 GPT Image 当前上限约束。",
        minimum=IMAGE_GENERATION_MIN_MAX_DIMENSION,
        maximum=IMAGE_GENERATION_MAX_MAX_DIMENSION,
    ),
    ConfigDefinition(
        key="image_session_max_base_images",
        label="文/图生图基图上限",
        category=GLOBAL_GENERATION_IMAGE_SESSION_CATEGORY,
        input_type="number",
        description="单轮文/图生图允许选择的历史生成图和会话参考图总数；设为 0 表示不允许附带基图。",
        minimum=IMAGE_SESSION_MIN_MAX_BASE_IMAGES,
        maximum=IMAGE_SESSION_MAX_MAX_BASE_IMAGES,
    ),
    ConfigDefinition(
        key="image_main_image_size",
        label="主图尺寸（兼容默认）",
        category="图片生成",
        input_type="text",
        description=(
            "高级/兼容默认值：仅当图片 provider 输入未显式传入 image_size，"
            "且生成类型为 MAIN_IMAGE 时使用。新工作流生图节点通常会传入明确尺寸，"
            "请优先使用节点里的尺寸选择器。"
        ),
    ),
    ConfigDefinition(
        key="image_promo_poster_size",
        label="促销海报尺寸（兼容默认）",
        category="图片生成",
        input_type="text",
        description=(
            "高级/兼容默认值：仅当图片 provider 输入未显式传入 image_size，"
            "且生成类型为 PROMO_POSTER 时使用。新工作流生图节点通常会传入明确尺寸，"
            "请优先使用节点里的尺寸选择器。"
        ),
    ),
    ConfigDefinition(
        key="poster_generation_mode",
        label="海报生成模式",
        category="海报与上传",
        input_type="select",
        options=(ConfigOption("template", "模板渲染"), ConfigOption("generated", "AI 生成")),
        description="本地模板用于 mock/dev fallback；绑定真实图片供应商时工作流生图自动使用 AI 生成。",
    ),
    ConfigDefinition(
        key="poster_font_path",
        label="海报字体路径",
        category="海报与上传",
        input_type="text",
        description="模板海报和 mock 图片中用于中文文字渲染的字体文件。",
    ),
    ConfigDefinition(
        key="prompt_brief_system",
        label="资料理解系统提示词",
        category="提示词",
        input_type="textarea",
        description="用于项目/内容资料理解，要求模型输出 CreativeBrief JSON。",
    ),
    ConfigDefinition(
        key="prompt_copy_system",
        label="文案生成系统提示词",
        category="提示词",
        input_type="textarea",
        description="用于结构化内容生成，要求模型输出 Copy JSON。",
    ),
    ConfigDefinition(
        key="prompt_poster_image_template",
        label="工作台生图提示词模板",
        category="提示词",
        input_type="textarea",
        description=(
            "用于工作台 AI 生图。可用占位符：instruction、size、context_block、reference_policy、"
            "kind、kind_label、kind_requirements。"
        ),
    ),
    ConfigDefinition(
        key="prompt_poster_image_edit_template",
        label="图片改图提示词模板",
        category="提示词",
        input_type="textarea",
        description=(
            "用于工作台参考图/生成图继续生图。可用占位符：instruction、size、context_block、"
            "reference_policy、kind、kind_label、kind_requirements。"
        ),
    ),
    ConfigDefinition(
        key="prompt_poster_image_reference_policy",
        label="工作台视觉参考规则",
        category="提示词",
        input_type="textarea",
        description="用于工作台生图模板的 reference_policy 占位符，可在设置中调整图片主体优先级规则。",
    ),
    ConfigDefinition(
        key="prompt_image_chat_template",
        label="文/图生图提示词模板",
        category="提示词",
        input_type="textarea",
        description="用于文/图生图对话。可用占位符：prompt、size、history_block。",
    ),
    ConfigDefinition(
        key="prompt_image_prompt_polish_system",
        label="画面描述润色系统提示词",
        category="提示词",
        input_type="textarea",
        description="用于文/图生图的画面描述润色。只应输出润色后的提示词。",
    ),
    ConfigDefinition(
        key="prompt_tail_split_system",
        label="尾巴节点拆分系统提示词",
        category="提示词",
        input_type="textarea",
        description="用于尾巴节点把长文本或上游内容拆分为多条可执行生图方向。",
    ),
    ConfigDefinition(
        key="upload_max_image_bytes",
        label="单图最大字节数",
        category="海报与上传",
        input_type="number",
        minimum=1,
    ),
    ConfigDefinition(
        key="upload_max_reference_images",
        label="最多参考图数量",
        category="海报与上传",
        input_type="number",
        minimum=0,
    ),
    ConfigDefinition(
        key="upload_max_pixels",
        label="最大像素数",
        category="海报与上传",
        input_type="number",
        minimum=1,
    ),
    ConfigDefinition(
        key="upload_allowed_image_mime_types",
        label="允许图片 MIME",
        category="海报与上传",
        input_type="textarea",
        description="逗号分隔，例如 image/png,image/jpeg,image/webp。",
    ),
    ConfigDefinition(
        key=TEXT_GENERATION_MAX_CONCURRENT_TASKS_KEY,
        label="文案生成并发上限",
        category=GLOBAL_GENERATION_QUEUE_CAPACITY_CATEGORY,
        input_type="number",
        description="文案工作流节点的全局运行上限；多容器 worker 共享该业务容量池。",
        minimum=1,
        maximum=20,
    ),
    ConfigDefinition(
        key=IMAGE_GENERATION_MAX_CONCURRENT_TASKS_KEY,
        label="图片生成并发上限",
        category=GLOBAL_GENERATION_QUEUE_CAPACITY_CATEGORY,
        input_type="number",
        description="图片工作流节点和文/图生图任务的全局运行上限；多容器 worker 共享该业务容量池。",
        minimum=1,
        maximum=20,
    ),
    ConfigDefinition(
        key="generation_config_default_availability_window_minutes",
        label="默认可用性窗口（分钟）",
        category=GLOBAL_GENERATION_SCHEDULER_DEFAULTS_CATEGORY,
        input_type="number",
        description="新建文案/图片生成配置时使用的失败统计窗口；单个配置可单独覆盖。",
        minimum=1,
        maximum=24 * 60,
    ),
    ConfigDefinition(
        key="generation_config_default_failure_threshold",
        label="默认失败阈值",
        category=GLOBAL_GENERATION_SCHEDULER_DEFAULTS_CATEGORY,
        input_type="number",
        description="新建文案/图片生成配置时使用的窗口内失败阈值；达到后进入冷冻期。",
        minimum=1,
        maximum=100,
    ),
    ConfigDefinition(
        key="generation_config_default_cooldown_minutes",
        label="默认冷冻时长（分钟）",
        category=GLOBAL_GENERATION_SCHEDULER_DEFAULTS_CATEGORY,
        input_type="number",
        description="新建文案/图片生成配置触发熔断后默认暂停调度的分钟数。",
        minimum=1,
        maximum=24 * 60,
    ),
    ConfigDefinition(
        key="generation_tail_splitter_max_items",
        label="尾巴节点最大拆分数",
        category=GLOBAL_GENERATION_WORKFLOW_CATEGORY,
        input_type="number",
        description="保存和运行尾巴节点时允许的最大拆分项数；AI 会按实际内容输出不超过该值的拆分项。",
        minimum=GENERATION_TAIL_SPLITTER_MIN_MAX_ITEMS,
        maximum=GENERATION_TAIL_SPLITTER_MAX_MAX_ITEMS,
    ),
    ConfigDefinition(
        key="workflow_node_max_retry_count",
        label="画布节点失败重试次数",
        category=GLOBAL_GENERATION_WORKFLOW_CATEGORY,
        input_type="number",
        description="同一画布节点失败后允许直接重新运行的最大次数；达到上限后需要调整节点或提高该值。",
        minimum=WORKFLOW_NODE_MIN_MAX_RETRY_COUNT,
        maximum=WORKFLOW_NODE_MAX_MAX_RETRY_COUNT,
    ),
    ConfigDefinition(
        key="workflow_node_retry_delay_ms",
        label="画布节点失败重试等待（毫秒）",
        category=GLOBAL_GENERATION_WORKFLOW_CATEGORY,
        input_type="number",
        description="同一画布节点失败后，必须等待该毫秒数才允许再次直接运行；设为 0 表示不等待。",
        minimum=WORKFLOW_NODE_MIN_RETRY_DELAY_MS,
        maximum=WORKFLOW_NODE_MAX_RETRY_DELAY_MS,
    ),
    ConfigDefinition(
        key="image_session_stale_running_after_minutes",
        label="文/图生图进度闲置恢复阈值（分钟）",
        category=GLOBAL_GENERATION_RECOVERY_CATEGORY,
        input_type="number",
        description=(
            "worker 启动恢复时，running 文/图生图任务会按最近 progress heartbeat 判断是否闲置；"
            "旧任务没有 progress 时回退到 started_at。"
        ),
        minimum=IMAGE_SESSION_IDLE_TIMEOUT_MIN_MINUTES,
        maximum=IMAGE_SESSION_IDLE_TIMEOUT_MAX_MINUTES,
    ),
    ConfigDefinition(
        key="workflow_image_generation_provider_timeout_seconds",
        label="工作流生图 Provider 超时（秒）",
        category=GLOBAL_GENERATION_WORKFLOW_CATEGORY,
        input_type="number",
        description="工作流 AI 生图节点单次 provider 调用的项目级超时上界；超时后会安全失败并释放生成队列容量。",
        minimum=1,
        maximum=24 * 60 * 60,
    ),
    ConfigDefinition(
        key="ui_layout_scheme",
        label="默认 UI 布局",
        category="界面与外观",
        input_type="select",
        options=(
            ConfigOption("classic", "经典"),
            ConfigOption("workspace", "工作台"),
        ),
        description="全局默认 UI 布局；用户在导航中主动切换后会保存为个人偏好。",
    ),
    ConfigDefinition(
        key="gallery_show_generation_resource_group",
        label="画廊展示生成分组",
        category="界面与外观",
        input_type="boolean",
        description="控制画廊卡片、预览弹窗和工作台画廊条是否展示生成分组溯源信息。",
    ),
    ConfigDefinition(
        key="gallery_view_dedup_window_minutes",
        label="画廊浏览去重窗口（分钟）",
        category="界面与外观",
        input_type="number",
        description="同一用户在该时间窗口内多次点击同一画廊作品只计一次浏览；超过窗口再次点击重新计数。",
        minimum=GALLERY_VIEW_DEDUP_WINDOW_MIN_MINUTES,
        maximum=GALLERY_VIEW_DEDUP_WINDOW_MAX_MINUTES,
    ),
    ConfigDefinition(
        key="login_page_mode",
        label="登录页选择",
        category=LOGIN_PAGE_CATEGORY,
        input_type="select",
        options=(
            ConfigOption("random", "随机"),
            *(
                ConfigOption(template_id, LOGIN_PAGE_TEMPLATE_NAMES[template_id])
                for template_id in LOGIN_PAGE_TEMPLATE_IDS
            ),
        ),
        description="随机会从全部登录页模板中选择；也可以固定使用某个模板。",
    ),
    ConfigDefinition(
        key="login_page_command_orbit_config",
        label="Command Orbit 文案配置",
        category=LOGIN_PAGE_CATEGORY,
        input_type="textarea",
        description="Command Orbit 登录页独立 JSON 配置，由设置页按字段渲染。",
    ),
    ConfigDefinition(
        key="login_page_fluid_mist_config",
        label="Fluid Mist 文案配置",
        category=LOGIN_PAGE_CATEGORY,
        input_type="textarea",
        description="Fluid Mist 登录页独立 JSON 配置，由设置页按字段渲染。",
    ),
    ConfigDefinition(
        key="login_page_image_lab_config",
        label="Image Lab 文案/图片配置",
        category=LOGIN_PAGE_CATEGORY,
        input_type="textarea",
        description="Image Lab 登录页独立 JSON 配置；图片只能从资源库选择。",
    ),
    ConfigDefinition(
        key="deletion_enabled",
        label="启用业务删除",
        category="安全与运维",
        input_type="boolean",
        description="默认关闭，用于体验站禁止整条灵感产物和文/图生图会话被删除，保留溯源证据。",
    ),
)

CONFIG_DEFINITION_BY_KEY: dict[str, ConfigDefinition] = {
    definition.key: definition for definition in CONFIG_DEFINITIONS
}
RUNTIME_CONFIG_KEYS: set[str] = set(CONFIG_DEFINITION_BY_KEY)
LEGACY_RUNTIME_CONFIG_KEYS: set[str] = {
    LEGACY_GENERATION_MAX_CONCURRENT_TASKS_KEY,
    *LOGIN_PAGE_LEGACY_RUNTIME_CONFIG_KEYS,
}


def normalize_image_size(value: Any, *, label: str = "图片尺寸") -> str:
    """校验并标准化图片尺寸格式 宽x高。"""
    normalized = "" if value is None else str(value).strip().lower()
    if not IMAGE_SIZE_PATTERN.fullmatch(normalized):
        raise ValueError(f"{label} 必须使用 宽x高 格式，例如 1024x1024")
    width, height = (int(part) for part in normalized.split("x", maxsplit=1))
    if width <= 0 or height <= 0:
        raise ValueError(f"{label} 宽高必须大于 0")
    return normalized


def _runtime_image_generation_max_dimension() -> int:
    return int(get_runtime_settings().image_generation_max_dimension)


def _image_generation_max_dimension_multiple(max_dimension: int) -> int:
    return max_dimension - (max_dimension % IMAGE_GENERATION_DIMENSION_MULTIPLE)


def _nearest_image_generation_dimension_multiple(value: int, *, max_dimension: int) -> int:
    lower = (value // IMAGE_GENERATION_DIMENSION_MULTIPLE) * IMAGE_GENERATION_DIMENSION_MULTIPLE
    upper = lower + IMAGE_GENERATION_DIMENSION_MULTIPLE
    candidates = [
        candidate for candidate in {lower, upper} if IMAGE_GENERATION_MIN_DIMENSION <= candidate <= max_dimension
    ]
    if candidates:
        return min(candidates, key=lambda candidate: (abs(candidate - value), candidate))
    if value < IMAGE_GENERATION_MIN_DIMENSION:
        return IMAGE_GENERATION_MIN_DIMENSION
    return max_dimension


def _constrain_image_generation_aspect_ratio(width: int, height: int) -> tuple[int, int]:
    if width <= 0 or height <= 0:
        return width, height
    ratio = max(width, height) / min(width, height)
    if ratio <= IMAGE_GENERATION_MAX_ASPECT_RATIO:
        return width, height
    if width >= height:
        return width, max(height, round(width / IMAGE_GENERATION_MAX_ASPECT_RATIO))
    return max(width, round(height / IMAGE_GENERATION_MAX_ASPECT_RATIO)), height


def normalize_image_generation_size(
    value: Any,
    *,
    label: str = "图片尺寸",
    max_dimension: int | None = None,
) -> str:
    """校验并校准生图尺寸，包含格式、正数和运行时安全边界。"""
    normalized = normalize_image_size(value, label=label)
    resolved_max_dimension = int(max_dimension or _runtime_image_generation_max_dimension())
    if (
        resolved_max_dimension < IMAGE_GENERATION_MIN_MAX_DIMENSION
        or resolved_max_dimension > IMAGE_GENERATION_MAX_MAX_DIMENSION
    ):
        raise ValueError(
            f"生图最大单边必须在 {IMAGE_GENERATION_MIN_MAX_DIMENSION}-{IMAGE_GENERATION_MAX_MAX_DIMENSION} 之间"
        )
    effective_max_dimension = _image_generation_max_dimension_multiple(resolved_max_dimension)
    max_pixels = min(IMAGE_GENERATION_MAX_PIXELS, effective_max_dimension * effective_max_dimension)
    width, height = _constrain_image_generation_aspect_ratio(*(int(part) for part in normalized.split("x", maxsplit=1)))
    scale = min(1.0, effective_max_dimension / width, effective_max_dimension / height)
    resolved_width = max(IMAGE_GENERATION_MIN_DIMENSION, round(width * scale))
    resolved_height = max(IMAGE_GENERATION_MIN_DIMENSION, round(height * scale))
    if resolved_width * resolved_height > max_pixels:
        pixel_scale = (max_pixels / (resolved_width * resolved_height)) ** 0.5
        resolved_width = max(IMAGE_GENERATION_MIN_DIMENSION, int(resolved_width * pixel_scale))
        resolved_height = max(IMAGE_GENERATION_MIN_DIMENSION, int(resolved_height * pixel_scale))
    resolved_width = _nearest_image_generation_dimension_multiple(resolved_width, max_dimension=effective_max_dimension)
    resolved_height = _nearest_image_generation_dimension_multiple(
        resolved_height,
        max_dimension=effective_max_dimension,
    )
    if resolved_width * resolved_height > max_pixels:
        pixel_scale = (max_pixels / (resolved_width * resolved_height)) ** 0.5
        resolved_width = max(
            IMAGE_GENERATION_MIN_DIMENSION,
            _nearest_image_generation_dimension_multiple(
                int(resolved_width * pixel_scale),
                max_dimension=effective_max_dimension,
            ),
        )
        resolved_height = max(
            IMAGE_GENERATION_MIN_DIMENSION,
            _nearest_image_generation_dimension_multiple(
                int(resolved_height * pixel_scale),
                max_dimension=effective_max_dimension,
            ),
        )
    return f"{resolved_width}x{resolved_height}"


def parse_image_tool_allowed_fields(value: Any) -> tuple[str, ...]:
    if value is None:
        parts: list[str] = []
    elif isinstance(value, str):
        parts = [part.strip() for part in re.split(r"[\s,]+", value) if part.strip()]
    elif isinstance(value, list | tuple | set):
        parts = [str(part).strip() for part in value if str(part).strip()]
    else:
        parts = [str(value).strip()] if str(value).strip() else []

    selected = set(parts)
    unknown = selected - set(IMAGE_TOOL_FIELD_KEYS) - set(IMAGE_TOOL_LEGACY_FIELD_KEYS)
    if unknown:
        raise ValueError(f"可用 Tool 字段包含不支持的字段: {', '.join(sorted(unknown))}")
    return tuple(key for key in IMAGE_TOOL_FIELD_KEYS if key in selected)


def normalize_image_tool_allowed_fields(value: Any) -> str:
    return ",".join(parse_image_tool_allowed_fields(value))


def parse_login_page_template_ids(value: Any) -> tuple[str, ...]:
    if value is None:
        parts: list[str] = []
    elif isinstance(value, str):
        parts = [part.strip() for part in re.split(r"[\s,]+", value) if part.strip()]
    elif isinstance(value, list | tuple | set):
        parts = [str(part).strip() for part in value if str(part).strip()]
    else:
        parts = [str(value).strip()] if str(value).strip() else []

    selected = set(parts)
    unknown = selected - set(LOGIN_PAGE_TEMPLATE_IDS)
    if unknown:
        raise ValueError(f"随机候选模板包含不支持的登录页: {', '.join(sorted(unknown))}")
    ordered = tuple(template_id for template_id in LOGIN_PAGE_TEMPLATE_IDS if template_id in selected)
    if not ordered:
        raise ValueError("随机候选模板至少保留一个")
    return ordered


def normalize_login_page_template_ids(value: Any) -> str:
    return ",".join(parse_login_page_template_ids(value))


def parse_config_multi_select(key: str, value: Any) -> tuple[str, ...]:
    if key == "image_tool_allowed_fields":
        return parse_image_tool_allowed_fields(value)
    if key == "login_page_enabled_template_ids":
        return parse_login_page_template_ids(value)
    raise ValueError(f"未知多选配置项: {key}")


def normalize_config_multi_select(key: str, value: Any) -> str:
    return ",".join(parse_config_multi_select(key, value))


def filter_image_tool_options(
    tool_options: Mapping[str, Any] | None,
    *,
    allowed_fields: tuple[str, ...] | None = None,
) -> dict[str, Any] | None:
    if not tool_options:
        return None
    resolved_allowed_fields = (
        allowed_fields
        if allowed_fields is not None
        else parse_image_tool_allowed_fields(get_runtime_settings().image_tool_allowed_fields)
    )
    selected_fields = set(resolved_allowed_fields)
    normalized = {
        str(key): value
        for key, value in tool_options.items()
        if str(key) in selected_fields and value is not None and not (isinstance(value, str) and not value.strip())
    }
    return normalized or None


def normalize_config_value(key: str, value: Any) -> str:
    definition = CONFIG_DEFINITION_BY_KEY.get(key)
    if definition is None:
        raise ValueError(f"未知配置项: {key}")

    if definition.input_type == "boolean":
        if isinstance(value, bool):
            return "true" if value else "false"
        normalized_bool = str(value).strip().lower()
        if normalized_bool in {"1", "true", "yes", "on"}:
            return "true"
        if normalized_bool in {"0", "false", "no", "off"}:
            return "false"
        raise ValueError(f"{definition.label} 必须是布尔值")

    if definition.input_type == "multi_select":
        return normalize_config_multi_select(key, value)

    if definition.input_type == "number":
        if definition.optional and (value is None or str(value).strip() == ""):
            return ""
        try:
            normalized_int = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{definition.label} 必须是整数") from exc
        if definition.minimum is not None and normalized_int < definition.minimum:
            raise ValueError(f"{definition.label} 不能小于 {definition.minimum}")
        if definition.maximum is not None and normalized_int > definition.maximum:
            raise ValueError(f"{definition.label} 不能大于 {definition.maximum}")
        return str(normalized_int)

    if key in IMAGE_SIZE_CONFIG_KEYS:
        return normalize_image_generation_size(value, label=definition.label)
    normalized = "" if value is None else str(value).strip()
    if key in PROMPT_CONFIG_KEYS and not normalized:
        raise ValueError(f"{definition.label} 不能为空；如需回到默认值请使用恢复默认")
    if definition.input_type == "select":
        allowed_values = {option.value for option in definition.options}
        if normalized not in allowed_values:
            allowed_text = ", ".join(sorted(allowed_values))
            raise ValueError(f"{definition.label} 必须是以下之一: {allowed_text}")
    if key in LOGIN_PAGE_TEMPLATE_ID_BY_CONFIG_KEY:
        return normalize_login_page_template_config_by_key(key, value)
    if key == "login_page_image_lab_hero_image_asset_id" and len(normalized) > 64:
        raise ValueError("登录页资源库图片 ID 不能超过 64 个字符")
    return normalized


def normalize_config_values(values: Mapping[str, Any]) -> dict[str, str]:
    return {key: normalize_config_value(key, value) for key, value in values.items()}


def build_settings_with_overrides(overrides: Mapping[str, str]) -> Settings:
    try:
        return Settings(**dict(overrides))
    except ValidationError as exc:
        first_error = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(part) for part in first_error.get("loc", []))
        message = first_error.get("msg") or str(exc)
        raise ValueError(f"配置校验失败 {field}: {message}") from exc


def _load_database_config_overrides() -> dict[str, str]:
    try:
        from inspiration_one_backend.infrastructure.db.models import AppSetting
        from inspiration_one_backend.infrastructure.db.session import get_session_factory

        session = get_session_factory()()
        try:
            rows = session.scalars(
                select(AppSetting).where(AppSetting.key.in_(RUNTIME_CONFIG_KEYS | LEGACY_RUNTIME_CONFIG_KEYS))
            ).all()
            row_values = {row.key: row.value for row in rows}
            overrides = {
                key: value
                for key, value in migrate_legacy_login_page_config_values(row_values).items()
                if key in RUNTIME_CONFIG_KEYS
            }
            legacy_capacity = next(
                (row.value for row in rows if row.key == LEGACY_GENERATION_MAX_CONCURRENT_TASKS_KEY),
                None,
            )
            if legacy_capacity is not None:
                overrides.setdefault(TEXT_GENERATION_MAX_CONCURRENT_TASKS_KEY, legacy_capacity)
                overrides.setdefault(IMAGE_GENERATION_MAX_CONCURRENT_TASKS_KEY, legacy_capacity)
            return overrides
        finally:
            session.close()
    except Exception as exc:  # noqa: BLE001
        if exc.__class__.__name__ in {"OperationalError", "ProgrammingError"}:
            return {}
        if isinstance(exc, SQLAlchemyError):
            return {}
        raise


def get_runtime_settings() -> Settings:
    """Settings with database overrides applied.

    If a key does not exist in the database, env/default Settings remains the
    fallback. Missing app_settings table is tolerated so fresh databases can
    still start before migrations have run.
    """

    overrides = _load_database_config_overrides()
    if not overrides:
        return get_settings()
    return build_settings_with_overrides(overrides)
