from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, object_session, selectinload

from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.enums import ResourceLibrarySourceType
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplate,
    CanvasTemplateCategory,
    ImageGalleryEntry,
    ImageSession,
    ImageSessionAsset,
    Inspiration,
    PosterVariant,
    ResourceLibraryAsset,
    SourceAsset,
)

ResourceType = Literal[
    "inspiration",
    "source_asset",
    "poster_variant",
    "image_session",
    "image_session_asset",
    "image_gallery_entry",
    "resource_library_asset",
    "canvas_template",
    "canvas_template_category",
]

RESOURCE_DISABLED_DETAIL = "资源已被管理员屏蔽，暂不可使用"
_RESOURCE_TYPES = set(ResourceType.__args__)


@dataclass(frozen=True, slots=True)
class DisabledSource:
    resource_type: ResourceType
    resource_id: str
    reason: str | None


@dataclass(frozen=True, slots=True)
class ResourceModerationState:
    enabled: bool
    disabled_at: datetime | None
    disabled_by_user_id: str | None
    disabled_by_username: str | None
    disabled_reason: str | None
    effective_enabled: bool
    effective_disabled_source: DisabledSource | None


@dataclass(frozen=True, slots=True)
class ResourceModerationResult:
    resource_type: ResourceType
    resource_id: str
    owner_user_id: str | None
    owner_username: str | None
    state: ResourceModerationState


def normalize_resource_type(resource_type: str) -> ResourceType:
    normalized = resource_type.strip().lower()
    if normalized not in _RESOURCE_TYPES:
        raise BusinessValidationError("资源类型不支持")
    return normalized  # type: ignore[return-value]


def resource_moderation_state(resource_type: ResourceType, resource: Any) -> ResourceModerationState:
    effective_disabled_source = effective_disabled_source_for(resource_type, resource)
    disabled_by = getattr(resource, "disabled_by", None)
    return ResourceModerationState(
        enabled=bool(getattr(resource, "enabled", True)),
        disabled_at=getattr(resource, "disabled_at", None),
        disabled_by_user_id=getattr(resource, "disabled_by_user_id", None),
        disabled_by_username=getattr(disabled_by, "username", None) if disabled_by is not None else None,
        disabled_reason=getattr(resource, "disabled_reason", None),
        effective_enabled=effective_disabled_source is None,
        effective_disabled_source=effective_disabled_source,
    )


def moderation_state_for_resource(resource: Any) -> ResourceModerationState:
    return resource_moderation_state(resource_type_for_instance(resource), resource)


def moderation_payload(resource_type: ResourceType, resource: Any) -> dict[str, Any]:
    state = resource_moderation_state(resource_type, resource)
    source = state.effective_disabled_source
    return {
        "enabled": state.enabled,
        "disabled_at": state.disabled_at,
        "disabled_by_user_id": state.disabled_by_user_id,
        "disabled_by_username": state.disabled_by_username,
        "disabled_reason": state.disabled_reason,
        "effective_enabled": state.effective_enabled,
        "effective_disabled_resource_type": source.resource_type if source else None,
        "effective_disabled_resource_id": source.resource_id if source else None,
        "effective_disabled_reason": source.reason if source else None,
    }


def require_inspiration_usable(inspiration: Inspiration) -> None:
    require_resource_usable("inspiration", inspiration)


def require_source_asset_usable(asset: SourceAsset) -> None:
    require_resource_usable("source_asset", asset)


def require_poster_variant_usable(poster: PosterVariant) -> None:
    require_resource_usable("poster_variant", poster)


def require_image_session_usable(image_session: ImageSession) -> None:
    require_resource_usable("image_session", image_session)


def require_image_session_asset_usable(asset: ImageSessionAsset) -> None:
    require_resource_usable("image_session_asset", asset)


def require_gallery_entry_usable(entry: ImageGalleryEntry) -> None:
    require_resource_usable("image_gallery_entry", entry)


def require_resource_library_asset_usable(asset: ResourceLibraryAsset) -> None:
    require_resource_usable("resource_library_asset", asset)


def require_resource_usable(resource_type: ResourceType, resource: Any) -> None:
    if not resource_moderation_state(resource_type, resource).effective_enabled:
        raise BusinessValidationError(RESOURCE_DISABLED_DETAIL)


