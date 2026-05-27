from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from productflow_backend.application.auth import ensure_auth_bootstrapped, user_has_api_permission
from productflow_backend.config import get_runtime_settings
from productflow_backend.infrastructure.db.models import AuthUser
from productflow_backend.infrastructure.db.session import get_db_session, get_session_factory


def get_session(session: Session = Depends(get_db_session)) -> Session:
    return session


def get_current_user(request: Request) -> AuthUser:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    factory = get_session_factory()
    with factory() as session:
        ensure_auth_bootstrapped(session)
        user = session.get(AuthUser, user_id)
        if user is None or user.archived_at is not None:
            request.session.clear()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
        if not user.enabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用")
        session.expunge(user)
        return user


def require_authenticated(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    return user


def require_admin(user: AuthUser = Depends(require_authenticated)) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return user


def require_api_permission(permission_code: str):
    def dependency(user: AuthUser = Depends(require_authenticated)) -> AuthUser:
        factory = get_session_factory()
        with factory() as session:
            if not user_has_api_permission(session, user, permission_code):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有接口权限")
        return user

    return dependency


def require_deletion_enabled() -> None:
    if not get_runtime_settings().deletion_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="删除功能已关闭，请联系管理员")
