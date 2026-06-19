from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import (
    authenticate_user,
    ensure_auth_bootstrapped,
    get_user_permission_state,
    set_initial_password,
)
from inspiration_one_backend.infrastructure.db.models import AuthUser, RbacMenu
from inspiration_one_backend.presentation.auth_session import validate_auth_session, write_login_session
from inspiration_one_backend.presentation.deps import get_session
from inspiration_one_backend.presentation.schemas.auth import (
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
    if not payload.username or not (payload.password or payload.client_password_md5):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="账号和密码不能为空")
    user = authenticate_user(
        session,
        username=payload.username,
        password=payload.password,
        client_password_md5=payload.client_password_md5,
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码不正确")
    write_login_session(request, session, user)
    return SessionResponse()


@router.post("/login", response_model=SessionResponse)
def login(payload: LoginRequest, request: Request, session: Session = Depends(get_session)) -> SessionResponse:
    user = authenticate_user(
        session,
        username=payload.username,
        password=payload.password,
        client_password_md5=payload.client_password_md5,
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码不正确")
    write_login_session(request, session, user)
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
        setup_token=payload.setup_token,
        password=payload.password,
        client_password_md5=payload.client_password_md5,
    )
    write_login_session(request, session, user)
    return SessionResponse()


@router.get("/session", response_model=SessionStateResponse)
def get_session_state(request: Request, session: Session = Depends(get_session)) -> SessionStateResponse:
    ensure_auth_bootstrapped(session)
    validation = validate_auth_session(request, session)
    if not validation.authenticated or validation.user is None:
        return SessionStateResponse(authenticated=False, access_required=True)
    user = validation.user
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


def _serialize_user(user: AuthUser) -> AuthUserResponse:
    return AuthUserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role_id=user.role_id,
        is_admin=user.is_admin,
        enabled=user.enabled,
        password_pending=not bool(user.password_hash),
    )


def _serialize_menu(menu: RbacMenu) -> MenuPermissionResponse:
    return MenuPermissionResponse(code=menu.code, title=menu.title, sort_order=menu.sort_order)
