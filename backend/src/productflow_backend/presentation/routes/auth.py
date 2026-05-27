from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from productflow_backend.application.auth import (
    authenticate_user,
    ensure_auth_bootstrapped,
    get_user_permission_state,
    set_initial_password,
)
from productflow_backend.infrastructure.db.models import AuthUser, RbacMenu
from productflow_backend.presentation.deps import get_session
from productflow_backend.presentation.schemas.auth import (
    AuthUserResponse,
    LoginRequest,
    MenuPermissionResponse,
    PasswordSetRequest,
    SessionCreateRequest,
    SessionResponse,
    SessionStateResponse,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/session", response_model=SessionResponse)
def create_session(
    payload: SessionCreateRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> SessionResponse:
    if payload.admin_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请使用账号密码登录")
    if not payload.username or not payload.client_password_md5:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="账号和密码不能为空")
    user = authenticate_user(
        session,
        username=payload.username,
        client_password_md5=payload.client_password_md5,
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码不正确")
    _write_login_session(request, user)
    return SessionResponse()


@router.post("/login", response_model=SessionResponse)
def login(payload: LoginRequest, request: Request, session: Session = Depends(get_session)) -> SessionResponse:
    user = authenticate_user(
        session,
        username=payload.username,
        client_password_md5=payload.client_password_md5,
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码不正确")
    _write_login_session(request, user)
    return SessionResponse()


@router.post("/password", response_model=SessionResponse)
def set_password(
    payload: PasswordSetRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> SessionResponse:
    user = set_initial_password(
        session,
        username=payload.username,
        client_password_md5=payload.client_password_md5,
    )
    _write_login_session(request, user)
    return SessionResponse()


@router.get("/session", response_model=SessionStateResponse)
def get_session_state(request: Request, session: Session = Depends(get_session)) -> SessionStateResponse:
    ensure_auth_bootstrapped(session)
    user_id = request.session.get("user_id")
    if not user_id:
        return SessionStateResponse(authenticated=False, access_required=True)
    user = session.get(AuthUser, user_id)
    if user is None or not user.enabled or user.archived_at is not None:
        request.session.clear()
        return SessionStateResponse(authenticated=False, access_required=True)
    permission_state = get_user_permission_state(session, user)
    return SessionStateResponse(
        authenticated=True,
        access_required=True,
        user=_serialize_user(user),
        menus=[_serialize_menu(menu) for menu in permission_state.menus],
        api_permissions=permission_state.api_permission_codes,
    )


@router.delete("/session", response_model=SessionResponse)
def destroy_session(request: Request, response: Response) -> SessionResponse:
    request.session.clear()
    response.delete_cookie("session")
    return SessionResponse()


def _write_login_session(request: Request, user: AuthUser) -> None:
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["username"] = user.username
    request.session["role_id"] = user.role_id
    request.session["is_admin"] = user.is_admin


def _serialize_user(user: AuthUser) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role_id=user.role_id,
        is_admin=user.is_admin,
        enabled=user.enabled,
        password_pending=not bool(user.password_hash and user.password_salt),
    )


def _serialize_menu(menu: RbacMenu) -> MenuPermissionResponse:
    return MenuPermissionResponse(code=menu.code, title=menu.title, sort_order=menu.sort_order)
