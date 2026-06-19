from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import (
    archive_role,
    create_role,
    create_trusted_user,
    ensure_auth_bootstrapped,
    get_role_permissions,
    get_user_generation_resource_group_grant_ids,
    list_roles_with_user_counts,
    list_users,
    replace_role_permissions,
    replace_user_generation_resource_group_grants,
    reset_user_password,
    set_user_enabled,
    update_role,
)
from inspiration_one_backend.domain.rbac import API_RBAC_MANAGE
from inspiration_one_backend.infrastructure.db.models import (
    AuthUser,
    GenerationResourceGroup,
    RbacApiPermission,
    RbacMenu,
    UserGenerationResourceGroupGrant,
)
from inspiration_one_backend.infrastructure.provider_config import ensure_provider_config_bootstrapped
from inspiration_one_backend.presentation.deps import (
    get_current_user,
    get_session,
    require_admin,
    require_api_permission,
)
from inspiration_one_backend.presentation.schemas.rbac import (
    CreateRoleRequest,
    CreateTrustedUserRequest,
    RbacPermissionCatalogResponse,
    RbacRoleResponse,
    RbacUserListResponse,
    RbacUserResponse,
    RolePermissionResponse,
    UpdateRolePermissionRequest,
    UpdateRoleRequest,
    UpdateTrustedUserRequest,
    UpdateUserGenerationResourceGroupGrantsRequest,
    UserGenerationResourceGroupGrantResponse,
    serialize_api_permission,
    serialize_menu,
    serialize_role,
    serialize_user,
)

router = APIRouter(
    prefix="/api/rbac",
    tags=["rbac"],
    dependencies=[Depends(require_admin), Depends(require_api_permission(API_RBAC_MANAGE))],
)


@router.get("/permissions", response_model=RbacPermissionCatalogResponse)
def list_permission_catalog_endpoint(session: Session = Depends(get_session)) -> RbacPermissionCatalogResponse:
    # RBAC 管理目录按代码定义自愈：补齐缺失项并停用过期菜单/权限。鉴权热路径已不再每请求 bootstrap，
    # 故在此 admin-only 低频端点显式 reconcile，保证目录展示与当前代码注册表一致。
    ensure_auth_bootstrapped(session)
    menus = list(session.scalars(select(RbacMenu).where(RbacMenu.enabled.is_(True)).order_by(RbacMenu.sort_order)))
    api_permissions = list(
        session.scalars(
            select(RbacApiPermission)
            .where(RbacApiPermission.enabled.is_(True))
            .order_by(RbacApiPermission.menu_code, RbacApiPermission.sort_order)
        )
    )
    return RbacPermissionCatalogResponse(
        menus=[serialize_menu(menu) for menu in menus],
        api_permissions=[serialize_api_permission(permission) for permission in api_permissions],
    )


