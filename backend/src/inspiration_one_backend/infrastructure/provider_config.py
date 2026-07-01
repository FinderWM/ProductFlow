from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import case, or_, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.config import Settings, build_settings_with_overrides, get_runtime_settings
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
    AppSetting,
    GenerationConfig,
    GenerationConfigDailyStat,
    GenerationConfigResourceGroup,
    GenerationConfigState,
    GenerationResourceGroup,
    ProviderProfile,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.provider_config_constants import (
    CAPABILITY_IMAGE_CHAT,
    CAPABILITY_IMAGE_GOOGLE_GEMINI,
    CAPABILITY_IMAGE_IMAGES,
    CAPABILITY_IMAGE_RESPONSES,
    CAPABILITY_TEXT_CHAT_COMPLETIONS,
    CAPABILITY_TEXT_RESPONSES,
    DEFAULT_GENERATION_CONFIG_MAX_CONCURRENCY,
    DEFAULT_GENERATION_CONFIG_PRIORITY,
    DEFAULT_GENERATION_RESOURCE_GROUP_NAME,
    IMAGE_PROVIDER_KINDS,
    IMAGE_PURPOSE,
    LEGACY_PROVIDER_CONFIG_KEYS,
    PROVIDER_CAPABILITIES,
    PROVIDER_PURPOSES,
    PROVIDER_TYPE_GOOGLE_GEMINI,
    PROVIDER_TYPE_OPENAI_COMPATIBLE,
    PROVIDER_TYPES,
    REAL_IMAGE_PROVIDER_KINDS,
    RESOURCE_GROUP_KEY_RE,
    TEXT_PROVIDER_KINDS,
    TEXT_PURPOSE,
    TEXT_STRUCTURED_JSON_RESPONSE_FORMAT_ENABLED_KEY,
    TEXT_STRUCTURED_OUTPUT_ENABLED_KEY,
    TEXT_STRUCTURED_OUTPUT_KEY,
    TEXT_STRUCTURED_OUTPUT_MODE_JSON_OBJECT,
    TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA,
    TEXT_STRUCTURED_OUTPUT_MODE_KEY,
    TEXT_STRUCTURED_OUTPUT_MODES,
    UNSET_PROVIDER_FIELD,
)


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


@dataclass(frozen=True, slots=True)
class ProviderCapabilities:
    """Provider-specific capability constraints."""
    image_max_dimension: int | None = None


@dataclass(frozen=True, slots=True)
class TextStructuredOutputConfig:
    enabled: bool = False
    mode: Literal["json_object", "json_schema"] = TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA


@dataclass(frozen=True, slots=True)
class ResolvedTextProviderConfig:
    provider_kind: Literal["mock", "openai", "openai_chat_completions"]
    brief_model: str
    copy_model: str
    provider_profile_id: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    structured_output: TextStructuredOutputConfig = field(default_factory=TextStructuredOutputConfig)
    generation_config_id: str | None = None
    generation_config_name: str | None = None

    @property
    def structured_json_response_format_enabled(self) -> bool:
        return self.structured_output.enabled


@dataclass(frozen=True, slots=True)
class ResolvedImageProviderConfig:
    provider_kind: Literal["mock", "openai_responses", "openai_images", "openai_chat_image", "google_gemini_image"]
    model: str
    provider_profile_id: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    images_quality: str | None = None
    images_style: str | None = None
    responses_background_enabled: bool = False
    gemini_api_version: str = "v1beta"
    gemini_output_mime_type: str | None = None
    generation_config_id: str | None = None
    generation_config_name: str | None = None


@dataclass(frozen=True, slots=True)
class GenerationConfigClaim:
    generation_config_id: str
    resource_group_id: str
    purpose: str
    provider_kind: str
    score: float


@dataclass(frozen=True, slots=True)
class GenerationConfigStatusSummary:
    total_count: int
    enabled_count: int
    frozen_count: int
    running_count: int
    start_date: date
    end_date: date
    range_attempt_count: int
    range_success_count: int
    range_failure_count: int
    range_text_attempt_count: int
    range_image_attempt_count: int
    today_attempt_count: int
    today_success_count: int
    today_failure_count: int
    today_text_attempt_count: int
    today_image_attempt_count: int


def get_provider_capabilities(provider_profile: ProviderProfile | None) -> ProviderCapabilities:
    """Extract provider capabilities from profile config_json.

    Args:
        provider_profile: The provider profile, or None for mock providers.

    Returns:
        ProviderCapabilities instance with parsed values.
    """
    if provider_profile is None:
        return ProviderCapabilities()

    capabilities_dict = provider_profile.config_json.get("capabilities", {})
    return ProviderCapabilities(
        image_max_dimension=capabilities_dict.get("image_max_dimension")
    )


def resolve_effective_max_dimension(provider_profile: ProviderProfile | None, global_max: int) -> int:
    """Resolve the effective maximum dimension for image generation.

    Args:
        provider_profile: The provider profile, or None for mock providers.
        global_max: The global maximum dimension from runtime config.

    Returns:
        The minimum of provider max (or global if unset) and global max.
    """
    caps = get_provider_capabilities(provider_profile)
    provider_max = caps.image_max_dimension
    return min(provider_max or global_max, global_max)


def parse_image_size_dimensions(size: str) -> tuple[int, int]:
    """Parse normalized image size string into (width, height) tuple.

    Args:
        size: Normalized size string like "1024x768".

    Returns:
        Tuple of (width, height).

    Raises:
        ValueError: If the size string format is invalid.
    """
    parts = size.split("x")
    if len(parts) != 2:
        raise ValueError(f"Invalid image size format: {size}")
    try:
        width = int(parts[0])
        height = int(parts[1])
        return (width, height)
    except ValueError as e:
        raise ValueError(f"Invalid image size dimensions: {size}") from e


def enforce_generation_config_resolution(
    width: int,
    height: int,
    generation_config: GenerationConfig,
    provider_profile: ProviderProfile | None,
    global_max: int,
) -> None:
    """Validate that requested resolution does not exceed provider/global limits.

    Args:
        width: Requested image width.
        height: Requested image height.
        generation_config: The generation config being used.
        provider_profile: The provider profile, or None for mock.
        global_max: The global maximum dimension from runtime config.

    Raises:
        ValueError: If the requested resolution exceeds limits.
    """
    effective_max = resolve_effective_max_dimension(provider_profile, global_max)
    requested_max = max(width, height)

    if requested_max > effective_max:
        if provider_profile is not None:
            msg = f"供应商 {provider_profile.name} 最大分辨率限制为 {effective_max}，请求 {requested_max} 超限"
        else:
            msg = f"全局最大分辨率限制为 {global_max}，请求 {requested_max} 超限"
        raise ValueError(msg)


def ensure_provider_config_bootstrapped(session: Session | None = None, *, commit: bool = True) -> None:
    """Create generation configs from legacy settings/bindings once.

    Provider profiles remain the connection layer. `generation_configs` is the
    runtime source for text/image provider selection.
    """

    if session is None:
        owned_session = get_session_factory()()
        try:
            ensure_provider_config_bootstrapped(owned_session, commit=commit)
        finally:
            owned_session.close()
        return

    _ensure_default_generation_resource_group(session)
    if _generation_config_exists(session):
        _ensure_generation_config_resource_group_links(session)
        _ensure_generation_config_states(session)
        if commit:
            session.commit()
        else:
            session.flush()
        return

    settings = _load_effective_legacy_settings(session)
    profiles_by_connection: dict[tuple[str, str], ProviderProfile] = {}
    default_group_id = default_generation_resource_group_id(session)

    text_kind = _normalize_provider_kind(settings.text_provider_kind, allowed=TEXT_PROVIDER_KINDS, default="mock")
    image_kind = _normalize_provider_kind(settings.image_provider_kind, allowed=IMAGE_PROVIDER_KINDS, default="mock")

    if text_kind in {"openai", "openai_chat_completions"}:
        text_profile = _profile_for_legacy_connection(
            session,
            profiles_by_connection,
            base_url=settings.text_base_url,
            api_key=settings.text_api_key,
            capability=_capability_for_kind(text_kind),
        )
        add_generation_config(
            session,
            resource_group_id=default_group_id,
            name="默认文案配置",
            purpose=TEXT_PURPOSE,
            provider_kind=text_kind,
            provider_profile_id=text_profile.id,
            model_settings={
                "brief_model": settings.text_brief_model,
                "copy_model": settings.text_copy_model,
            },
            config={},
            commit=False,
        )
    else:
        add_generation_config(
            session,
            resource_group_id=default_group_id,
            name="默认文案配置",
            purpose=TEXT_PURPOSE,
            provider_kind="mock",
            provider_profile_id=None,
            model_settings={
                "brief_model": settings.text_brief_model,
                "copy_model": settings.text_copy_model,
            },
            config={},
            commit=False,
        )

    if image_kind in {"openai_responses", "openai_images", "openai_chat_image"}:
        image_capability = _capability_for_kind(image_kind)
        image_profile = _profile_for_legacy_connection(
            session,
            profiles_by_connection,
            base_url=settings.image_base_url,
            api_key=settings.image_api_key,
            capability=image_capability,
        )
        add_generation_config(
            session,
            resource_group_id=default_group_id,
            name="默认图片配置",
            purpose=IMAGE_PURPOSE,
            provider_kind=image_kind,
            provider_profile_id=image_profile.id,
            model_settings={"model": settings.image_generate_model},
            config={
                "images_quality": settings.image_images_quality,
                "images_style": settings.image_images_style,
                "responses_background_enabled": settings.image_responses_background_enabled,
            },
            commit=False,
        )
    else:
        add_generation_config(
            session,
            resource_group_id=default_group_id,
            name="默认图片配置",
            purpose=IMAGE_PURPOSE,
            provider_kind="mock",
            provider_profile_id=None,
            model_settings={"model": settings.image_generate_model},
            config={},
            commit=False,
        )

    if commit:
        session.commit()
    else:
        session.flush()


