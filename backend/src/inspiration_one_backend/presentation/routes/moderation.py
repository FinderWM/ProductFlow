from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from inspiration_one_backend.application.moderation import ResourceType, set_resource_moderation
from inspiration_one_backend.domain.rbac import API_RESOURCES_MODERATE
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.presentation.deps import get_session, require_admin, require_api_permission
from inspiration_one_backend.presentation.schemas.moderation import (
    DisableResourceRequest,
    ResourceModerationResponse,
    serialize_resource_moderation,
)

router = APIRouter(
    prefix="/api/resources",
    tags=["resource-moderation"],
    dependencies=[Depends(require_admin), Depends(require_api_permission(API_RESOURCES_MODERATE))],
)


@router.post("/{resource_type}/{resource_id}/disable", response_model=ResourceModerationResponse)
def disable_resource_endpoint(
    resource_type: ResourceType,
    resource_id: str,
    payload: DisableResourceRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
) -> ResourceModerationResponse:
    result = set_resource_moderation(
        session,
        resource_type=resource_type,
        resource_id=resource_id,
        enabled=False,
        actor_user_id=current_user.id,
        reason=payload.reason,
    )
    return serialize_resource_moderation(result)


@router.post("/{resource_type}/{resource_id}/restore", response_model=ResourceModerationResponse)
def restore_resource_endpoint(
    resource_type: ResourceType,
    resource_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_admin),
) -> ResourceModerationResponse:
    result = set_resource_moderation(
        session,
        resource_type=resource_type,
        resource_id=resource_id,
        enabled=True,
        actor_user_id=_current_user.id,
    )
    return serialize_resource_moderation(result)
