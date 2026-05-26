from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from productflow_backend.infrastructure.db.models import ProviderProfile
from productflow_backend.infrastructure.openai_client import build_openai_client_kwargs
from productflow_backend.infrastructure.provider_config import (
    PROVIDER_TYPE_GOOGLE_GEMINI,
    PROVIDER_TYPE_OPENAI_COMPATIBLE,
)


class ProviderModelDiscoveryError(RuntimeError):
    """Raised when a provider model list cannot be fetched or parsed."""


class ProviderModelDiscoveryUnsupportedError(ValueError):
    """Raised when a provider type does not yet implement model discovery."""


@dataclass(frozen=True, slots=True)
class ProviderModel:
    id: str
    label: str
    owned_by: str | None = None
    created: int | None = None


def list_provider_models(profile: ProviderProfile, provider_kind: str) -> list[ProviderModel]:
    """List models for a provider profile through the profile's provider-type adapter."""

    if profile.provider_type == PROVIDER_TYPE_OPENAI_COMPATIBLE:
        return _list_openai_compatible_models(profile)
    if profile.provider_type == PROVIDER_TYPE_GOOGLE_GEMINI:
        raise ProviderModelDiscoveryUnsupportedError("Google Gemini 暂不支持远程拉取模型列表，请手动填写模型名")
    raise ProviderModelDiscoveryUnsupportedError("供应商类型暂不支持模型列表拉取")


def _list_openai_compatible_models(profile: ProviderProfile) -> list[ProviderModel]:
    if not profile.api_key:
        raise ProviderModelDiscoveryError("供应商档案缺少 API Key，无法拉取模型列表")

    try:
        client_kwargs = build_openai_client_kwargs(api_key=profile.api_key, base_url=profile.base_url)
        response = OpenAI(**client_kwargs).models.list()
    except Exception as exc:  # noqa: BLE001
        raise ProviderModelDiscoveryError("供应商模型列表拉取失败，请检查 Base URL、API Key 或供应商权限") from exc

    models_by_id: dict[str, ProviderModel] = {}
    for item in getattr(response, "data", []) or []:
        model_id = _optional_text(_get_attr_or_key(item, "id"))
        if not model_id:
            continue
        models_by_id[model_id] = ProviderModel(
            id=model_id,
            label=model_id,
            owned_by=_optional_text(_get_attr_or_key(item, "owned_by")),
            created=_optional_int(_get_attr_or_key(item, "created")),
        )

    if not models_by_id:
        raise ProviderModelDiscoveryError("供应商模型列表为空或格式不正确")

    return [models_by_id[model_id] for model_id in sorted(models_by_id)]


def _get_attr_or_key(item: Any, key: str) -> Any:
    if isinstance(item, dict):
        return item.get(key)
    return getattr(item, key, None)


def _optional_text(value: Any) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
