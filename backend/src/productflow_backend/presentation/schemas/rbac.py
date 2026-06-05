from __future__ import annotations

from pydantic import BaseModel, Field

from productflow_backend.infrastructure.db.models import AuthRole, AuthUser, RbacApiPermission, RbacMenu


class RbacMenuResponse(BaseModel):
    code: str
    title: str
    sort_order: int
    enabled: bool


class RbacApiPermissionResponse(BaseModel):
    code: str
    menu_code: str
    title: str
    description: str
    sort_order: int
    enabled: bool


class RbacPermissionCatalogResponse(BaseModel):
    menus: list[RbacMenuResponse]
    api_permissions: list[RbacApiPermissionResponse]


class RbacRoleResponse(BaseModel):
    id: str
    code: str
    name: str
    is_admin: bool
    user_count: int
    archived_at: str | None


class RbacUserResponse(BaseModel):
    id: str
    username: str
    display_name: str
    role_id: str
    role_name: str
    is_admin: bool
    enabled: bool
    password_pending: bool
    archived_at: str | None


class RbacUserListResponse(BaseModel):
    items: list[RbacUserResponse]
    total: int
    page: int
    page_size: int


class CreateTrustedUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    display_name: str | None = Field(default=None, max_length=120)
    role_id: str | None = None


class UpdateTrustedUserRequest(BaseModel):
    enabled: bool


class CreateRoleRequest(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=1, max_length=80)


class UpdateRoleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RolePermissionResponse(BaseModel):
    role_id: str
    menu_codes: list[str]
    api_permission_codes: list[str]


class UpdateRolePermissionRequest(BaseModel):
    menu_codes: list[str] = Field(default_factory=list)
    api_permission_codes: list[str] = Field(default_factory=list)


def serialize_menu(menu: RbacMenu) -> RbacMenuResponse:
    return RbacMenuResponse(
        code=menu.code,
        title=menu.title,
        sort_order=menu.sort_order,
        enabled=menu.enabled,
    )


def serialize_api_permission(permission: RbacApiPermission) -> RbacApiPermissionResponse:
    return RbacApiPermissionResponse(
        code=permission.code,
        menu_code=permission.menu_code,
        title=permission.title,
        description=permission.description,
        sort_order=permission.sort_order,
        enabled=permission.enabled,
    )


def serialize_role(role: AuthRole, *, user_count: int = 0) -> RbacRoleResponse:
    return RbacRoleResponse(
        id=role.id,
        code=role.code,
        name=role.name,
        is_admin=role.is_admin,
        user_count=user_count,
        archived_at=role.archived_at.isoformat() if role.archived_at else None,
    )


def serialize_user(user: AuthUser) -> RbacUserResponse:
    return RbacUserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role_id=user.role_id,
        role_name=user.role.name if user.role else "",
        is_admin=user.is_admin,
        enabled=user.enabled,
        password_pending=not bool(user.password_hash and user.password_salt),
        archived_at=user.archived_at.isoformat() if user.archived_at else None,
    )