def list_provider_profiles(session: Session) -> list[ProviderProfile]:
    ensure_provider_config_bootstrapped(session)
    return list(
        session.scalars(
            select(ProviderProfile)
            .where(ProviderProfile.archived_at.is_(None))
            .order_by(
                ProviderProfile.created_at,
                ProviderProfile.name,
            )
        ).all()
    )


def list_generation_configs(session: Session) -> list[GenerationConfig]:
    ensure_provider_config_bootstrapped(session)
    return list(
        session.scalars(
            select(GenerationConfig)
            .options(
                selectinload(GenerationConfig.provider_profile),
                selectinload(GenerationConfig.resource_group),
                selectinload(GenerationConfig.resource_group_links),
                selectinload(GenerationConfig.state),
            )
            .where(GenerationConfig.archived_at.is_(None))
            .order_by(
                GenerationConfig.resource_group_id,
                GenerationConfig.purpose,
                GenerationConfig.priority.desc(),
                GenerationConfig.created_at,
            )
        ).all()
    )


def list_generation_resource_groups(
    session: Session,
    *,
    include_archived: bool = False,
) -> list[GenerationResourceGroup]:
    ensure_provider_config_bootstrapped(session)
    statement = select(GenerationResourceGroup).order_by(
        GenerationResourceGroup.sort_order.desc(),
        GenerationResourceGroup.created_at,
        GenerationResourceGroup.name,
    )
    if not include_archived:
        statement = statement.where(GenerationResourceGroup.archived_at.is_(None))
    return list(session.scalars(statement).all())


def add_generation_resource_group(
    session: Session,
    *,
    key: str,
    name: str,
    description: str | None = None,
    sort_order: int = 100,
    enabled: bool = True,
    blur_images_by_default: bool = False,
    commit: bool = True,
) -> GenerationResourceGroup:
    _ensure_default_generation_resource_group(session)
    normalized_key = _normalize_resource_group_key(key)
    if session.scalar(select(GenerationResourceGroup.id).where(GenerationResourceGroup.key == normalized_key)):
        raise ValueError("分组 key 已存在")
    group = GenerationResourceGroup(
        key=normalized_key,
        name=_normalize_required_text(name, "分组名称"),
        description=_normalize_optional_text(description),
        sort_order=int(sort_order),
        enabled=enabled,
        blur_images_by_default=blur_images_by_default,
    )
    session.add(group)
    if commit:
        session.commit()
        session.refresh(group)
    else:
        session.flush()
    return group


def update_generation_resource_group(
    session: Session,
    resource_group_id: str,
    *,
    key: str | None = None,
    name: str | None = None,
    description: str | None | object = UNSET_PROVIDER_FIELD,
    sort_order: int | None = None,
    enabled: bool | None = None,
    blur_images_by_default: bool | None = None,
    commit: bool = True,
) -> GenerationResourceGroup:
    group = require_generation_resource_group(session, resource_group_id)
    if key is not None:
        normalized_key = _normalize_resource_group_key(key)
        existing_id = session.scalar(
            select(GenerationResourceGroup.id).where(
                GenerationResourceGroup.key == normalized_key,
                GenerationResourceGroup.id != group.id,
            )
        )
        if existing_id is not None:
            raise ValueError("分组 key 已存在")
        group.key = normalized_key
    if name is not None:
        group.name = _normalize_required_text(name, "分组名称")
    if description is not UNSET_PROVIDER_FIELD:
        group.description = _normalize_optional_text(description if isinstance(description, str) else None)
    if sort_order is not None:
        group.sort_order = int(sort_order)
    if enabled is not None:
        group.enabled = enabled
    if blur_images_by_default is not None:
        group.blur_images_by_default = blur_images_by_default
    if commit:
        session.commit()
        session.refresh(group)
    else:
        session.flush()
    return group


def archive_generation_resource_group(session: Session, resource_group_id: str) -> GenerationResourceGroup:
    group = require_generation_resource_group(session, resource_group_id)
    active_config_id = session.scalar(
        select(GenerationConfigResourceGroup.generation_config_id)
        .join(
            GenerationConfig,
            GenerationConfig.id == GenerationConfigResourceGroup.generation_config_id,
        )
        .where(
            GenerationConfigResourceGroup.resource_group_id == group.id,
            GenerationConfig.archived_at.is_(None),
        )
    )
    if active_config_id is not None:
        raise ValueError("分组仍有生成配置使用，不能归档")
    group.archived_at = datetime.now(UTC)
    group.enabled = False
    session.commit()
    session.refresh(group)
    return group


def require_generation_resource_group(
    session: Session,
    resource_group_id: str | None,
    *,
    require_enabled: bool = False,
) -> GenerationResourceGroup:
    group_id = _normalize_resource_group_id(resource_group_id)
    if group_id is None or group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID:
        group = _ensure_default_generation_resource_group(session)
    else:
        group = session.get(GenerationResourceGroup, group_id)
    if group is None or group.archived_at is not None:
        raise ValueError("供应商生成分组不存在")
    if require_enabled and not group.enabled:
        raise ValueError("供应商生成分组已停用")
    return group


def default_generation_resource_group_id(session: Session) -> str:
    return _ensure_default_generation_resource_group(session).id


