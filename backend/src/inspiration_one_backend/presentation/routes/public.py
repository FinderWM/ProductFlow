from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from inspiration_one_backend.application.moderation import resource_moderation_state
from inspiration_one_backend.config import (
    DEFAULT_LOGIN_PAGE_CODEX_ORBIT_BRAND_SUBTITLE,
    DEFAULT_LOGIN_PAGE_CODEX_ORBIT_HERO_DESCRIPTION,
    DEFAULT_LOGIN_PAGE_CODEX_ORBIT_HERO_TITLE,
    DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_DESCRIPTION,
    DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_TITLE,
    DEFAULT_LOGIN_PAGE_IMAGE_LAB_HERO_DESCRIPTION,
    DEFAULT_LOGIN_PAGE_MODE,
    DEFAULT_LOGIN_PAGE_TEMPLATE_ID,
    LOGIN_PAGE_TEMPLATE_NAMES,
    get_runtime_settings,
    parse_login_page_template_ids,
)
from inspiration_one_backend.domain.enums import ResourceLibraryAssetKind
from inspiration_one_backend.infrastructure.db.models import ResourceLibraryAsset
from inspiration_one_backend.infrastructure.storage import ImageVariantName, LocalStorage
from inspiration_one_backend.presentation.deps import get_session
from inspiration_one_backend.presentation.image_variants import build_variant_filename
from inspiration_one_backend.presentation.schemas.public import LoginPageConfigResponse

router = APIRouter(prefix="/api/public", tags=["public"])

IMAGE_LAB_HERO_IMAGE_SLOT = "hero_image"
IMAGE_LAB_DEFAULT_HERO_IMAGE_URL = "/hero.png"


@router.get("/login-page-config", response_model=LoginPageConfigResponse)
def get_login_page_config_endpoint(
    session: Session = Depends(get_session),
) -> LoginPageConfigResponse:
    template_id = _resolve_login_page_template_id()
    return LoginPageConfigResponse(
        template_id=template_id,
        template_name=LOGIN_PAGE_TEMPLATE_NAMES[template_id],
        content=_login_page_content(template_id),
        assets=_login_page_assets(template_id, session=session),
    )


@router.get("/login-page-assets/{template_id}/{slot}")
def download_login_page_asset_endpoint(
    template_id: str,
    slot: str,
    variant: ImageVariantName = Query(default="preview"),
    session: Session = Depends(get_session),
) -> Response:
    if template_id != "image-lab" or slot != IMAGE_LAB_HERO_IMAGE_SLOT:
        raise HTTPException(status_code=404, detail="登录页资源不存在")
    settings = get_runtime_settings()
    asset = _configured_image_lab_asset(settings.login_page_image_lab_hero_image_asset_id, session=session)
    if asset is None:
        raise HTTPException(status_code=404, detail="登录页资源不存在")

    storage = LocalStorage()
    object_key = storage.object_key_for(asset)
    try:
        path, media_type = storage.resolve_for_variant(
            object_key,
            variant,
            fallback_media_type=asset.mime_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="登录页资源文件不存在") from exc
    filename = build_variant_filename(asset.original_filename, variant=variant, resolved_suffix=path.suffix)
    return FileResponse(path, media_type=media_type, filename=filename)


def _resolve_login_page_template_id() -> str:
    settings = get_runtime_settings()
    enabled = _enabled_login_page_template_ids(settings.login_page_enabled_template_ids)
    if settings.login_page_mode == "selected" and settings.login_page_selected_template_id:
        selected = settings.login_page_selected_template_id
        if selected in LOGIN_PAGE_TEMPLATE_NAMES and selected in enabled:
            return selected
        return DEFAULT_LOGIN_PAGE_TEMPLATE_ID

    if settings.login_page_mode == DEFAULT_LOGIN_PAGE_MODE and enabled:
        return random.choice(enabled)
    return DEFAULT_LOGIN_PAGE_TEMPLATE_ID


def _enabled_login_page_template_ids(value: str) -> tuple[str, ...]:
    try:
        return parse_login_page_template_ids(value)
    except ValueError:
        return (DEFAULT_LOGIN_PAGE_TEMPLATE_ID,)


def _login_page_content(template_id: str) -> dict[str, str]:
    settings = get_runtime_settings()
    if template_id == "fluid-mist":
        return {
            "greeting_title": _config_text(
                settings.login_page_fluid_mist_greeting_title,
                DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_TITLE,
            ),
            "greeting_description": _config_text(
                settings.login_page_fluid_mist_greeting_description,
                DEFAULT_LOGIN_PAGE_FLUID_MIST_GREETING_DESCRIPTION,
            ),
        }
    if template_id == "image-lab":
        return {
            "hero_description": _config_text(
                settings.login_page_image_lab_hero_description,
                DEFAULT_LOGIN_PAGE_IMAGE_LAB_HERO_DESCRIPTION,
            )
        }
    return {
        "brand_subtitle": _config_text(
            settings.login_page_codex_orbit_brand_subtitle,
            DEFAULT_LOGIN_PAGE_CODEX_ORBIT_BRAND_SUBTITLE,
        ),
        "hero_title": _config_text(
            settings.login_page_codex_orbit_hero_title,
            DEFAULT_LOGIN_PAGE_CODEX_ORBIT_HERO_TITLE,
        ),
        "hero_description": _config_text(
            settings.login_page_codex_orbit_hero_description,
            DEFAULT_LOGIN_PAGE_CODEX_ORBIT_HERO_DESCRIPTION,
        ),
    }


def _login_page_assets(template_id: str, *, session: Session) -> dict[str, str]:
    if template_id != "image-lab":
        return {}
    settings = get_runtime_settings()
    asset = _configured_image_lab_asset(settings.login_page_image_lab_hero_image_asset_id, session=session)
    if asset is None:
        return {IMAGE_LAB_HERO_IMAGE_SLOT: IMAGE_LAB_DEFAULT_HERO_IMAGE_URL}
    return {IMAGE_LAB_HERO_IMAGE_SLOT: f"/api/public/login-page-assets/image-lab/{IMAGE_LAB_HERO_IMAGE_SLOT}"}


def _configured_image_lab_asset(asset_id: str, *, session: Session) -> ResourceLibraryAsset | None:
    normalized_asset_id = asset_id.strip()
    if not normalized_asset_id:
        return None
    asset = session.get(ResourceLibraryAsset, normalized_asset_id)
    if asset is None or asset.archived_at is not None or asset.kind != ResourceLibraryAssetKind.IMAGE:
        return None
    if not resource_moderation_state("resource_library_asset", asset).effective_enabled:
        return None
    return asset


def _config_text(value: str, fallback: str) -> str:
    normalized = value.strip()
    return normalized or fallback