def ensure_resource_usable(resource: Any) -> None:
    require_resource_usable(resource_type_for_instance(resource), resource)


def resource_type_for_instance(resource: Any) -> ResourceType:
    if isinstance(resource, Inspiration):
        return "inspiration"
    if isinstance(resource, SourceAsset):
        return "source_asset"
    if isinstance(resource, PosterVariant):
        return "poster_variant"
    if isinstance(resource, ImageSession):
        return "image_session"
    if isinstance(resource, ImageSessionAsset):
        return "image_session_asset"
    if isinstance(resource, ImageGalleryEntry):
        return "image_gallery_entry"
    if isinstance(resource, ResourceLibraryAsset):
        return "resource_library_asset"
    if isinstance(resource, CanvasTemplate):
        return "canvas_template"
    if isinstance(resource, CanvasTemplateCategory):
        return "canvas_template_category"
    raise TypeError(f"Unsupported moderated resource: {type(resource).__name__}")


def gallery_entry_visible_to_actor(
    entry: ImageGalleryEntry,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
) -> bool:
    if actor_is_admin or entry.owner_user_id == actor_user_id:
        return True
    return resource_moderation_state("image_gallery_entry", entry).effective_enabled


def set_resource_moderation(
    session: Session,
    *,
    resource_type: str,
    resource_id: str,
    enabled: bool,
    actor_user_id: str,
    reason: str | None = None,
) -> ResourceModerationResult:
    normalized_type = normalize_resource_type(resource_type)
    resource = _load_resource_for_moderation(session, normalized_type, resource_id)
    if resource is None:
        raise NotFoundError("资源不存在")

    if enabled:
        resource.enabled = True
        resource.disabled_at = None
        resource.disabled_by_user_id = None
        resource.disabled_reason = None
        if normalized_type == "canvas_template":
            resource.review_status = "approved" if getattr(resource, "review_status", "none") == "pending" else "none"
            resource.reviewed_at = now_utc()
            resource.reviewed_by_user_id = actor_user_id
    else:
        resource.enabled = False
        resource.disabled_at = now_utc()
        resource.disabled_by_user_id = actor_user_id
        resource.disabled_reason = _normalize_reason(reason)
        if normalized_type == "canvas_template":
            resource.review_status = "rejected" if getattr(resource, "review_status", "none") == "pending" else "none"
            resource.reviewed_at = now_utc()
            resource.reviewed_by_user_id = actor_user_id

    session.commit()
    session.expire_all()
    resource = _load_resource_for_moderation(session, normalized_type, resource_id)
    if resource is None:
        raise NotFoundError("资源不存在")
    return _moderation_result(normalized_type, resource)


def get_resource_moderation(
    session: Session,
    *,
    resource_type: str,
    resource_id: str,
) -> ResourceModerationResult:
    normalized_type = normalize_resource_type(resource_type)
    resource = _load_resource_for_moderation(session, normalized_type, resource_id)
    if resource is None:
        raise NotFoundError("资源不存在")
    return _moderation_result(normalized_type, resource)


def effective_disabled_source_for(resource_type: ResourceType, resource: Any) -> DisabledSource | None:
    if resource_type == "inspiration":
        return _own_disabled_source("inspiration", resource)
    if resource_type == "source_asset":
        return _source_asset_disabled_source(resource)
    if resource_type == "poster_variant":
        return _poster_variant_disabled_source(resource)
    if resource_type == "image_session":
        return _own_disabled_source("image_session", resource) or _inspiration_disabled_source(resource.inspiration)
    if resource_type == "image_session_asset":
        return _own_disabled_source("image_session_asset", resource) or _image_session_disabled_source(resource.session)
    if resource_type == "image_gallery_entry":
        return _own_disabled_source("image_gallery_entry", resource) or _image_session_asset_disabled_source(
            resource.asset
        )
    if resource_type == "resource_library_asset":
        return _own_disabled_source("resource_library_asset", resource) or _resource_library_source_disabled_source(
            resource
        )
    if resource_type == "canvas_template":
        return _own_disabled_source("canvas_template", resource) or _canvas_template_category_disabled_source(
            resource.category
        )
    if resource_type == "canvas_template_category":
        return _own_disabled_source("canvas_template_category", resource)
    return None