def create_provider_profile(
    session: Session,
    *,
    name: str,
    base_url: str | None,
    api_key: str | None,
    capabilities: list[str],
    provider_type: str = PROVIDER_TYPE_OPENAI_COMPATIBLE,
    default_models: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    enabled: bool = True,
) -> ProviderProfile:
    provider_type = _normalize_provider_type(provider_type)
    normalized_capabilities = _dedupe_ordered(capabilities)
    _validate_capabilities_for_provider_type(normalized_capabilities, provider_type=provider_type)
    normalized_base_url = _normalize_optional_text(base_url)
    _validate_provider_profile_connection(provider_type=provider_type, base_url=normalized_base_url)
    normalized_name = _normalize_required_text(name, "供应商名称")
    profile = ProviderProfile(
        name=normalized_name,
        provider_type=provider_type,
        base_url=normalized_base_url,
        api_key=_normalize_optional_text(api_key),
        capabilities_json=normalized_capabilities,
        default_models_json=default_models or {},
        config_json=config or {},
        enabled=enabled,
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


def update_provider_profile(
    session: Session,
    profile_id: str,
    *,
    name: str | None = None,
    provider_type: str | None = None,
    base_url: str | None | object = UNSET_PROVIDER_FIELD,
    api_key: str | None | object = UNSET_PROVIDER_FIELD,
    capabilities: list[str] | None = None,
    default_models: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    enabled: bool | None = None,
) -> ProviderProfile:
    profile = session.get(ProviderProfile, profile_id)
    if profile is None or profile.archived_at is not None:
        raise ValueError("供应商不存在")
    next_provider_type = _normalize_provider_type(provider_type) if provider_type is not None else profile.provider_type
    next_base_url = profile.base_url
    next_capabilities = list(profile.capabilities_json or [])
    if name is not None:
        profile.name = _normalize_required_text(name, "供应商名称")
    if base_url is not UNSET_PROVIDER_FIELD:
        next_base_url = _normalize_optional_text(base_url if isinstance(base_url, str) else None)
    if api_key is not UNSET_PROVIDER_FIELD:
        normalized_api_key = _normalize_optional_text(api_key if isinstance(api_key, str) else None)
        if normalized_api_key is not None:
            profile.api_key = normalized_api_key
    if capabilities is not None:
        next_capabilities = _dedupe_ordered(capabilities)
    _validate_capabilities_for_provider_type(next_capabilities, provider_type=next_provider_type)
    _validate_provider_profile_connection(provider_type=next_provider_type, base_url=next_base_url)
    if provider_type is not None or capabilities is not None:
        _validate_profile_update_keeps_active_configs(
            session,
            profile,
            capabilities=next_capabilities,
            enabled=enabled,
        )
    elif enabled is not None:
        _validate_profile_update_keeps_active_configs(session, profile, capabilities=None, enabled=enabled)
    profile.provider_type = next_provider_type
    profile.base_url = next_base_url
    profile.capabilities_json = next_capabilities
    if default_models is not None:
        profile.default_models_json = default_models
    if config is not None:
        profile.config_json = config
    if enabled is not None:
        profile.enabled = enabled
    session.commit()
    session.refresh(profile)
    return profile


def archive_provider_profile(session: Session, profile_id: str) -> ProviderProfile:
    profile = session.get(ProviderProfile, profile_id)
    if profile is None or profile.archived_at is not None:
        raise ValueError("供应商不存在")
    active_configs = session.scalars(
        select(GenerationConfig).where(
            GenerationConfig.provider_profile_id == profile_id,
            GenerationConfig.archived_at.is_(None),
        )
    ).all()
    if active_configs:
        raise ValueError("供应商仍被文案或图片配置使用，不能归档")
    profile.archived_at = datetime.now(UTC)
    profile.enabled = False
    session.commit()
    session.refresh(profile)
    return profile


def add_generation_config(
    session: Session,
    *,
    generation_config_id: str | None = None,
    resource_group_id: str | None = None,
    resource_group_ids: list[str] | None = None,
    name: str,
    purpose: str,
    provider_kind: str,
    provider_profile_id: str | None,
    model_settings: dict[str, Any],
    config: dict[str, Any],
    priority: int = DEFAULT_GENERATION_CONFIG_PRIORITY,
    max_concurrency: int = DEFAULT_GENERATION_CONFIG_MAX_CONCURRENCY,
    enabled: bool = True,
    availability_window_minutes: int | None = None,
    failure_threshold: int | None = None,
    cooldown_minutes: int | None = None,
    commit: bool = True,
) -> GenerationConfig:
    _validate_generation_config_payload(
        session,
        purpose=purpose,
        provider_kind=provider_kind,
        provider_profile_id=provider_profile_id,
        model_settings=model_settings,
        config=config,
        max_concurrency=max_concurrency,
        availability_window_minutes=availability_window_minutes,
        failure_threshold=failure_threshold,
        cooldown_minutes=cooldown_minutes,
    )
    if provider_kind == "mock":
        provider_profile_id = None
    normalized_resource_group_ids = _normalize_generation_config_resource_group_ids(
        session,
        resource_group_ids=resource_group_ids,
        resource_group_id=resource_group_id,
    )
    settings = get_runtime_settings()
    generation_config_kwargs = {
        "name": _normalize_required_text(name, "配置名称"),
        "purpose": purpose,
        "provider_kind": provider_kind,
        "provider_profile_id": provider_profile_id,
        "resource_group_id": _compat_resource_group_id(normalized_resource_group_ids),
        "model_settings_json": _normalize_binding_model_settings(purpose=purpose, model_settings=model_settings),
        "config_json": _normalize_binding_config(purpose=purpose, provider_kind=provider_kind, config=config),
        "priority": int(priority),
        "max_concurrency": int(max_concurrency),
        "enabled": enabled,
        "availability_window_minutes": int(
            availability_window_minutes or settings.generation_config_default_availability_window_minutes
        ),
        "failure_threshold": int(failure_threshold or settings.generation_config_default_failure_threshold),
        "cooldown_minutes": int(cooldown_minutes or settings.generation_config_default_cooldown_minutes),
    }
    if generation_config_id is not None:
        generation_config_kwargs["id"] = generation_config_id
    generation_config = GenerationConfig(**generation_config_kwargs)
    session.add(generation_config)
    session.flush()
    _sync_generation_config_resource_groups(session, generation_config, normalized_resource_group_ids)
    _ensure_generation_config_state(session, generation_config.id)
    if commit:
        session.commit()
        session.refresh(generation_config)
    else:
        session.flush()
    return generation_config


def update_generation_config(
    session: Session,
    generation_config_id: str,
    *,
    resource_group_id: str | None | object = UNSET_PROVIDER_FIELD,
    resource_group_ids: list[str] | None | object = UNSET_PROVIDER_FIELD,
    name: str | None = None,
    purpose: str | None = None,
    provider_kind: str | None = None,
    provider_profile_id: str | None | object = UNSET_PROVIDER_FIELD,
    model_settings: dict[str, Any] | None = None,
    config: dict[str, Any] | None = None,
    priority: int | None = None,
    max_concurrency: int | None = None,
    enabled: bool | None = None,
    availability_window_minutes: int | None = None,
    failure_threshold: int | None = None,
    cooldown_minutes: int | None = None,
    commit: bool = True,
) -> GenerationConfig:
    generation_config = _require_generation_config(session, generation_config_id)
    next_purpose = purpose or generation_config.purpose
    next_provider_kind = provider_kind or generation_config.provider_kind
    next_provider_profile_id = (
        generation_config.provider_profile_id if provider_profile_id is UNSET_PROVIDER_FIELD else provider_profile_id
    )
    next_model_settings = model_settings if model_settings is not None else dict(generation_config.model_settings_json)
    next_config = config if config is not None else dict(generation_config.config_json)
    next_max_concurrency = int(max_concurrency or generation_config.max_concurrency)
    next_availability_window = int(availability_window_minutes or generation_config.availability_window_minutes)
    next_failure_threshold = int(failure_threshold or generation_config.failure_threshold)
    next_cooldown = int(cooldown_minutes or generation_config.cooldown_minutes)
    if resource_group_ids is not UNSET_PROVIDER_FIELD:
        next_resource_group_ids = _normalize_generation_config_resource_group_ids(
            session,
            resource_group_ids=resource_group_ids if isinstance(resource_group_ids, list) else [],
            resource_group_id=None,
        )
    elif resource_group_id is UNSET_PROVIDER_FIELD:
        next_resource_group_ids = generation_config_resource_group_ids(generation_config)
    else:
        next_resource_group_ids = _normalize_generation_config_resource_group_ids(
            session,
            resource_group_ids=None,
            resource_group_id=resource_group_id if isinstance(resource_group_id, str) else None,
        )
    _validate_generation_config_payload(
        session,
        purpose=next_purpose,
        provider_kind=next_provider_kind,
        provider_profile_id=next_provider_profile_id if isinstance(next_provider_profile_id, str) else None,
        model_settings=next_model_settings,
        config=next_config,
        max_concurrency=next_max_concurrency,
        availability_window_minutes=next_availability_window,
        failure_threshold=next_failure_threshold,
        cooldown_minutes=next_cooldown,
    )
    if name is not None:
        generation_config.name = _normalize_required_text(name, "配置名称")
    generation_config.resource_group_id = _compat_resource_group_id(next_resource_group_ids)
    generation_config.purpose = next_purpose
    generation_config.provider_kind = next_provider_kind
    generation_config.provider_profile_id = None if next_provider_kind == "mock" else next_provider_profile_id
    generation_config.model_settings_json = _normalize_binding_model_settings(
        purpose=next_purpose,
        model_settings=next_model_settings,
    )
    generation_config.config_json = _normalize_binding_config(
        purpose=next_purpose,
        provider_kind=next_provider_kind,
        config=next_config,
    )
    if priority is not None:
        generation_config.priority = int(priority)
    generation_config.max_concurrency = next_max_concurrency
    if enabled is not None:
        generation_config.enabled = enabled
    generation_config.availability_window_minutes = next_availability_window
    generation_config.failure_threshold = next_failure_threshold
    generation_config.cooldown_minutes = next_cooldown
    _sync_generation_config_resource_groups(session, generation_config, next_resource_group_ids)
    _ensure_generation_config_state(session, generation_config.id)
    if commit:
        session.commit()
        session.refresh(generation_config)
    else:
        session.flush()
    return generation_config


def archive_generation_config(session: Session, generation_config_id: str) -> GenerationConfig:
    generation_config = _require_generation_config(session, generation_config_id)
    generation_config.archived_at = datetime.now(UTC)
    generation_config.enabled = False
    session.commit()
    session.refresh(generation_config)
    return generation_config


def capability_for_provider_kind(provider_kind: str) -> str:
    return _capability_for_kind(provider_kind)


def is_real_image_provider_kind(provider_kind: str | None) -> bool:
    return provider_kind in REAL_IMAGE_PROVIDER_KINDS


def validate_provider_capabilities(capabilities: list[str]) -> None:
    _validate_capabilities(capabilities)


def validate_provider_profile_contract(
    *,
    provider_type: str,
    capabilities: list[str],
    base_url: str | None,
) -> None:
    normalized_provider_type = _normalize_provider_type(provider_type)
    _validate_capabilities_for_provider_type(capabilities, provider_type=normalized_provider_type)
    _validate_provider_profile_connection(provider_type=normalized_provider_type, base_url=base_url)


def normalize_provider_binding_runtime_config(
    *,
    purpose: str,
    provider_kind: str,
    model_settings: dict[str, Any],
    config: dict[str, Any],
) -> dict[str, Any]:
    _validate_binding_runtime_config(
        purpose=purpose,
        provider_kind=provider_kind,
        model_settings=model_settings,
        config=config,
    )
    return _normalize_binding_config(purpose=purpose, provider_kind=provider_kind, config=config)


def normalize_provider_binding_model_settings(*, purpose: str, model_settings: dict[str, Any]) -> dict[str, Any]:
    return _normalize_binding_model_settings(purpose=purpose, model_settings=model_settings)


def resolve_text_provider_config(
    generation_config_id: str | None = None,
    *,
    session: Session | None = None,
) -> ResolvedTextProviderConfig:
    if session is not None:
        ensure_provider_config_bootstrapped(session, commit=False)
        generation_config = _select_generation_config_for_resolution(
            session,
            purpose=TEXT_PURPOSE,
            generation_config_id=generation_config_id,
        )
        return _resolved_text_provider_config_from_generation_config(generation_config)

    owned_session = get_session_factory()()
    try:
        return resolve_text_provider_config(generation_config_id=generation_config_id, session=owned_session)
    finally:
        owned_session.close()


def resolve_text_provider_config_from_draft(
    session: Session,
    *,
    name: str,
    provider_kind: str,
    provider_profile_id: str | None,
    model_settings: dict[str, Any],
    config: dict[str, Any],
) -> ResolvedTextProviderConfig:
    """Resolve an unsaved text generation config without creating scheduler rows."""

    normalized_model_settings = _normalize_binding_model_settings(
        purpose=TEXT_PURPOSE,
        model_settings=model_settings,
    )
    normalized_config = _normalize_binding_config(
        purpose=TEXT_PURPOSE,
        provider_kind=provider_kind,
        config=config,
    )
    _validate_binding_payload(
        session,
        purpose=TEXT_PURPOSE,
        provider_kind=provider_kind,
        provider_profile_id=provider_profile_id,
        model_settings=normalized_model_settings,
        config=normalized_config,
    )
    if provider_kind == "mock":
        return ResolvedTextProviderConfig(
            provider_kind="mock",
            brief_model=_require_text_value(
                normalized_model_settings,
                "brief_model",
                "文案灵感产物理解模型未配置",
            ),
            copy_model=_require_text_value(
                normalized_model_settings,
                "copy_model",
                "文案生成模型未配置",
            ),
            generation_config_name=name,
        )
    if provider_kind not in {"openai", "openai_chat_completions"}:
        raise RuntimeError(f"暂不支持的文案 provider: {provider_kind}")
    profile = session.get(ProviderProfile, provider_profile_id) if provider_profile_id else None
    if profile is None or profile.archived_at is not None:
        raise RuntimeError("供应商不存在")
    return ResolvedTextProviderConfig(
        provider_kind=provider_kind,  # type: ignore[arg-type]
        brief_model=_require_text_value(
            normalized_model_settings,
            "brief_model",
            "文案灵感产物理解模型未配置",
            fallback_values=profile.default_models_json,
        ),
        copy_model=_require_text_value(
            normalized_model_settings,
            "copy_model",
            "文案生成模型未配置",
            fallback_values=profile.default_models_json,
        ),
        provider_profile_id=profile.id,
        api_key=profile.api_key,
        base_url=profile.base_url,
        structured_output=_text_structured_output_config(
            normalized_config,
            provider_kind=provider_kind,
        ),
        generation_config_name=name,
    )


def resolve_image_provider_config_from_draft(
    session: Session,
    *,
    name: str,
    provider_kind: str,
    provider_profile_id: str | None,
    model_settings: dict[str, Any],
    config: dict[str, Any],
    generation_config_id: str | None = None,
) -> ResolvedImageProviderConfig:
    """Resolve an unsaved image generation config without creating scheduler rows."""

    normalized_model_settings = _normalize_binding_model_settings(
        purpose=IMAGE_PURPOSE,
        model_settings=model_settings,
    )
    normalized_config = _normalize_binding_config(
        purpose=IMAGE_PURPOSE,
        provider_kind=provider_kind,
        config=config,
    )
    _validate_binding_payload(
        session,
        purpose=IMAGE_PURPOSE,
        provider_kind=provider_kind,
        provider_profile_id=provider_profile_id,
        model_settings=normalized_model_settings,
        config=normalized_config,
    )
    if provider_kind == "mock":
        return ResolvedImageProviderConfig(
            provider_kind="mock",
            model=_require_text_value(normalized_model_settings, "model", "图片模型未配置"),
            generation_config_id=generation_config_id,
            generation_config_name=name,
        )
    if provider_kind not in {"openai_responses", "openai_images", "openai_chat_image", "google_gemini_image"}:
        raise RuntimeError(f"暂不支持的图片 provider: {provider_kind}")
    profile = session.get(ProviderProfile, provider_profile_id) if provider_profile_id else None
    if profile is None or profile.archived_at is not None:
        raise RuntimeError("供应商不存在")
    return ResolvedImageProviderConfig(
        provider_kind=provider_kind,  # type: ignore[arg-type]
        model=_require_text_value(
            normalized_model_settings,
            "model",
            "图片模型未配置",
            fallback_values=profile.default_models_json,
            fallback_key="image_model",
        ),
        provider_profile_id=profile.id,
        api_key=profile.api_key,
        base_url=profile.base_url,
        images_quality=(
            _optional_str(normalized_config.get("images_quality")) if provider_kind == "openai_images" else None
        ),
        images_style=(
            _optional_str(normalized_config.get("images_style")) if provider_kind == "openai_images" else None
        ),
        responses_background_enabled=(
            _require_bool_value(
                normalized_config,
                "responses_background_enabled",
                "图片 Responses 后台响应模式未配置",
            )
            if provider_kind == "openai_responses"
            else False
        ),
        gemini_api_version=(
            (_optional_str(normalized_config.get("gemini_api_version")) or "v1beta")
            if provider_kind == "google_gemini_image"
            else "v1beta"
        ),
        gemini_output_mime_type=(
            _optional_str(normalized_config.get("gemini_output_mime_type"))
            if provider_kind == "google_gemini_image"
            else None
        ),
        generation_config_id=generation_config_id,
        generation_config_name=name,
    )


def resolve_image_provider_config(
    generation_config_id: str | None = None,
    *,
    session: Session | None = None,
) -> ResolvedImageProviderConfig:
    if session is not None:
        ensure_provider_config_bootstrapped(session, commit=False)
        generation_config = _select_generation_config_for_resolution(
            session,
            purpose=IMAGE_PURPOSE,
            generation_config_id=generation_config_id,
        )
        return _resolved_image_provider_config_from_generation_config(generation_config)

    owned_session = get_session_factory()()
    try:
        return resolve_image_provider_config(generation_config_id=generation_config_id, session=owned_session)
    finally:
        owned_session.close()


def claim_generation_config(
    session: Session,
    *,
    purpose: str,
    resource_group_id: str | None = None,
    generation_config_id: str | None = None,
    required_max_dimension: int | None = None,
    now: datetime | None = None,
) -> GenerationConfigClaim | None:
    ensure_provider_config_bootstrapped(session, commit=False)
    resolved_now = now or datetime.now(UTC)
    resource_group = require_generation_resource_group(session, resource_group_id, require_enabled=True)

    # Get global max dimension for resolution filtering
    runtime_settings = get_runtime_settings(session)
    global_max = runtime_settings.image_generation_max_dimension

    candidates = _candidate_generation_configs(
        session,
        purpose=purpose,
        resource_group_id=resource_group.id,
        generation_config_id=generation_config_id,
        required_max_dimension=required_max_dimension,
        global_max=global_max,
        now=resolved_now,
    )
    for generation_config, score in candidates:
        updated = session.execute(
            update(GenerationConfigState)
            .where(
                GenerationConfigState.generation_config_id == generation_config.id,
                GenerationConfigState.current_concurrency < generation_config.max_concurrency,
                or_(
                    GenerationConfigState.frozen_until.is_(None),
                    GenerationConfigState.frozen_until <= resolved_now,
                ),
            )
            .values(
                current_concurrency=GenerationConfigState.current_concurrency + 1,
                last_used_at=resolved_now,
            )
        )
        if updated.rowcount:
            session.flush()
            return GenerationConfigClaim(
                generation_config_id=generation_config.id,
                resource_group_id=resource_group.id,
                purpose=generation_config.purpose,
                provider_kind=generation_config.provider_kind,
                score=score,
            )
    return None


def release_generation_config_claim(
    session: Session,
    generation_config_id: str,
    *,
    success: bool,
    latency_ms: int = 0,
    generated_unit_count: int = 1,
    failure_reason: str | None = None,
    timeout: bool = False,
    throttled: bool = False,
    record_result: bool = True,
    now: datetime | None = None,
) -> None:
    resolved_now = now or datetime.now(UTC)
    _ensure_generation_config_state(session, generation_config_id)
    session.execute(
        update(GenerationConfigState)
        .where(GenerationConfigState.generation_config_id == generation_config_id)
        .values(
            current_concurrency=case(
                (
                    GenerationConfigState.current_concurrency > 0,
                    GenerationConfigState.current_concurrency - 1,
                ),
                else_=0,
            )
        )
    )
    if not record_result:
        session.flush()
        return
    _record_generation_config_result(
        session,
        generation_config_id,
        success=success,
        latency_ms=latency_ms,
        generated_unit_count=generated_unit_count,
        failure_reason=failure_reason,
        timeout=timeout,
        throttled=throttled,
        now=resolved_now,
    )


def reconcile_generation_config_concurrency(session: Session | None = None) -> int:
    """启动时把所有生成配置的 current_concurrency 归零，解除硬杀导致的并发计数泄漏。

    current_concurrency 仅在 worker 持有 claim 期间有意义（claim +1 / release -1）。进程被
    SIGKILL/OOM 杀于 claim 与 release 之间会泄漏计数且不自愈；max_concurrency 默认 1 时，一次
    泄漏即让该配置永久 `current_concurrency < max_concurrency` 不成立而停止调度。
    真实总并发由全局运行中任务数上限（pg_advisory_xact_lock + 运行计数）兜底，因此启动归零即便
    短暂多算单个配置的并发也不会突破全局上限。假设：生成 worker 与应用进程同生命周期重启
    （单实例自托管部署）。
    """
    if session is None:
        owned_session = get_session_factory()()
        try:
            reset_count = reconcile_generation_config_concurrency(owned_session)
            owned_session.commit()
            return reset_count
        finally:
            owned_session.close()
    result = session.execute(
        update(GenerationConfigState)
        .where(GenerationConfigState.current_concurrency != 0)
        .values(current_concurrency=0)
    )
    return int(result.rowcount or 0)


def unfreeze_generation_config(
    session: Session,
    generation_config_id: str,
    *,
    commit: bool = True,
) -> GenerationConfig:
    generation_config = _require_generation_config(session, generation_config_id)
    state = _ensure_generation_config_state(session, generation_config_id)
    state.frozen_until = None
    state.failure_window_started_at = None
    state.failure_count_in_window = 0
    if commit:
        session.commit()
        session.refresh(generation_config)
    else:
        session.flush()
    return generation_config


def record_generation_config_result(
    session: Session,
    generation_config_id: str,
    *,
    success: bool,
    latency_ms: int = 0,
    generated_unit_count: int = 1,
    failure_reason: str | None = None,
    timeout: bool = False,
    throttled: bool = False,
    now: datetime | None = None,
) -> None:
    _record_generation_config_result(
        session,
        generation_config_id,
        success=success,
        latency_ms=latency_ms,
        generated_unit_count=generated_unit_count,
        failure_reason=failure_reason,
        timeout=timeout,
        throttled=throttled,
        now=now or datetime.now(UTC),
    )


def generation_config_status_summary(
    session: Session,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
) -> GenerationConfigStatusSummary:
    ensure_provider_config_bootstrapped(session)
    now = datetime.now(UTC)
    today = _local_stat_date(now)
    range_start = start_date or end_date or today
    range_end = end_date or range_start
    configs = list(
        session.scalars(
            select(GenerationConfig)
            .options(selectinload(GenerationConfig.state))
            .where(GenerationConfig.archived_at.is_(None))
        ).all()
    )
    config_purposes = {item.id: item.purpose for item in configs}
    today_stats = list(
        session.scalars(select(GenerationConfigDailyStat).where(GenerationConfigDailyStat.stat_date == today)).all()
    )
    range_stats = list(
        session.scalars(
            select(GenerationConfigDailyStat).where(
                GenerationConfigDailyStat.stat_date >= range_start,
                GenerationConfigDailyStat.stat_date <= range_end,
            )
        ).all()
    )
    return GenerationConfigStatusSummary(
        total_count=len(configs),
        enabled_count=sum(1 for item in configs if item.enabled),
        frozen_count=sum(
            1
            for item in configs
            if item.state is not None and item.state.frozen_until and _as_aware_utc(item.state.frozen_until) > now
        ),
        running_count=sum(item.state.current_concurrency for item in configs if item.state is not None),
        start_date=range_start,
        end_date=range_end,
        range_attempt_count=sum(item.attempt_count for item in range_stats),
        range_success_count=sum(item.success_count for item in range_stats),
        range_failure_count=sum(item.failure_count for item in range_stats),
        range_text_attempt_count=sum(
            item.attempt_count for item in range_stats if config_purposes.get(item.generation_config_id) == TEXT_PURPOSE
        ),
        range_image_attempt_count=sum(
            item.attempt_count
            for item in range_stats
            if config_purposes.get(item.generation_config_id) == IMAGE_PURPOSE
        ),
        today_attempt_count=sum(item.attempt_count for item in today_stats),
        today_success_count=sum(item.success_count for item in today_stats),
        today_failure_count=sum(item.failure_count for item in today_stats),
        today_text_attempt_count=sum(
            item.attempt_count for item in today_stats if config_purposes.get(item.generation_config_id) == TEXT_PURPOSE
        ),
        today_image_attempt_count=sum(
            item.attempt_count
            for item in today_stats
            if config_purposes.get(item.generation_config_id) == IMAGE_PURPOSE
        ),
    )


def _resolved_text_provider_config_from_generation_config(
    generation_config: GenerationConfig,
) -> ResolvedTextProviderConfig:
    kind = generation_config.provider_kind
    if kind == "mock":
        return ResolvedTextProviderConfig(
            provider_kind="mock",
            brief_model=_require_text_value(
                generation_config.model_settings_json,
                "brief_model",
                "文案灵感产物理解模型未配置",
            ),
            copy_model=_require_text_value(
                generation_config.model_settings_json,
                "copy_model",
                "文案生成模型未配置",
            ),
            generation_config_id=generation_config.id,
            generation_config_name=generation_config.name,
        )
    if kind not in {"openai", "openai_chat_completions"}:
        raise RuntimeError(f"暂不支持的文案 provider: {kind}")
    profile = _require_active_profile_for_config(generation_config)
    _require_capability(profile, _capability_for_kind(kind))
    return ResolvedTextProviderConfig(
        provider_kind=kind,  # type: ignore[arg-type]
        brief_model=_require_text_value(
            generation_config.model_settings_json,
            "brief_model",
            "文案灵感产物理解模型未配置",
            fallback_values=profile.default_models_json,
        ),
        copy_model=_require_text_value(
            generation_config.model_settings_json,
            "copy_model",
            "文案生成模型未配置",
            fallback_values=profile.default_models_json,
        ),
        provider_profile_id=profile.id,
        api_key=profile.api_key,
        base_url=profile.base_url,
        structured_output=_text_structured_output_config(
            dict(generation_config.config_json or {}),
            provider_kind=kind,
        ),
        generation_config_id=generation_config.id,
        generation_config_name=generation_config.name,
    )


def _resolved_image_provider_config_from_generation_config(
    generation_config: GenerationConfig,
) -> ResolvedImageProviderConfig:
    kind = generation_config.provider_kind
    if kind == "mock":
        return ResolvedImageProviderConfig(
            provider_kind="mock",
            model=_require_text_value(generation_config.model_settings_json, "model", "图片模型未配置"),
            generation_config_id=generation_config.id,
            generation_config_name=generation_config.name,
        )
    if kind not in {"openai_responses", "openai_images", "openai_chat_image", "google_gemini_image"}:
        raise RuntimeError(f"暂不支持的图片 provider: {kind}")
    profile = _require_active_profile_for_config(generation_config)
    _require_capability(profile, _capability_for_kind(kind))
    return ResolvedImageProviderConfig(
        provider_kind=kind,  # type: ignore[arg-type]
        model=_require_text_value(
            generation_config.model_settings_json,
            "model",
            "图片模型未配置",
            fallback_values=profile.default_models_json,
            fallback_key="image_model",
        ),
        provider_profile_id=profile.id,
        api_key=profile.api_key,
        base_url=profile.base_url,
        images_quality=(
            _optional_str(generation_config.config_json.get("images_quality")) if kind == "openai_images" else None
        ),
        images_style=(
            _optional_str(generation_config.config_json.get("images_style")) if kind == "openai_images" else None
        ),
        responses_background_enabled=(
            _require_bool_value(
                generation_config.config_json,
                "responses_background_enabled",
                "图片 Responses 后台响应模式未配置",
            )
            if kind == "openai_responses"
            else False
        ),
        gemini_api_version=(
            (_optional_str(generation_config.config_json.get("gemini_api_version")) or "v1beta")
            if kind == "google_gemini_image"
            else "v1beta"
        ),
        gemini_output_mime_type=(
            _optional_str(generation_config.config_json.get("gemini_output_mime_type"))
            if kind == "google_gemini_image"
            else None
        ),
        generation_config_id=generation_config.id,
        generation_config_name=generation_config.name,
    )


def _generation_config_exists(session: Session) -> bool:
    return bool(session.scalar(select(GenerationConfig.id).limit(1)))


def _provider_config_exists(session: Session) -> bool:
    return bool(
        session.scalar(select(ProviderProfile.id).limit(1))
        or session.scalar(select(GenerationConfig.id).limit(1))
    )


def _load_effective_legacy_settings(session: Session) -> Settings:
    rows = session.scalars(select(AppSetting).where(AppSetting.key.in_(LEGACY_PROVIDER_CONFIG_KEYS))).all()
    overrides = {row.key: row.value for row in rows}
    return build_settings_with_overrides(overrides)


def _profile_for_legacy_connection(
    session: Session,
    profiles_by_connection: dict[tuple[str, str], ProviderProfile],
    *,
    base_url: str | None,
    api_key: str | None,
    capability: str,
) -> ProviderProfile:
    key = (_normalize_optional_text(base_url) or "", _normalize_optional_text(api_key) or "")
    profile = profiles_by_connection.get(key)
    if profile is None:
        profile = ProviderProfile(
            name=f"OpenAI 兼容供应商 {len(profiles_by_connection) + 1}",
            provider_type=PROVIDER_TYPE_OPENAI_COMPATIBLE,
            base_url=key[0] or None,
            api_key=key[1] or None,
            capabilities_json=[capability],
            default_models_json={},
            config_json={},
            enabled=True,
        )
        session.add(profile)
        session.flush()
        profiles_by_connection[key] = profile
    else:
        profile.capabilities_json = _dedupe_ordered([*profile.capabilities_json, capability])
    return profile


def _default_generation_config(
    session: Session,
    purpose: str,
    *,
    resource_group_id: str | None = None,
    include_disabled: bool = False,
) -> GenerationConfig | None:
    resolved_resource_group_id = _normalize_resource_group_id(resource_group_id)
    statement = (
        select(GenerationConfig)
        .options(
            selectinload(GenerationConfig.provider_profile),
            selectinload(GenerationConfig.resource_group),
            selectinload(GenerationConfig.resource_group_links),
            selectinload(GenerationConfig.state),
        )
        .where(GenerationConfig.purpose == purpose, GenerationConfig.archived_at.is_(None))
        .order_by(GenerationConfig.priority.desc(), GenerationConfig.created_at)
    )
    if resolved_resource_group_id is not None:
        statement = statement.join(
            GenerationConfigResourceGroup,
            GenerationConfigResourceGroup.generation_config_id == GenerationConfig.id,
        ).where(GenerationConfigResourceGroup.resource_group_id == resolved_resource_group_id)
    if not include_disabled:
        statement = statement.where(GenerationConfig.enabled.is_(True))
    for generation_config in session.scalars(statement).all():
        if include_disabled or generation_config_effective_enabled(generation_config):
            return generation_config
    return None


def generation_config_effective_enabled(generation_config: GenerationConfig) -> bool:
    if not generation_config.enabled:
        return False
    if generation_config.provider_kind == "mock":
        return True
    profile = generation_config.provider_profile
    return bool(profile is not None and profile.enabled and profile.archived_at is None)


def _select_generation_config_for_resolution(
    session: Session,
    *,
    purpose: str,
    generation_config_id: str | None,
) -> GenerationConfig:
    if generation_config_id:
        generation_config = session.scalar(
            select(GenerationConfig)
            .options(
                selectinload(GenerationConfig.provider_profile),
                selectinload(GenerationConfig.resource_group),
                selectinload(GenerationConfig.resource_group_links),
                selectinload(GenerationConfig.state),
            )
            .where(
                GenerationConfig.id == generation_config_id,
                GenerationConfig.purpose == purpose,
                GenerationConfig.archived_at.is_(None),
            )
        )
    else:
        generation_config = _default_generation_config(
            session,
            purpose,
            resource_group_id=default_generation_resource_group_id(session),
        )
    if generation_config is None:
        raise RuntimeError("生成配置未初始化")
    if not generation_config.enabled:
        raise RuntimeError("生成配置已停用")
    if not generation_config_effective_enabled(generation_config):
        raise RuntimeError("生成配置供应商不可用")
    return generation_config


def _require_generation_config(session: Session, generation_config_id: str) -> GenerationConfig:
    generation_config = session.get(GenerationConfig, generation_config_id)
    if generation_config is None or generation_config.archived_at is not None:
        raise ValueError("生成配置不存在")
    return generation_config


def _require_active_profile_for_config(generation_config: GenerationConfig) -> ProviderProfile:
    profile = generation_config.provider_profile
    if profile is None:
        raise RuntimeError("真实供应商配置缺少供应商档案")
    if not profile.enabled or profile.archived_at is not None:
        raise RuntimeError("供应商已停用或已归档")
    return profile


def _ensure_generation_config_states(session: Session) -> None:
    config_ids = list(session.scalars(select(GenerationConfig.id)).all())
    for config_id in config_ids:
        _ensure_generation_config_state(session, config_id)


def _ensure_generation_config_resource_group_links(session: Session) -> None:
    configs = list(
        session.scalars(
            select(GenerationConfig).options(selectinload(GenerationConfig.resource_group_links))
        ).all()
    )
    for generation_config in configs:
        if generation_config.resource_group_links:
            continue
        if generation_config.resource_group_id:
            _sync_generation_config_resource_groups(session, generation_config, [generation_config.resource_group_id])


def _ensure_default_generation_resource_group(session: Session) -> GenerationResourceGroup:
    group = session.get(GenerationResourceGroup, DEFAULT_GENERATION_RESOURCE_GROUP_ID)
    if group is None:
        group = session.scalar(
            select(GenerationResourceGroup).where(
                GenerationResourceGroup.key == DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
            )
        )
    if group is None:
        group = GenerationResourceGroup(
            id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            key=DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
            name=DEFAULT_GENERATION_RESOURCE_GROUP_NAME,
            description="default 供应商生成能力分组",
            sort_order=0,
            enabled=True,
            blur_images_by_default=False,
        )
        session.add(group)
        session.flush()
        return group
    group.name = DEFAULT_GENERATION_RESOURCE_GROUP_NAME if group.name in {"", "默认分组"} else group.name
    if group.description == "系统内置默认供应商生成能力分组":
        group.description = "default 供应商生成能力分组"
    session.flush()
    return group


def _ensure_generation_config_state(session: Session, generation_config_id: str) -> GenerationConfigState:
    exists = session.scalar(select(GenerationConfig.id).where(GenerationConfig.id == generation_config_id))
    if exists is None:
        raise ValueError("生成配置不存在")
    state = session.get(GenerationConfigState, generation_config_id)
    if state is None:
        state = GenerationConfigState(generation_config_id=generation_config_id)
        session.add(state)
        session.flush()
    return state


def generation_config_resource_group_ids(generation_config: GenerationConfig) -> list[str]:
    links = list(generation_config.resource_group_links or [])
    if links:
        linked_ids = _dedupe_ordered([link.resource_group_id for link in links if link.resource_group_id])
        if generation_config.resource_group_id in linked_ids:
            remaining_ids = [
                resource_group_id
                for resource_group_id in linked_ids
                if resource_group_id != generation_config.resource_group_id
            ]
            return [generation_config.resource_group_id, *remaining_ids]
        return linked_ids
    if generation_config.resource_group_id:
        return [generation_config.resource_group_id]
    return []


def _normalize_generation_config_resource_group_ids(
    session: Session,
    *,
    resource_group_ids: list[str] | None,
    resource_group_id: str | None,
) -> list[str]:
    raw_ids = (
        resource_group_ids
        if resource_group_ids is not None
        else ([resource_group_id] if resource_group_id else [])
    )
    normalized_ids = _dedupe_ordered(
        [
            normalized_id
            for value in raw_ids
            if (normalized_id := _normalize_resource_group_id(value)) is not None
        ]
    )
    for normalized_id in normalized_ids:
        require_generation_resource_group(session, normalized_id)
    return normalized_ids


def _compat_resource_group_id(resource_group_ids: list[str]) -> str | None:
    return resource_group_ids[0] if resource_group_ids else None


def _sync_generation_config_resource_groups(
    session: Session,
    generation_config: GenerationConfig,
    resource_group_ids: list[str],
) -> None:
    existing_links = {
        link.resource_group_id: link
        for link in session.scalars(
            select(GenerationConfigResourceGroup).where(
                GenerationConfigResourceGroup.generation_config_id == generation_config.id
            )
        ).all()
    }
    desired_ids = set(resource_group_ids)
    for resource_group_id, link in existing_links.items():
        if resource_group_id not in desired_ids:
            session.delete(link)
    for resource_group_id in resource_group_ids:
        if resource_group_id not in existing_links:
            session.add(
                GenerationConfigResourceGroup(
                    generation_config_id=generation_config.id,
                    resource_group_id=resource_group_id,
                )
            )
    generation_config.resource_group_id = _compat_resource_group_id(resource_group_ids)
    session.flush()


def _validate_generation_config_payload(
    session: Session,
    *,
    purpose: str,
    provider_kind: str,
    provider_profile_id: str | None,
    model_settings: dict[str, Any],
    config: dict[str, Any],
    max_concurrency: int,
    availability_window_minutes: int | None,
    failure_threshold: int | None,
    cooldown_minutes: int | None,
) -> None:
    if max_concurrency < 1:
        raise ValueError("单配置并发数必须大于 0")
    for value, label in (
        (availability_window_minutes, "可用性窗口"),
        (failure_threshold, "失败阈值"),
        (cooldown_minutes, "冷冻时长"),
    ):
        if value is not None and int(value) < 1:
            raise ValueError(f"{label}必须大于 0")
    _validate_binding_payload(
        session,
        purpose=purpose,
        provider_kind=provider_kind,
        provider_profile_id=provider_profile_id,
        model_settings=model_settings,
        config=config,
    )


def _validate_binding_payload(
    session: Session,
    *,
    purpose: str,
    provider_kind: str,
    provider_profile_id: str | None,
    model_settings: dict[str, Any],
    config: dict[str, Any],
) -> None:
    if purpose not in PROVIDER_PURPOSES:
        raise ValueError("用途必须是 text 或 image")
    allowed_kinds = TEXT_PROVIDER_KINDS if purpose == TEXT_PURPOSE else IMAGE_PROVIDER_KINDS
    if provider_kind not in allowed_kinds:
        raise ValueError("供应商接口类型不支持当前用途")
    _validate_binding_runtime_config(
        purpose=purpose,
        provider_kind=provider_kind,
        model_settings=model_settings,
        config=config,
    )
    if provider_kind == "mock":
        return
    if not provider_profile_id:
        raise ValueError("真实供应商必须选择供应商档案")
    profile = session.get(ProviderProfile, provider_profile_id)
    if profile is None or profile.archived_at is not None:
        raise ValueError("供应商不存在")
    if not profile.enabled:
        raise ValueError("供应商已停用")
    capability = _capability_for_kind(provider_kind)
    _require_capability(profile, capability, exc_type=ValueError)
    _validate_profile_type_supports_capability(profile.provider_type, capability)


def _validate_profile_update_keeps_active_configs(
    session: Session,
    profile: ProviderProfile,
    *,
    capabilities: list[str] | None,
    enabled: bool | None,
) -> None:
    active_configs = list(
        session.scalars(
            select(GenerationConfig).where(
                GenerationConfig.provider_profile_id == profile.id,
                GenerationConfig.archived_at.is_(None),
            )
        ).all()
    )
    if not active_configs:
        return
    if capabilities is None:
        return
    capability_set = set(capabilities)
    for generation_config in active_configs:
        if generation_config.provider_kind == "mock":
            continue
        required_capability = _capability_for_kind(generation_config.provider_kind)
        if required_capability not in capability_set:
            raise ValueError("供应商仍被文案或图片配置使用，不能移除当前接口能力")


def _candidate_generation_configs(
    session: Session,
    *,
    purpose: str,
    resource_group_id: str,
    generation_config_id: str | None,
    required_max_dimension: int | None,
    global_max: int,
    now: datetime,
) -> list[tuple[GenerationConfig, float]]:
    if purpose not in PROVIDER_PURPOSES:
        raise ValueError("用途必须是 text 或 image")
    statement = (
        select(GenerationConfig)
        .join(
            GenerationConfigResourceGroup,
            GenerationConfigResourceGroup.generation_config_id == GenerationConfig.id,
        )
        .options(
            selectinload(GenerationConfig.provider_profile),
            selectinload(GenerationConfig.resource_group),
            selectinload(GenerationConfig.resource_group_links),
            selectinload(GenerationConfig.state),
        )
        .where(
            GenerationConfig.purpose == purpose,
            GenerationConfigResourceGroup.resource_group_id == resource_group_id,
            GenerationConfig.archived_at.is_(None),
        )
    )
    if generation_config_id:
        statement = statement.where(GenerationConfig.id == generation_config_id)
    else:
        statement = statement.where(GenerationConfig.enabled.is_(True))
    configs = list(session.scalars(statement).all())
    today_stats_by_config = _today_stats_by_config(session, [config.id for config in configs], now=now)
    candidates: list[tuple[GenerationConfig, float]] = []
    for generation_config in configs:
        if not _generation_config_candidate_available(generation_config, now=now, manual=bool(generation_config_id)):
            continue

        # Filter by required_max_dimension if specified
        if required_max_dimension is not None:
            effective_max = resolve_effective_max_dimension(generation_config.provider_profile, global_max)
            if effective_max < required_max_dimension:
                continue

        score = _generation_config_score(generation_config, stat=today_stats_by_config.get(generation_config.id))
        candidates.append((generation_config, score))
    candidates.sort(key=lambda item: (item[1], item[0].priority, item[0].created_at), reverse=True)
    return candidates


def _generation_config_candidate_available(
    generation_config: GenerationConfig,
    *,
    now: datetime,
    manual: bool,
) -> bool:
    if not generation_config.enabled:
        if manual:
            raise ValueError("手动指定的生成配置已停用")
        return False
    if not generation_config_effective_enabled(generation_config):
        if manual:
            raise ValueError("手动指定的生成配置供应商不可用")
        return False
    state = generation_config.state
    if state is None:
        return True
    if state.frozen_until and _as_aware_utc(state.frozen_until) > now:
        return False
    return int(state.current_concurrency or 0) < generation_config.max_concurrency


def _today_stats_by_config(
    session: Session,
    generation_config_ids: list[str],
    *,
    now: datetime,
) -> dict[str, GenerationConfigDailyStat]:
    """一次性预取当日生成统计，避免打分阶段对每个候选各发 2 次日表查询。"""

    if not generation_config_ids:
        return {}
    today = _local_stat_date(now)
    return {
        stat.generation_config_id: stat
        for stat in session.scalars(
            select(GenerationConfigDailyStat).where(
                GenerationConfigDailyStat.generation_config_id.in_(generation_config_ids),
                GenerationConfigDailyStat.stat_date == today,
            )
        ).all()
    }


def _generation_config_score(
    generation_config: GenerationConfig,
    *,
    stat: GenerationConfigDailyStat | None,
) -> float:
    state = generation_config.state
    capacity_score = 1.0
    if state is not None:
        capacity_score = max(
            0.0,
            (generation_config.max_concurrency - int(state.current_concurrency or 0))
            / max(1, generation_config.max_concurrency),
        )
    availability_score = _recent_availability_score(stat)
    latency_score = _latency_score(stat)
    priority_score = max(0.0, min(1.0, generation_config.priority / 100.0))
    return priority_score * 0.5 + availability_score * 0.3 + capacity_score * 0.15 + latency_score * 0.05


def _recent_availability_score(stat: GenerationConfigDailyStat | None) -> float:
    if stat is None:
        return 0.95
    # Laplace smoothing keeps new/low-volume configs schedulable.
    return (stat.success_count + 2) / max(1, stat.success_count + stat.failure_count + 4)


def _latency_score(stat: GenerationConfigDailyStat | None) -> float:
    if stat is None or stat.success_count <= 0:
        return 0.8
    average_ms = stat.total_latency_ms / max(1, stat.success_count)
    if average_ms <= 0:
        return 0.8
    return max(0.05, min(1.0, 30_000 / average_ms))


def _record_generation_config_result(
    session: Session,
    generation_config_id: str,
    *,
    success: bool,
    latency_ms: int,
    generated_unit_count: int,
    failure_reason: str | None,
    timeout: bool,
    throttled: bool,
    now: datetime,
) -> None:
    generation_config = _require_generation_config(session, generation_config_id)
    state = _ensure_generation_config_state(session, generation_config_id)
    stat = _today_stat(session, generation_config_id, now=now)
    stat.attempt_count += 1
    stat.generated_unit_count += max(0, int(generated_unit_count or 0))
    stat.total_latency_ms += max(0, int(latency_ms or 0))
    if success:
        stat.success_count += 1
        stat.last_success_at = now
        state.last_success_at = now
        state.failure_count_in_window = 0
        state.failure_window_started_at = None
        state.last_failure_reason = None
        return

    stat.failure_count += 1
    if timeout:
        stat.timeout_count += 1
    if throttled:
        stat.throttled_count += 1
    stat.last_failure_at = now
    state.last_failure_at = now
    state.last_failure_reason = failure_reason
    _update_failure_window(session, generation_config, state, stat, now=now)


def _today_stat(session: Session, generation_config_id: str, *, now: datetime) -> GenerationConfigDailyStat:
    stat_date = _local_stat_date(now)
    stat = session.scalar(
        select(GenerationConfigDailyStat).where(
            GenerationConfigDailyStat.generation_config_id == generation_config_id,
            GenerationConfigDailyStat.stat_date == stat_date,
        )
    )
    if stat is None:
        stat = GenerationConfigDailyStat(generation_config_id=generation_config_id, stat_date=stat_date)
        session.add(stat)
        session.flush()
    return stat


def _update_failure_window(
    session: Session,
    generation_config: GenerationConfig,
    state: GenerationConfigState,
    stat: GenerationConfigDailyStat,
    *,
    now: datetime,
) -> None:
    window_started_at = (
        _as_aware_utc(state.failure_window_started_at) if state.failure_window_started_at is not None else None
    )
    window_minutes = max(1, generation_config.availability_window_minutes)
    if window_started_at is None or window_started_at + timedelta(minutes=window_minutes) < now:
        state.failure_window_started_at = now
        state.failure_count_in_window = 1
    else:
        state.failure_count_in_window = int(state.failure_count_in_window or 0) + 1
    if state.failure_count_in_window >= max(1, generation_config.failure_threshold):
        state.frozen_until = now + timedelta(minutes=max(1, generation_config.cooldown_minutes))
        state.failure_window_started_at = None
        state.failure_count_in_window = 0
        stat.freeze_count += 1
    session.flush()


def _local_stat_date(value: datetime) -> date:
    if value.tzinfo is None:
        return value.astimezone().date()
    return value.astimezone().date()


def _capability_for_kind(provider_kind: str) -> str:
    if provider_kind == "openai":
        return CAPABILITY_TEXT_RESPONSES
    if provider_kind == "openai_chat_completions":
        return CAPABILITY_TEXT_CHAT_COMPLETIONS
    if provider_kind == "openai_responses":
        return CAPABILITY_IMAGE_RESPONSES
    if provider_kind == "openai_images":
        return CAPABILITY_IMAGE_IMAGES
    if provider_kind == "openai_chat_image":
        return CAPABILITY_IMAGE_CHAT
    if provider_kind == "google_gemini_image":
        return CAPABILITY_IMAGE_GOOGLE_GEMINI
    raise ValueError("供应商接口类型不支持真实供应商档案")


def _require_capability(
    profile: ProviderProfile,
    capability: str,
    *,
    exc_type: type[Exception] = RuntimeError,
) -> None:
    if capability not in set(profile.capabilities_json or []):
        raise exc_type("供应商档案不支持当前接口能力")


def _validate_binding_runtime_config(
    *,
    purpose: str,
    provider_kind: str,
    model_settings: dict[str, Any],
    config: dict[str, Any],
) -> None:
    if purpose == TEXT_PURPOSE:
        normalized_settings = _normalize_text_model_settings(model_settings)
        _require_text_value(normalized_settings, "brief_model", "文案灵感产物理解模型未配置", exc_type=ValueError)
        _require_text_value(normalized_settings, "copy_model", "文案生成模型未配置", exc_type=ValueError)
        return
    _require_text_value(model_settings, "model", "图片模型未配置", exc_type=ValueError)
    if provider_kind == "openai_responses":
        _require_bool_value(
            config,
            "responses_background_enabled",
            "图片 Responses 后台响应模式未配置",
            exc_type=ValueError,
        )
    if provider_kind == "google_gemini_image":
        gemini_api_version = _optional_str(config.get("gemini_api_version")) or "v1beta"
        if gemini_api_version not in {"v1", "v1beta"}:
            raise ValueError("Gemini API 版本必须是 v1 或 v1beta")


def _normalize_binding_model_settings(*, purpose: str, model_settings: dict[str, Any]) -> dict[str, Any]:
    if purpose == TEXT_PURPOSE:
        return _normalize_text_model_settings(model_settings)
    return {key: value for key, value in model_settings.items() if value is not None}


def _normalize_text_model_settings(model_settings: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key in ("brief_model", "copy_model"):
        value = _optional_str(model_settings.get(key))
        if value is not None:
            normalized[key] = value
    return normalized


def _normalize_binding_config(*, purpose: str, provider_kind: str, config: dict[str, Any]) -> dict[str, Any]:
    if purpose == TEXT_PURPOSE:
        if provider_kind in {"openai", "openai_chat_completions"}:
            return {TEXT_STRUCTURED_OUTPUT_KEY: _normalize_text_structured_output_dict(config)}
        return {}
    if purpose != IMAGE_PURPOSE:
        return {}
    if provider_kind == "openai_responses":
        return {
            "responses_background_enabled": _require_bool_value(
                config,
                "responses_background_enabled",
                "图片 Responses 后台响应模式未配置",
                exc_type=ValueError,
            )
        }
    if provider_kind == "openai_images":
        return {
            key: value
            for key, value in {
                "images_quality": _optional_str(config.get("images_quality")),
                "images_style": _optional_str(config.get("images_style")),
            }.items()
            if value is not None
        }
    if provider_kind == "google_gemini_image":
        gemini_api_version = _optional_str(config.get("gemini_api_version")) or "v1beta"
        if gemini_api_version not in {"v1", "v1beta"}:
            raise ValueError("Gemini API 版本必须是 v1 或 v1beta")
        return {
            key: value
            for key, value in {
                "gemini_api_version": gemini_api_version,
                "gemini_output_mime_type": _optional_str(config.get("gemini_output_mime_type")),
            }.items()
            if value is not None
        }
    return {}


def _text_structured_output_config(config: dict[str, Any], *, provider_kind: str) -> TextStructuredOutputConfig:
    if provider_kind not in {"openai", "openai_chat_completions"}:
        return TextStructuredOutputConfig()
    normalized = _normalize_text_structured_output_dict(config)
    mode = _optional_str(normalized.get(TEXT_STRUCTURED_OUTPUT_MODE_KEY)) or TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA
    if mode not in TEXT_STRUCTURED_OUTPUT_MODES:
        raise ValueError("文案结构化输出模式必须是 json_schema 或 json_object")
    return TextStructuredOutputConfig(
        enabled=_optional_bool(normalized.get(TEXT_STRUCTURED_OUTPUT_ENABLED_KEY), default=False),
        mode=mode,  # type: ignore[arg-type]
    )


def _normalize_text_structured_output_dict(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get(TEXT_STRUCTURED_OUTPUT_KEY)
    if raw is None:
        legacy_enabled = _optional_bool(
            config.get(TEXT_STRUCTURED_JSON_RESPONSE_FORMAT_ENABLED_KEY),
            default=False,
        )
        return {
            TEXT_STRUCTURED_OUTPUT_ENABLED_KEY: legacy_enabled,
            TEXT_STRUCTURED_OUTPUT_MODE_KEY: (
                TEXT_STRUCTURED_OUTPUT_MODE_JSON_OBJECT
                if legacy_enabled
                else TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA
            ),
        }
    if not isinstance(raw, dict):
        raise ValueError("文案结构化输出配置必须是对象")
    mode = _optional_str(raw.get(TEXT_STRUCTURED_OUTPUT_MODE_KEY)) or TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA
    if mode not in TEXT_STRUCTURED_OUTPUT_MODES:
        raise ValueError("文案结构化输出模式必须是 json_schema 或 json_object")
    return {
        TEXT_STRUCTURED_OUTPUT_ENABLED_KEY: _optional_bool(
            raw.get(TEXT_STRUCTURED_OUTPUT_ENABLED_KEY),
            default=False,
        ),
        TEXT_STRUCTURED_OUTPUT_MODE_KEY: mode,
    }


def _require_text_value(
    values: dict[str, Any],
    key: str,
    message: str,
    *,
    fallback_values: dict[str, Any] | None = None,
    fallback_key: str | None = None,
    exc_type: type[Exception] = RuntimeError,
) -> str:
    value = _optional_str(values.get(key))
    if value is None and fallback_values is not None:
        value = _optional_str(fallback_values.get(fallback_key or key))
    if value is None:
        raise exc_type(message)
    return value


def _require_bool_value(
    values: dict[str, Any],
    key: str,
    message: str,
    *,
    exc_type: type[Exception] = RuntimeError,
) -> bool:
    if key not in values or values.get(key) is None:
        raise exc_type(message)
    return _optional_bool(values.get(key), default=False)


def _validate_capabilities(capabilities: list[str]) -> None:
    if not capabilities:
        raise ValueError("供应商能力不能为空")
    unknown = set(capabilities) - PROVIDER_CAPABILITIES
    if unknown:
        raise ValueError(f"供应商能力不支持: {', '.join(sorted(unknown))}")


def _normalize_provider_type(provider_type: str) -> str:
    normalized = str(provider_type or "").strip()
    if normalized not in PROVIDER_TYPES:
        raise ValueError("供应商类型不支持")
    return normalized


def _validate_profile_type_supports_capability(provider_type: str, capability: str) -> None:
    if provider_type == PROVIDER_TYPE_GOOGLE_GEMINI:
        if capability != CAPABILITY_IMAGE_GOOGLE_GEMINI:
            raise ValueError("Google Gemini 供应商档案只支持 Gemini 图片能力")
        return
    if provider_type == PROVIDER_TYPE_OPENAI_COMPATIBLE:
        if capability == CAPABILITY_IMAGE_GOOGLE_GEMINI:
            raise ValueError("OpenAI 兼容供应商档案不支持 Gemini 图片能力")
        return
    raise ValueError("供应商类型不支持")


def _validate_capabilities_for_provider_type(capabilities: list[str], *, provider_type: str) -> None:
    _validate_capabilities(capabilities)
    for capability in capabilities:
        _validate_profile_type_supports_capability(provider_type, capability)


def _validate_provider_profile_connection(*, provider_type: str, base_url: str | None) -> None:
    if provider_type == PROVIDER_TYPE_GOOGLE_GEMINI and base_url:
        raise ValueError("Google Gemini 供应商暂不支持自定义 Base URL")


def _normalize_required_text(value: str, label: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{label}不能为空")
    return normalized


def _normalize_optional_text(value: str | None) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _normalize_resource_group_id(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value)
    return normalized


def _normalize_resource_group_key(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if not RESOURCE_GROUP_KEY_RE.fullmatch(normalized):
        raise ValueError("分组 key 只能包含小写字母、数字、下划线和连字符")
    return normalized


def _optional_str(value: Any) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _optional_bool(value: Any, *, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _normalize_provider_kind(value: str, *, allowed: set[str], default: str) -> str:
    normalized = str(value or default).strip()
    return normalized if normalized in allowed else default


def _dedupe_ordered(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def provider_config_tables_available() -> bool:
    try:
        session = get_session_factory()()
        try:
            session.scalar(select(GenerationConfig.id).limit(1))
            session.scalar(select(GenerationConfigResourceGroup.generation_config_id).limit(1))
            session.scalar(select(GenerationConfigState.generation_config_id).limit(1))
            session.scalar(select(GenerationConfigDailyStat.id).limit(1))
            return True
        finally:
            session.close()
    except SQLAlchemyError:
        return False
