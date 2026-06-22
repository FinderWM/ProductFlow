"""配置导出序列化。

从 `routes/settings.py` 抽出，集中「DB 模型 → 导出文档」的序列化与导出文档构建逻辑。
`settings.py` 仅 import `_build_settings_export_document`（导出端点使用）；本模块不反向依赖 settings.py，
协议常量统一来自 `settings_constants`，避免循环导入。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend import __version__
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import (
    CONFIG_DEFINITIONS,
    get_runtime_settings,
    parse_config_multi_select,
)
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplate as DbCanvasTemplate,
)
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplateCategory as DbCanvasTemplateCategory,
)
from inspiration_one_backend.infrastructure.db.models import (
    GenerationConfig,
    GenerationResourceGroup,
    ProviderProfile,
)
from inspiration_one_backend.infrastructure.provider_config import (
    ensure_provider_config_bootstrapped,
    generation_config_resource_group_ids,
    list_generation_configs,
    list_generation_resource_groups,
)
from inspiration_one_backend.presentation.routes.settings_constants import (
    SETTINGS_EXPORT_COMPATIBILITY,
    SETTINGS_EXPORT_SCHEMA_VERSION,
)
from inspiration_one_backend.presentation.schemas.settings import (
    SettingsCanvasTemplateCategoryExport,
    SettingsCanvasTemplateExport,
    SettingsExportDocument,
    SettingsExportMetadataResponse,
    SettingsGenerationConfigExport,
    SettingsGenerationResourceGroupExport,
    SettingsProviderProfileExport,
)


def _export_config_value(key: str, value: Any, *, input_type: str) -> str | int | bool | list[str] | None:
    if isinstance(value, Path):
        return str(value)
    if input_type == "multi_select":
        return list(parse_config_multi_select(key, value))
    return value


def _serialize_canvas_template_category_export(
    category: DbCanvasTemplateCategory,
) -> SettingsCanvasTemplateCategoryExport:
    return SettingsCanvasTemplateCategoryExport(
        id=category.id,
        scope=category.scope,
        owner_user_id=category.owner_user_id,
        name=category.name,
        sort_order=category.sort_order,
        enabled=category.enabled,
        disabled_reason=category.disabled_reason,
    )


def _serialize_canvas_template_export(template: DbCanvasTemplate) -> SettingsCanvasTemplateExport:
    return SettingsCanvasTemplateExport(
        id=template.id,
        key=template.key,
        scope=template.scope,
        owner_user_id=template.owner_user_id,
        category_id=template.category_id,
        title=template.title,
        description=template.description,
        kind=template.kind,
        entry_mode=template.entry_mode,
        sort_order=template.sort_order,
        schema_version=template.schema_version,
        template_json=dict(template.template_json or {}),
        enabled=template.enabled,
        disabled_reason=template.disabled_reason,
        review_status=template.review_status,
        review_note=template.review_note,
    )


def _settings_generation_resource_group_export(group: GenerationResourceGroup) -> SettingsGenerationResourceGroupExport:
    return SettingsGenerationResourceGroupExport(
        id=group.id,
        key=group.key,
        name=group.name,
        description=group.description,
        sort_order=group.sort_order,
        enabled=group.enabled,
        blur_images_by_default=group.blur_images_by_default,
    )


def _settings_generation_config_export(generation_config: GenerationConfig) -> SettingsGenerationConfigExport:
    resource_group_ids = generation_config_resource_group_ids(generation_config)
    return SettingsGenerationConfigExport(
        id=generation_config.id,
        resource_group_id=resource_group_ids[0] if resource_group_ids else None,
        resource_group_ids=resource_group_ids,
        name=generation_config.name,
        purpose=generation_config.purpose,
        provider_kind=generation_config.provider_kind,
        provider_profile_id=generation_config.provider_profile_id,
        model_settings=dict(generation_config.model_settings_json or {}),
        config=dict(generation_config.config_json or {}),
        priority=generation_config.priority,
        max_concurrency=generation_config.max_concurrency,
        enabled=generation_config.enabled,
        availability_window_minutes=generation_config.availability_window_minutes,
        failure_threshold=generation_config.failure_threshold,
        cooldown_minutes=generation_config.cooldown_minutes,
    )


def _build_settings_export_document(session: Session) -> SettingsExportDocument:
    ensure_provider_config_bootstrapped(session)
    settings = get_runtime_settings()
    runtime_config = {
        definition.key: _export_config_value(
            definition.key,
            getattr(settings, definition.key),
            input_type=definition.input_type,
        )
        for definition in CONFIG_DEFINITIONS
    }
    profiles = session.scalars(
        select(ProviderProfile)
        .where(ProviderProfile.archived_at.is_(None))
        .order_by(ProviderProfile.created_at, ProviderProfile.name)
    ).all()
    generation_resource_groups = list_generation_resource_groups(session)
    generation_configs = list_generation_configs(session)
    template_categories = session.scalars(
        select(DbCanvasTemplateCategory)
        .where(DbCanvasTemplateCategory.archived_at.is_(None))
        .order_by(DbCanvasTemplateCategory.scope, DbCanvasTemplateCategory.sort_order, DbCanvasTemplateCategory.name)
    ).all()
    templates = session.scalars(
        select(DbCanvasTemplate)
        .where(DbCanvasTemplate.archived_at.is_(None))
        .order_by(
            DbCanvasTemplate.scope,
            DbCanvasTemplate.entry_mode,
            DbCanvasTemplate.sort_order,
            DbCanvasTemplate.title,
            DbCanvasTemplate.created_at,
        )
    ).all()
    return SettingsExportDocument(
        metadata=SettingsExportMetadataResponse(
            schema_version=SETTINGS_EXPORT_SCHEMA_VERSION,
            exported_at=now_utc(),
            app="Inspiration One",
            app_version=__version__,
            compatibility=SETTINGS_EXPORT_COMPATIBILITY,
        ),
        runtime_config=runtime_config,
        provider_profiles=[
            SettingsProviderProfileExport(
                id=profile.id,
                name=profile.name,
                provider_type=profile.provider_type,
                base_url=profile.base_url,
                api_key=profile.api_key,
                capabilities=list(profile.capabilities_json or []),
                default_models=dict(profile.default_models_json or {}),
                config=dict(profile.config_json or {}),
                enabled=profile.enabled,
            )
            for profile in profiles
        ],
        generation_resource_groups=[
            _settings_generation_resource_group_export(group) for group in generation_resource_groups
        ],
        generation_configs=[
            _settings_generation_config_export(generation_config) for generation_config in generation_configs
        ],
        canvas_template_categories=[
            _serialize_canvas_template_category_export(category) for category in template_categories
        ],
        canvas_templates=[_serialize_canvas_template_export(template) for template in templates],
    )