def _inspiration_disabled_source(inspiration: Inspiration | None) -> DisabledSource | None:
    return _own_disabled_source("inspiration", inspiration) if inspiration is not None else None


def _source_asset_disabled_source(asset: SourceAsset | None) -> DisabledSource | None:
    if asset is None:
        return None
    return _own_disabled_source("source_asset", asset) or _inspiration_disabled_source(asset.inspiration)


def _poster_variant_disabled_source(poster: PosterVariant | None) -> DisabledSource | None:
    if poster is None:
        return None
    return _own_disabled_source("poster_variant", poster) or _inspiration_disabled_source(poster.inspiration)


def _image_session_disabled_source(image_session: ImageSession | None) -> DisabledSource | None:
    if image_session is None:
        return None
    return _own_disabled_source("image_session", image_session) or _inspiration_disabled_source(
        image_session.inspiration
    )


def _image_session_asset_disabled_source(asset: ImageSessionAsset | None) -> DisabledSource | None:
    if asset is None:
        return None
    return _own_disabled_source("image_session_asset", asset) or _image_session_disabled_source(asset.session)


def _resource_library_source_disabled_source(asset: ResourceLibraryAsset) -> DisabledSource | None:
    if not asset.source_resource_id:
        return None
    session = object_session(asset)
    if session is None:
        return None
    if asset.source_type == ResourceLibrarySourceType.SOURCE_ASSET:
        source_asset = session.scalar(
            select(SourceAsset)
            .options(
                selectinload(SourceAsset.disabled_by),
                selectinload(SourceAsset.inspiration).selectinload(Inspiration.disabled_by),
            )
            .where(SourceAsset.id == asset.source_resource_id)
        )
        return _source_asset_disabled_source(source_asset)
    if asset.source_type == ResourceLibrarySourceType.POSTER_VARIANT:
        poster = session.scalar(
            select(PosterVariant)
            .options(
                selectinload(PosterVariant.disabled_by),
                selectinload(PosterVariant.inspiration).selectinload(Inspiration.disabled_by),
            )
            .where(PosterVariant.id == asset.source_resource_id)
        )
        return _poster_variant_disabled_source(poster)
    if asset.source_type == ResourceLibrarySourceType.IMAGE_SESSION_ASSET:
        image_asset = session.scalar(
            select(ImageSessionAsset)
            .options(
                selectinload(ImageSessionAsset.disabled_by),
                selectinload(ImageSessionAsset.session).selectinload(ImageSession.disabled_by),
                selectinload(ImageSessionAsset.session)
                .selectinload(ImageSession.inspiration)
                .selectinload(Inspiration.disabled_by),
            )
            .where(ImageSessionAsset.id == asset.source_resource_id)
        )
        return _image_session_asset_disabled_source(image_asset)
    return None


def _canvas_template_category_disabled_source(
    category: CanvasTemplateCategory | None,
) -> DisabledSource | None:
    return _own_disabled_source("canvas_template_category", category) if category is not None else None


def _own_disabled_source(resource_type: ResourceType, resource: Any | None) -> DisabledSource | None:
    if resource is None or bool(getattr(resource, "enabled", True)):
        return None
    return DisabledSource(
        resource_type=resource_type,
        resource_id=resource.id,
        reason=getattr(resource, "disabled_reason", None),
    )


