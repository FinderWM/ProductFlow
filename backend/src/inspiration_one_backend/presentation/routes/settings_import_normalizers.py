"""配置导入的纯规范化函数。

从 `routes/settings.py` 抽出，集中导入文档 → 规范化字典的纯转换逻辑（无 Session/DB 副作用）。
`settings.py` 仍 import 这些函数使用；本模块只依赖 schema / provider_config / db 常量，
不反向依赖 settings.py，避免循环导入。
"""

from __future__ import annotations

from typing import Any

from inspiration_one_backend.application.canvas_templates import CanvasTemplate as CanvasTemplatePayload
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
)
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PROVIDER_KINDS,
    PROVIDER_PURPOSES,
    PROVIDER_TYPES,
    TEXT_PROVIDER_KINDS,
    capability_for_provider_kind,
    normalize_provider_binding_model_settings,
    normalize_provider_binding_runtime_config,
    validate_provider_capabilities,
    validate_provider_profile_contract,
)
from inspiration_one_backend.presentation.schemas.settings import (
    SettingsExportDocument,
    SettingsGenerationResourceGroupExport,
)


def _dedupe_ordered(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def _normalize_optional_text(value: str | None) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _normalize_import_generation_resource_groups(document: SettingsExportDocument) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_keys: set[str] = set()
    source_groups = document.generation_resource_groups or [
        SettingsGenerationResourceGroupExport(
            id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            key=DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
            name="default",
            description="default 供应商生成能力分组",
            sort_order=0,
            enabled=True,
            blur_images_by_default=False,
        )
    ]
    for group in source_groups:
        group_id = group.id.strip()
        key = group.key.strip().lower()
        name = group.name.strip()
        if not group_id:
            raise ValueError("生成分组 id 不能为空")
        if not key:
            raise ValueError("生成分组 key 不能为空")
        if not name:
            raise ValueError("生成分组名称不能为空")
        if group_id in seen_ids or key in seen_keys:
            raise ValueError("生成分组不能重复")
        seen_ids.add(group_id)
        seen_keys.add(key)
        groups.append(
            {
                "id": group_id,
                "key": key,
                "name": name,
                "description": _normalize_optional_text(group.description),
                "sort_order": group.sort_order,
                "enabled": group.enabled,
                "blur_images_by_default": group.blur_images_by_default,
            }
        )
    if DEFAULT_GENERATION_RESOURCE_GROUP_ID not in seen_ids and DEFAULT_GENERATION_RESOURCE_GROUP_KEY not in seen_keys:
        groups.insert(
            0,
            {
                "id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
                "key": DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
                "name": "default",
                "description": "default 供应商生成能力分组",
                "sort_order": 0,
                "enabled": True,
                "blur_images_by_default": False,
            },
        )
    return groups


def _normalize_import_profiles(document: SettingsExportDocument) -> list[dict[str, Any]]:
    seen_profile_ids: set[str] = set()
    profiles: list[dict[str, Any]] = []
    for profile in document.provider_profiles:
        if profile.id in seen_profile_ids:
            raise ValueError("供应商档案不能重复")
        seen_profile_ids.add(profile.id)
        if profile.provider_type not in PROVIDER_TYPES:
            raise ValueError("供应商类型不支持")
        capabilities = _dedupe_ordered([str(capability).strip() for capability in profile.capabilities])
        validate_provider_capabilities(capabilities)
        name = profile.name.strip()
        if not name:
            raise ValueError("供应商名称不能为空")
        base_url = _normalize_optional_text(profile.base_url)
        validate_provider_profile_contract(
            provider_type=profile.provider_type,
            capabilities=capabilities,
            base_url=base_url,
        )
        profiles.append(
            {
                "id": profile.id,
                "name": name,
                "provider_type": profile.provider_type,
                "base_url": base_url,
                "api_key": _normalize_optional_text(profile.api_key),
                "capabilities_json": capabilities,
                "default_models_json": dict(profile.default_models),
                "config_json": dict(profile.config),
                "enabled": profile.enabled,
            }
        )
    return profiles


def _normalize_import_generation_configs(
    document: SettingsExportDocument,
    profiles: list[dict[str, Any]],
    generation_resource_groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    resource_group_ids = {group["id"] for group in generation_resource_groups}
    fallback_resource_group_id = generation_resource_groups[0]["id"]
    profiles_by_id = {profile["id"]: profile for profile in profiles}
    seen_ids: set[str] = set()
    generation_configs: list[dict[str, Any]] = []
    for item in document.generation_configs:
        config_id = item.id.strip() if item.id else None
        if config_id is not None:
            if config_id in seen_ids:
                raise ValueError("生成配置不能重复")
            seen_ids.add(config_id)
        if item.purpose not in PROVIDER_PURPOSES:
            raise ValueError("用途必须是 text 或 image")
        allowed_kinds = TEXT_PROVIDER_KINDS if item.purpose == "text" else IMAGE_PROVIDER_KINDS
        if item.provider_kind not in allowed_kinds:
            raise ValueError("供应商接口类型不支持当前用途")
        normalized_config = normalize_provider_binding_runtime_config(
            purpose=item.purpose,
            provider_kind=item.provider_kind,
            model_settings=item.model_settings,
            config=item.config,
        )
        normalized_model_settings = normalize_provider_binding_model_settings(
            purpose=item.purpose,
            model_settings=item.model_settings,
        )
        provider_profile_id = item.provider_profile_id
        if "resource_group_ids" in item.model_fields_set and item.resource_group_ids is not None:
            item_resource_group_ids = _dedupe_ordered(
                [
                    resource_group_id.strip()
                    for resource_group_id in item.resource_group_ids
                    if resource_group_id.strip()
                ]
            )
        elif "resource_group_id" in item.model_fields_set:
            resource_group_id = item.resource_group_id.strip() if item.resource_group_id else None
            item_resource_group_ids = [resource_group_id] if resource_group_id is not None else []
        else:
            item_resource_group_ids = [fallback_resource_group_id]
        if any(resource_group_id not in resource_group_ids for resource_group_id in item_resource_group_ids):
            raise ValueError("生成配置引用的分组不存在")
        if item.provider_kind == "mock":
            provider_profile_id = None
        else:
            if not provider_profile_id:
                raise ValueError("真实供应商必须选择供应商档案")
            profile = profiles_by_id.get(provider_profile_id)
            if profile is None:
                raise ValueError("供应商不存在")
            if not profile["enabled"]:
                raise ValueError("供应商已停用")
            capability = capability_for_provider_kind(item.provider_kind)
            if capability not in set(profile["capabilities_json"]):
                raise ValueError("供应商档案不支持当前接口能力")
        generation_configs.append(
            {
                "id": config_id,
                "resource_group_id": item_resource_group_ids[0] if item_resource_group_ids else None,
                "resource_group_ids": item_resource_group_ids,
                "name": item.name.strip(),
                "purpose": item.purpose,
                "provider_kind": item.provider_kind,
                "provider_profile_id": provider_profile_id,
                "model_settings": normalized_model_settings,
                "config": normalized_config,
                "priority": item.priority,
                "max_concurrency": item.max_concurrency,
                "enabled": item.enabled,
                "availability_window_minutes": item.availability_window_minutes,
                "failure_threshold": item.failure_threshold,
                "cooldown_minutes": item.cooldown_minutes,
            }
        )
    if not any(item["purpose"] == "text" for item in generation_configs):
        raise ValueError("配置文件缺少文案生成配置")
    if not any(item["purpose"] == "image" for item in generation_configs):
        raise ValueError("配置文件缺少图片生成配置")
    return generation_configs


def _normalize_import_canvas_template_categories(document: SettingsExportDocument) -> list[dict[str, Any]]:
    seen_ids: set[str] = set()
    seen_global_names: set[str] = set()
    seen_user_names: set[tuple[str, str]] = set()
    categories: list[dict[str, Any]] = []
    for item in document.canvas_template_categories:
        category_id = item.id.strip()
        if category_id in seen_ids:
            raise ValueError("画布模板分类不能重复")
        seen_ids.add(category_id)
        if item.scope not in {"global", "user"}:
            raise ValueError("画布模板分类范围不支持")
        owner_user_id = _normalize_optional_text(item.owner_user_id)
        if item.scope == "global":
            owner_user_id = None
            normalized_name_key = item.name.strip()
            if normalized_name_key in seen_global_names:
                raise ValueError("全局画布模板分类名称不能重复")
            seen_global_names.add(normalized_name_key)
        elif owner_user_id is None:
            raise ValueError("用户画布模板分类缺少 owner_user_id")
        else:
            user_name_key = (owner_user_id, item.name.strip())
            if user_name_key in seen_user_names:
                raise ValueError("用户画布模板分类名称不能重复")
            seen_user_names.add(user_name_key)
        name = item.name.strip()
        if not name:
            raise ValueError("画布模板分类名称不能为空")
        categories.append(
            {
                "id": category_id,
                "scope": item.scope,
                "owner_user_id": owner_user_id,
                "name": name,
                "sort_order": item.sort_order,
                "enabled": item.enabled,
                "disabled_reason": _normalize_optional_text(item.disabled_reason),
            }
        )
    return categories


def _normalize_import_canvas_templates(
    document: SettingsExportDocument,
    categories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    category_ids = {category["id"] for category in categories}
    seen_ids: set[str] = set()
    seen_keys: set[str] = set()
    templates: list[dict[str, Any]] = []
    for item in document.canvas_templates:
        template_id = item.id.strip()
        if template_id in seen_ids:
            raise ValueError("画布模板不能重复")
        seen_ids.add(template_id)
        key = item.key.strip()
        if key in seen_keys:
            raise ValueError("画布模板 key 不能重复")
        seen_keys.add(key)
        if item.scope not in {"global", "user"}:
            raise ValueError("画布模板范围不支持")
        owner_user_id = _normalize_optional_text(item.owner_user_id)
        if item.scope == "global":
            owner_user_id = None
        elif owner_user_id is None:
            raise ValueError("用户画布模板缺少 owner_user_id")
        category_id = _normalize_optional_text(item.category_id)
        if category_id is not None and category_id not in category_ids:
            raise ValueError("画布模板分类不存在")
        if item.kind not in {"full_canvas", "node_group"}:
            raise ValueError("画布模板类型不支持")
        if item.entry_mode not in {"image", "copy", "tail"}:
            raise ValueError("画布模板入口类型不支持")
        title = item.title.strip()
        if not title:
            raise ValueError("画布模板名称不能为空")
        payload = dict(item.template_json)
        try:
            CanvasTemplatePayload.model_validate(
                {
                    **payload,
                    "key": key,
                    "template_id": template_id,
                    "version": item.schema_version,
                    "kind": item.kind,
                    "entry_mode": item.entry_mode,
                    "sort_order": item.sort_order,
                    "title": title,
                    "description": item.description or "",
                    "source": "user" if item.scope == "user" else "builtin",
                    "user_template_id": template_id if item.scope == "user" else None,
                    "scope": item.scope,
                    "owner_user_id": owner_user_id,
                    "category_id": category_id,
                    "enabled": item.enabled,
                    "effective_enabled": item.enabled,
                    "disabled_reason": item.disabled_reason,
                    "review_status": item.review_status,
                    "review_note": item.review_note,
                }
            )
        except ValueError as exc:
            raise ValueError(f"画布模板 {title} 格式不正确") from exc
        templates.append(
            {
                "id": template_id,
                "key": key,
                "scope": item.scope,
                "owner_user_id": owner_user_id,
                "category_id": category_id,
                "title": title,
                "description": _normalize_optional_text(item.description),
                "kind": item.kind,
                "entry_mode": item.entry_mode,
                "sort_order": item.sort_order,
                "schema_version": item.schema_version,
                "template_json": payload,
                "enabled": item.enabled,
                "disabled_reason": _normalize_optional_text(item.disabled_reason),
                "review_status": (
                    item.review_status if item.review_status in {"none", "pending", "approved", "rejected"} else "none"
                ),
                "review_note": _normalize_optional_text(item.review_note),
            }
        )
    return templates
