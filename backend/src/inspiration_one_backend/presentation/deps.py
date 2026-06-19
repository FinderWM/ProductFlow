from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import (
    ensure_auth_bootstrapped,
    user_has_any_api_permission,
    user_has_api_permission,
)
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.infrastructure.db.session import get_db_session, get_session_factory
from inspiration_one_backend.presentation.auth_session import validate_auth_session


def get_session(session: Session = Depends(get_db_session)) -> Session:
    return session


def get_current_user(request: Request) -> AuthUser:
    factory = get_session_factory()
    with factory() as session:
        ensure_auth_bootstrapped(session)
        validation = validate_auth_session(request, session)
        if validation.disabled:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用")
        if validation.user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
        user = validation.user
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


def require_any_api_permission(*permission_codes: str):
    def dependency(user: AuthUser = Depends(require_authenticated)) -> AuthUser:
        factory = get_session_factory()
        with factory() as session:
            if not user_has_any_api_permission(session, user, permission_codes):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有接口权限")
        return user

    return dependency


def require_deletion_enabled() -> None:
    if not get_runtime_settings().deletion_enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="删除功能已关闭，请联系管理员")