def _load_resource_for_moderation(session: Session, resource_type: ResourceType, resource_id: str) -> Any | None:
    if resource_type == "inspiration":
        return session.scalar(
            select(Inspiration)
            .options(selectinload(Inspiration.owner), selectinload(Inspiration.disabled_by))
            .where(Inspiration.id == resource_id)
        )
    if resource_type == "source_asset":
        return session.scalar(
            select(SourceAsset)
            .options(
                selectinload(SourceAsset.inspiration).selectinload(Inspiration.owner),
                selectinload(SourceAsset.inspiration).selectinload(Inspiration.disabled_by),
                selectinload(SourceAsset.disabled_by),
            )
            .where(SourceAsset.id == resource_id)
        )
    if resource_type == "poster_variant":
        return session.scalar(
            select(PosterVariant)
            .options(
                selectinload(PosterVariant.inspiration).selectinload(Inspiration.owner),
                selectinload(PosterVariant.inspiration).selectinload(Inspiration.disabled_by),
                selectinload(PosterVariant.disabled_by),
            )
            .where(PosterVariant.id == resource_id)
        )
    if resource_type == "image_session":
        return session.scalar(
            select(ImageSession)
            .options(
                selectinload(ImageSession.owner),
                selectinload(ImageSession.disabled_by),
                selectinload(ImageSession.inspiration).selectinload(Inspiration.disabled_by),
            )
            .where(ImageSession.id == resource_id)
        )
    if resource_type == "image_session_asset":
        return session.scalar(
            select(ImageSessionAsset)
            .options(
                selectinload(ImageSessionAsset.owner),
                selectinload(ImageSessionAsset.disabled_by),
                selectinload(ImageSessionAsset.session).selectinload(ImageSession.disabled_by),
                selectinload(ImageSessionAsset.session)
                .selectinload(ImageSession.inspiration)
                .selectinload(Inspiration.disabled_by),
            )
            .where(ImageSessionAsset.id == resource_id)
        )
    if resource_type == "image_gallery_entry":
        return session.scalar(
            select(ImageGalleryEntry)
            .options(
                selectinload(ImageGalleryEntry.owner),
                selectinload(ImageGalleryEntry.disabled_by),
                selectinload(ImageGalleryEntry.asset).selectinload(ImageSessionAsset.disabled_by),
                selectinload(ImageGalleryEntry.asset)
                .selectinload(ImageSessionAsset.session)
                .selectinload(ImageSession.disabled_by),
                selectinload(ImageGalleryEntry.asset)
                .selectinload(ImageSessionAsset.session)
                .selectinload(ImageSession.inspiration)
                .selectinload(Inspiration.disabled_by),
            )
            .where(ImageGalleryEntry.id == resource_id)
        )
    if resource_type == "resource_library_asset":
        return session.scalar(
            select(ResourceLibraryAsset)
            .options(selectinload(ResourceLibraryAsset.owner), selectinload(ResourceLibraryAsset.disabled_by))
            .where(ResourceLibraryAsset.id == resource_id)
        )
    if resource_type == "canvas_template":
        return session.scalar(
            select(CanvasTemplate)
            .options(
                selectinload(CanvasTemplate.owner),
                selectinload(CanvasTemplate.disabled_by),
                selectinload(CanvasTemplate.category).selectinload(CanvasTemplateCategory.disabled_by),
            )
            .where(CanvasTemplate.id == resource_id)
        )
    if resource_type == "canvas_template_category":
        return session.scalar(
            select(CanvasTemplateCategory)
            .options(selectinload(CanvasTemplateCategory.owner), selectinload(CanvasTemplateCategory.disabled_by))
            .where(CanvasTemplateCategory.id == resource_id)
        )
    return None


def _moderation_result(resource_type: ResourceType, resource: Any) -> ResourceModerationResult:
    owner = _resource_owner(resource_type, resource)
    return ResourceModerationResult(
        resource_type=resource_type,
        resource_id=resource.id,
        owner_user_id=getattr(owner, "id", None),
        owner_username=getattr(owner, "username", None),
        state=resource_moderation_state(resource_type, resource),
    )


def _resource_owner(resource_type: ResourceType, resource: Any) -> Any | None:
    if resource_type in {
        "inspiration",
        "image_session",
        "image_session_asset",
        "image_gallery_entry",
        "resource_library_asset",
    }:
        return getattr(resource, "owner", None)
    if resource_type in {"source_asset", "poster_variant"}:
        inspiration = getattr(resource, "inspiration", None)
        return getattr(inspiration, "owner", None) if inspiration is not None else None
    if resource_type in {"canvas_template", "canvas_template_category"}:
        return getattr(resource, "owner", None)
    return None


def _normalize_reason(reason: str | None) -> str | None:
    normalized = (reason or "").strip()
    if not normalized:
        return None
    if len(normalized) > 500:
        raise BusinessValidationError("屏蔽原因不能超过 500 个字符")
    return normalized
