from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from inspiration_one_backend.application.moderation import resource_moderation_state
from inspiration_one_backend.config import (
    DEFAULT_LOGIN_PAGE_MODE,
    DEFAULT_LOGIN_PAGE_TEMPLATE_ID,
    LOGIN_PAGE_TEMPLATE_IDS,
    LOGIN_PAGE_TEMPLATE_NAMES,
    get_runtime_settings,
    parse_login_page_template_config,
)
from inspiration_one_backend.domain.enums import ResourceLibraryAssetKind
from inspiration_one_backend.infrastructure.db.models import ResourceLibraryAsset
from inspiration_one_backend.infrastructure.storage import ImageVariantName, LocalStorage, StorageError
from inspiration_one_backend.presentation.deps import get_session
from inspiration_one_backend.presentation.schemas.public import LoginPageConfigResponse
from inspiration_one_backend.presentation.storage_responses import image_storage_object, raise_storage_response_error

router = APIRouter(prefix="/api/public", tags=["public"])

IMAGE_LAB_HERO_IMAGE_SLOT = "hero_image"
IMAGE_LAB_DEFAULT_HERO_IMAGE_URL = "/hero.png"


@router.get("/login-page-config", response_model=LoginPageConfigResponse)
def get_login_page_config_endpoint(
    session: Session = Depends(get_session),
) -> LoginPageConfigResponse:
    template_id = _resolve_login_page_template_id()
    return _build_login_page_config(template_id, session=session)


@router.get("/login-page-config/{template_id}", response_model=LoginPageConfigResponse)
def get_login_page_template_config_endpoint(
    template_id: str,
    session: Session = Depends(get_session),
) -> LoginPageConfigResponse:
    if template_id not in LOGIN_PAGE_TEMPLATE_NAMES:
        raise HTTPException(status_code=404, detail="登录页模板不存在")
    return _build_login_page_config(template_id, session=session)


def _build_login_page_config(template_id: str, *, session: Session) -> LoginPageConfigResponse:
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
    request: Request,
    variant: ImageVariantName = Query(default="preview"),
    session: Session = Depends(get_session),
) -> Response:
    if template_id != "image-lab" or slot != IMAGE_LAB_HERO_IMAGE_SLOT:
        raise HTTPException(status_code=404, detail="登录页资源不存在")
    settings = get_runtime_settings()
    config = parse_login_page_template_config("image-lab", settings.login_page_image_lab_config)
    asset = _configured_image_lab_asset(config["hero_image_asset_id"], session=session)
    if asset is None:
        raise HTTPException(status_code=404, detail="登录页资源不存在")

    storage = LocalStorage()
    try:
        object_key = storage.object_key_for(asset)
        return image_storage_object(
            storage,
            object_key,
            variant=variant,
            range_header=request.headers.get("range"),
            filename=asset.original_filename,
            fallback_media_type=asset.mime_type,
        )
    except StorageError as exc:
        raise_storage_response_error(exc, not_found_detail="登录页资源文件不存在")


def _resolve_login_page_template_id() -> str:
    settings = get_runtime_settings()
    if settings.login_page_mode in LOGIN_PAGE_TEMPLATE_NAMES:
        return settings.login_page_mode
    if settings.login_page_mode == DEFAULT_LOGIN_PAGE_MODE:
        return random.choice(LOGIN_PAGE_TEMPLATE_IDS)
    return DEFAULT_LOGIN_PAGE_TEMPLATE_ID


def _login_page_content(template_id: str) -> dict[str, str]:
    settings = get_runtime_settings()
    if template_id == "fluid-mist":
        config = parse_login_page_template_config(template_id, settings.login_page_fluid_mist_config)
        return {key: value for key, value in config.items() if key != "hero_image_asset_id"}
    if template_id == "image-lab":
        config = parse_login_page_template_config(template_id, settings.login_page_image_lab_config)
        return {key: value for key, value in config.items() if key != "hero_image_asset_id"}
    config = parse_login_page_template_config(template_id, settings.login_page_command_orbit_config)
    return {key: value for key, value in config.items() if key != "hero_image_asset_id"}


def _login_page_assets(template_id: str, *, session: Session) -> dict[str, str]:
    if template_id != "image-lab":
        return {}
    settings = get_runtime_settings()
    config = parse_login_page_template_config("image-lab", settings.login_page_image_lab_config)
    asset = _configured_image_lab_asset(config["hero_image_asset_id"], session=session)
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
