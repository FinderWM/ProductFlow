from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from productflow_backend.application.auth import ensure_auth_bootstrapped
from productflow_backend.domain.errors import BusinessValidationError, NotFoundError
from productflow_backend.domain.rbac import ADMIN_USERNAME
from productflow_backend.infrastructure.db.models import AuthUser

ADMIN_CANNOT_EDIT_OTHER_RESOURCE = "管理员不能直接编辑其他用户资源"


def resolve_owner_user_id(session: Session, owner_user_id: str | None) -> str:
    if owner_user_id:
        return owner_user_id
    ensure_auth_bootstrapped(session)
    default_owner_id = session.scalar(select(AuthUser.id).where(AuthUser.username == ADMIN_USERNAME))
    if default_owner_id is None:
        raise BusinessValidationError("默认资源归属账号未初始化")
    return default_owner_id


def ensure_actor_can_mutate_owner(
    *,
    owner_user_id: str,
    actor_user_id: str | None,
    actor_is_admin: bool,
    missing_message: str,
) -> None:
    if actor_user_id is None or owner_user_id == actor_user_id:
        return
    if actor_is_admin:
        raise BusinessValidationError(ADMIN_CANNOT_EDIT_OTHER_RESOURCE)
    raise NotFoundError(missing_message)
