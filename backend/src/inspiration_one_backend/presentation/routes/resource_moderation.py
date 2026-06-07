from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from inspiration_one_backend.application.moderation import get_resource_moderation, set_resource_moderation
from inspiration_one_backend.domain.rbac import API_RESOURCES_MODERATE
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.presentation.deps import get_session, require_admin, require_api_permission
from inspiration_one_backend.presentation.schemas.moderation import (
    ResourceModerationRequest,
    ResourceModerationResponse,
    serialize_resource_moderation,
)

router = APIRouter(
    prefix="/api/resource-moderation",
    tags=["resource-moderation"],
    dependencies=[Depends(require_admin), Depends(require_api_permission(API_RESOURCES_MODERATE))],
)


@router.get("/{resource_type}/{resource_id}", response_model=ResourceModerationResponse)
def get_resource_moderation_endpoint(
    resource_type: str,
    resource_id: str,
    session: Session = Depends(get_session),
) -> ResourceModerationResponse:
    return serialize_resource_moderation(
        get_resource_moderation(session, resource_type=resource_type, resource_id=resource_id)
    )


@router.patch("/{resource_type}/{resource_id}", response_model=ResourceModerationResponse)
def update_resource_moderation_endpoint(
    resource_type: str,
    resource_id: str,
    payload: ResourceModerationRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_admin),
) -> ResourceModerationResponse:
    return serialize_resource_moderation(
        set_resource_moderation(
            session,
            resource_type=resource_type,
            resource_id=resource_id,
            enabled=payload.enabled,
            reason=payload.reason,
            actor_user_id=current_user.id,
        )
    )