@router.get("/users", response_model=RbacUserListResponse)
def list_users_endpoint(
    username: str | None = Query(default=None, max_length=80),
    query: str | None = Query(default=None, max_length=120),
    role_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> RbacUserListResponse:
    users, total = list_users(session, page=page, page_size=page_size, username=username, query=query, role_id=role_id)
    resource_groups_by_user = _resource_groups_by_user(session, users)
    return RbacUserListResponse(
        items=[serialize_user(user, resource_groups=resource_groups_by_user.get(user.id, [])) for user in users],
        total=total,
        page=page,
        page_size=page_size,
    )


def _resource_groups_by_user(
    session: Session,
    users: list[AuthUser],
) -> dict[str, list[GenerationResourceGroup]]:
    if not users:
        return {}
    ensure_provider_config_bootstrapped(session)
    result: dict[str, list[GenerationResourceGroup]] = {user.id: [] for user in users}
    enabled_groups = list(
        session.scalars(
            select(GenerationResourceGroup)
            .where(
                GenerationResourceGroup.enabled.is_(True),
                GenerationResourceGroup.archived_at.is_(None),
            )
            .order_by(
                GenerationResourceGroup.sort_order.desc(),
                GenerationResourceGroup.created_at,
                GenerationResourceGroup.name,
            )
        ).all()
    )
    for user in users:
        if user.is_admin:
            result[user.id] = enabled_groups

    regular_user_ids = [user.id for user in users if not user.is_admin]
    if not regular_user_ids:
        return result

    rows = session.execute(
        select(UserGenerationResourceGroupGrant.user_id, GenerationResourceGroup)
        .join(
            GenerationResourceGroup,
            GenerationResourceGroup.id == UserGenerationResourceGroupGrant.resource_group_id,
        )
        .where(
            UserGenerationResourceGroupGrant.user_id.in_(regular_user_ids),
            GenerationResourceGroup.enabled.is_(True),
            GenerationResourceGroup.archived_at.is_(None),
        )
        .order_by(
            UserGenerationResourceGroupGrant.user_id,
            GenerationResourceGroup.sort_order.desc(),
            GenerationResourceGroup.created_at,
            GenerationResourceGroup.name,
        )
    )
    for user_id, group in rows:
        result.setdefault(user_id, []).append(group)
    return result


@router.post("/users", response_model=RbacUserResponse, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    payload: CreateTrustedUserRequest,
    session: Session = Depends(get_session),
) -> RbacUserResponse:
    issue = create_trusted_user(
        session,
        username=payload.username,
        display_name=payload.display_name,
        role_id=payload.role_id,
    )
    return serialize_user(issue.user, password_setup_token=issue.setup_token)


@router.patch("/users/{user_id}", response_model=RbacUserResponse)
def update_user_endpoint(
    user_id: str,
    payload: UpdateTrustedUserRequest,
    session: Session = Depends(get_session),
) -> RbacUserResponse:
    return serialize_user(set_user_enabled(session, user_id=user_id, enabled=payload.enabled))


@router.get("/users/{user_id}/generation-resource-groups", response_model=UserGenerationResourceGroupGrantResponse)
def get_user_generation_resource_group_grants_endpoint(
    user_id: str,
    session: Session = Depends(get_session),
) -> UserGenerationResourceGroupGrantResponse:
    return UserGenerationResourceGroupGrantResponse(
        user_id=user_id,
        resource_group_ids=get_user_generation_resource_group_grant_ids(session, user_id=user_id),
    )


@router.put("/users/{user_id}/generation-resource-groups", response_model=UserGenerationResourceGroupGrantResponse)
def replace_user_generation_resource_group_grants_endpoint(
    user_id: str,
    payload: UpdateUserGenerationResourceGroupGrantsRequest,
    session: Session = Depends(get_session),
) -> UserGenerationResourceGroupGrantResponse:
    return UserGenerationResourceGroupGrantResponse(
        user_id=user_id,
        resource_group_ids=replace_user_generation_resource_group_grants(
            session,
            user_id=user_id,
            resource_group_ids=payload.resource_group_ids,
        ),
    )


@router.post("/users/{user_id}/reset-password", response_model=RbacUserResponse)
def reset_user_password_endpoint(
    user_id: str,
    actor: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> RbacUserResponse:
    issue = reset_user_password(session, user_id=user_id, actor=actor)
    return serialize_user(issue.user, password_setup_token=issue.setup_token)


@router.get("/roles", response_model=list[RbacRoleResponse])
def list_roles_endpoint(session: Session = Depends(get_session)) -> list[RbacRoleResponse]:
    return [serialize_role(item.role, user_count=item.user_count) for item in list_roles_with_user_counts(session)]


@router.post("/roles", response_model=RbacRoleResponse, status_code=status.HTTP_201_CREATED)
def create_role_endpoint(payload: CreateRoleRequest, session: Session = Depends(get_session)) -> RbacRoleResponse:
    return serialize_role(create_role(session, code=payload.code, name=payload.name))


@router.patch("/roles/{role_id}", response_model=RbacRoleResponse)
def update_role_endpoint(
    role_id: str,
    payload: UpdateRoleRequest,
    session: Session = Depends(get_session),
) -> RbacRoleResponse:
    return serialize_role(update_role(session, role_id=role_id, name=payload.name))


@router.delete("/roles/{role_id}", response_model=RbacRoleResponse)
def archive_role_endpoint(role_id: str, session: Session = Depends(get_session)) -> RbacRoleResponse:
    return serialize_role(archive_role(session, role_id=role_id))


@router.get("/roles/{role_id}/permissions", response_model=RolePermissionResponse)
def get_role_permissions_endpoint(role_id: str, session: Session = Depends(get_session)) -> RolePermissionResponse:
    menu_codes, api_permission_codes = get_role_permissions(session, role_id=role_id)
    return RolePermissionResponse(
        role_id=role_id,
        menu_codes=menu_codes,
        api_permission_codes=api_permission_codes,
    )


@router.put("/roles/{role_id}/permissions", response_model=RolePermissionResponse)
def replace_role_permissions_endpoint(
    role_id: str,
    payload: UpdateRolePermissionRequest,
    session: Session = Depends(get_session),
) -> RolePermissionResponse:
    menu_codes, api_permission_codes = replace_role_permissions(
        session,
        role_id=role_id,
        menu_codes=payload.menu_codes,
        api_permission_codes=payload.api_permission_codes,
    )
    return RolePermissionResponse(
        role_id=role_id,
        menu_codes=menu_codes,
        api_permission_codes=api_permission_codes,
    )
