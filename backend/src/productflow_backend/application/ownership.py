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
        return require_active_user_id(session, owner_user_id, missing_message="资源归属账号不存在")
    ensure_auth_bootstrapped(session)
    default_owner_id = session.scalar(
        select(AuthUser.id).where(AuthUser.username == ADMIN_USERNAME, AuthUser.archived_at.is_(None))
    )
    if default_owner_id is None:
        raise BusinessValidationError("默认资源归属账号未初始化")
    return default_owner_id


def require_active_user_id(session: Session, user_id: str, *, missing_message: str = "用户不存在") -> str:
    normalized_user_id = user_id.strip()
    if not normalized_user_id:
        raise BusinessValidationError(missing_message)
    exists = session.scalar(
        select(AuthUser.id).where(AuthUser.id == normalized_user_id, AuthUser.archived_at.is_(None))
    )
    if exists is None:
        raise BusinessValidationError(missing_message)
    return normalized_user_id


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
