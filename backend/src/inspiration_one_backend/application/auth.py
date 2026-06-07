from __future__ import annotations

import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.config import get_settings
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.domain.rbac import (
    ADMIN_ROLE_CODE,
    ADMIN_USER_ID,
    ADMIN_USERNAME,
    API_GLOBAL_TEMPLATES_MANAGE,
    API_PERMISSION_DEFINITIONS,
    API_SETTINGS_MIGRATE,
    API_SETTINGS_PROVIDER_WRITE,
    API_SETTINGS_READ,
    API_SETTINGS_WRITE,
    DEFAULT_ROLE_API_PERMISSION_CODES,
    DEFAULT_ROLE_CODE,
    DEFAULT_ROLE_MENU_CODES,
    MENU_DEFINITIONS,
)
from inspiration_one_backend.infrastructure.db.models import (
    AuthRole,
    AuthUser,
    GenerationResourceGroup,
    RbacApiPermission,
    RbacMenu,
    RoleApiPermission,
    RoleMenuPermission,
    UserGenerationResourceGroupGrant,
    utcnow,
)
from inspiration_one_backend.infrastructure.db.session import get_engine, get_session_factory
from inspiration_one_backend.infrastructure.provider_config import (
    ensure_provider_config_bootstrapped,
    require_generation_resource_group,
)

if TYPE_CHECKING:
    from collections.abc import Iterable

CLIENT_PASSWORD_MD5_RE = re.compile(r"^[0-9a-f]{32}$")
PASSWORD_HASH_PREFIX = "scrypt$"
PASSWORD_SETUP_TOKEN_HASH_PREFIX = "setup-sha256$"
PASSWORD_MIN_LENGTH = 6
PASSWORD_SCRYPT_N = 16384
PASSWORD_SCRYPT_R = 8
PASSWORD_SCRYPT_P = 1
PASSWORD_SCRYPT_DKLEN = 32
PASSWORD_SETUP_TOKEN_TTL = timedelta(days=7)
SESSION_USER_KEYS = ("user_id", "username", "role_id", "is_admin")


@dataclass(frozen=True, slots=True)
class UserPermissionState:
    menus: list[RbacMenu]
    api_permission_codes: list[str]


@dataclass(frozen=True, slots=True)
class RoleWithUserCount:
    role: AuthRole
    user_count: int


@dataclass(frozen=True, slots=True)
class PasswordCredential:
    secret: str
    legacy_client_md5: str


@dataclass(frozen=True, slots=True)
class PasswordSetupIssue:
    user: AuthUser
    setup_token: str


def normalize_username(username: str) -> str:
    normalized = username.strip()
    if not normalized:
        raise BusinessValidationError("账号不能为空")
    if len(normalized) > 80:
        raise BusinessValidationError("账号不能超过 80 个字符")
    return normalized


def normalize_client_password_md5(client_password_md5: str) -> str:
    normalized = client_password_md5.strip().lower()
    if not CLIENT_PASSWORD_MD5_RE.fullmatch(normalized):
        raise BusinessValidationError("密码摘要格式不正确")
    return normalized


def normalize_password_credential(
    *,
    password: str | None = None,
    client_password_md5: str | None = None,
) -> PasswordCredential:
    normalized_password = (password or "").strip()
    normalized_client_md5 = (client_password_md5 or "").strip()
    if normalized_password:
        if len(normalized_password) < PASSWORD_MIN_LENGTH:
            raise BusinessValidationError("密码至少 6 位")
        legacy_client_md5 = hashlib.md5(normalized_password.encode(), usedforsecurity=False).hexdigest()
        return PasswordCredential(secret=normalized_password, legacy_client_md5=legacy_client_md5)
    if normalized_client_md5:
        normalized_md5 = normalize_client_password_md5(normalized_client_md5)
        return PasswordCredential(secret=normalized_md5, legacy_client_md5=normalized_md5)
    raise BusinessValidationError("密码不能为空")


def password_hash(password_secret: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.scrypt(
        password_secret.encode(),
        salt=salt.encode(),
        n=PASSWORD_SCRYPT_N,
        r=PASSWORD_SCRYPT_R,
        p=PASSWORD_SCRYPT_P,
        dklen=PASSWORD_SCRYPT_DKLEN,
    ).hex()
    return f"{PASSWORD_HASH_PREFIX}{PASSWORD_SCRYPT_N}${PASSWORD_SCRYPT_R}${PASSWORD_SCRYPT_P}${salt}${derived}"


def user_has_password(user: AuthUser) -> bool:
    return bool(user.password_hash)


def auth_tables_available() -> bool:
    inspector = inspect(get_engine())
    return all(inspector.has_table(table_name) for table_name in ("auth_users", "auth_roles", "rbac_menus"))


def _legacy_password_hash(client_password_md5: str, salt: str) -> str:
    normalized = normalize_client_password_md5(client_password_md5)
    return hashlib.md5(f"{normalized}:{salt}".encode(), usedforsecurity=False).hexdigest()


def _verify_password_hash(credential: PasswordCredential, stored_hash: str, legacy_salt: str | None) -> bool:
    if stored_hash.startswith(PASSWORD_HASH_PREFIX):
        parts = stored_hash.split("$")
        if len(parts) != 6:
            return False
        _, n_text, r_text, p_text, salt, expected = parts
        try:
            derived = hashlib.scrypt(
                credential.secret.encode(),
                salt=salt.encode(),
                n=int(n_text),
                r=int(r_text),
                p=int(p_text),
                dklen=len(bytes.fromhex(expected)),
            ).hex()
        except (TypeError, ValueError):
            return False
        return secrets.compare_digest(expected, derived)
    if legacy_salt:
        return secrets.compare_digest(stored_hash, _legacy_password_hash(credential.legacy_client_md5, legacy_salt))
    return False


def _password_setup_token_hash(setup_token: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f"{setup_token}:{salt}".encode()).hexdigest()
    return f"{PASSWORD_SETUP_TOKEN_HASH_PREFIX}{salt}${digest}"


def _verify_password_setup_token(user: AuthUser, setup_token: str | None, *, now: datetime | None = None) -> bool:
    normalized_token = (setup_token or "").strip()
    stored_hash = user.password_setup_token_hash or ""
    if not normalized_token or not stored_hash.startswith(PASSWORD_SETUP_TOKEN_HASH_PREFIX):
        return False
    expires_at = user.password_setup_token_expires_at
    resolved_now = now or datetime.now(UTC)
    if expires_at is not None:
        normalized_expires_at = expires_at if expires_at.tzinfo is not None else expires_at.replace(tzinfo=UTC)
        if normalized_expires_at < resolved_now:
            return False
    payload = stored_hash.removeprefix(PASSWORD_SETUP_TOKEN_HASH_PREFIX)
    try:
        salt, expected = payload.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.sha256(f"{normalized_token}:{salt}".encode()).hexdigest()
    return secrets.compare_digest(expected, digest)


def _issue_password_setup_token(user: AuthUser, *, expires_at: datetime | None = None) -> str:
    setup_token = secrets.token_urlsafe(32)
    user.password_setup_token_hash = _password_setup_token_hash(setup_token)
    user.password_setup_token_expires_at = expires_at or datetime.now(UTC) + PASSWORD_SETUP_TOKEN_TTL
    user.updated_at = utcnow()
    return setup_token


def _clear_password_setup_token(user: AuthUser) -> None:
    user.password_setup_token_hash = None
    user.password_setup_token_expires_at = None


def ensure_auth_bootstrapped(session: Session | None = None) -> None:
    if session is None:
        factory = get_session_factory()
        with factory() as owned_session:
            ensure_auth_bootstrapped(owned_session)
        return

    admin_role = _ensure_role(session, code=ADMIN_ROLE_CODE, name="管理员", is_admin=True)
    default_role = _ensure_role(session, code=DEFAULT_ROLE_CODE, name="普通用户", is_admin=False)
    _ensure_admin_user(session, admin_role)
    _ensure_registry(session)
    _ensure_default_role_permissions(session, default_role)
    session.commit()


def set_initial_password(
    session: Session,
    *,
    username: str,
    setup_token: str | None = None,
    password: str | None = None,
    client_password_md5: str | None = None,
) -> AuthUser:
    ensure_auth_bootstrapped(session)
    user = get_user_by_username(session, username)
    if user is None:
        raise NotFoundError("账号不存在")
    if not user.enabled or user.archived_at is not None:
        raise BusinessValidationError("账号不可用")
    if user_has_password(user):
        raise BusinessValidationError("该账号已设置密码")
    if not _verify_password_setup_token(user, setup_token):
        raise BusinessValidationError("设密凭据无效或已过期")

    credential = normalize_password_credential(password=password, client_password_md5=client_password_md5)
    user.password_salt = None
    user.password_hash = password_hash(credential.secret)
    _clear_password_setup_token(user)
    user.updated_at = utcnow()
    session.commit()
    session.refresh(user)
    return user


def authenticate_user(
    session: Session,
    *,
    username: str,
    password: str | None = None,
    client_password_md5: str | None = None,
) -> AuthUser | None:
    ensure_auth_bootstrapped(session)
    user = get_user_by_username(session, username)
    if user is None or not user.enabled or user.archived_at is not None:
        return None
    if not user_has_password(user):
        return None
    credential = normalize_password_credential(password=password, client_password_md5=client_password_md5)
    if not _verify_password_hash(credential, user.password_hash or "", user.password_salt):
        return None
    if not (user.password_hash or "").startswith(PASSWORD_HASH_PREFIX) and (password or "").strip():
        user.password_hash = password_hash(credential.secret)
        user.password_salt = None
        user.updated_at = utcnow()
        session.commit()
        session.refresh(user)
    return user


def get_user_by_username(session: Session, username: str) -> AuthUser | None:
    normalized = normalize_username(username)
    return session.scalar(select(AuthUser).where(AuthUser.username == normalized))


def get_user_permission_state(session: Session, user: AuthUser) -> UserPermissionState:
    ensure_auth_bootstrapped(session)
    if user.is_admin:
        menus = list(session.scalars(select(RbacMenu).where(RbacMenu.enabled.is_(True)).order_by(RbacMenu.sort_order)))
        api_permission_codes = list(
            session.scalars(
                select(RbacApiPermission.code)
                .where(RbacApiPermission.enabled.is_(True))
                .order_by(RbacApiPermission.menu_code, RbacApiPermission.sort_order)
            )
        )
        return UserPermissionState(menus=menus, api_permission_codes=api_permission_codes)

    menus = list(
        session.scalars(
            select(RbacMenu)
            .join(RoleMenuPermission, RoleMenuPermission.menu_code == RbacMenu.code)
            .where(RoleMenuPermission.role_id == user.role_id, RbacMenu.enabled.is_(True))
            .order_by(RbacMenu.sort_order)
        )
    )
    api_permission_codes = list(
        session.scalars(
            select(RbacApiPermission.code)
            .join(RoleApiPermission, RoleApiPermission.permission_code == RbacApiPermission.code)
            .where(RoleApiPermission.role_id == user.role_id, RbacApiPermission.enabled.is_(True))
            .order_by(RbacApiPermission.menu_code, RbacApiPermission.sort_order)
        )
    )
    return UserPermissionState(menus=menus, api_permission_codes=api_permission_codes)


def user_has_api_permission(session: Session, user: AuthUser, permission_code: str) -> bool:
    if user.is_admin:
        return True
    return (
        session.scalar(
            select(RoleApiPermission.role_id)
            .join(RbacApiPermission, RbacApiPermission.code == RoleApiPermission.permission_code)
            .where(
                RoleApiPermission.role_id == user.role_id,
                RoleApiPermission.permission_code == permission_code,
                RbacApiPermission.enabled.is_(True),
            )
        )
        is not None
    )


def user_has_any_api_permission(session: Session, user: AuthUser, permission_codes: Iterable[str]) -> bool:
    if user.is_admin:
        return True
    normalized_codes = tuple(sorted(set(permission_codes)))
    if not normalized_codes:
        return False
    return (
        session.scalar(
            select(RoleApiPermission.role_id)
            .join(RbacApiPermission, RbacApiPermission.code == RoleApiPermission.permission_code)
            .where(
                RoleApiPermission.role_id == user.role_id,
                RoleApiPermission.permission_code.in_(normalized_codes),
                RbacApiPermission.enabled.is_(True),
            )
        )
        is not None
    )


def create_trusted_user(
    session: Session,
    *,
    username: str,
    display_name: str | None = None,
    role_id: str | None = None,
) -> PasswordSetupIssue:
    ensure_auth_bootstrapped(session)
    normalized_username = normalize_username(username)
    if get_user_by_username(session, normalized_username) is not None:
        raise BusinessValidationError("账号已存在")
    role = _get_role_or_default(session, role_id)
    if role.is_admin:
        raise BusinessValidationError("不能创建第二个管理员")
    user = AuthUser(
        username=normalized_username,
        display_name=(display_name or normalized_username).strip() or normalized_username,
        role_id=role.id,
        is_admin=False,
    )
    setup_token = _issue_password_setup_token(user)
    session.add(user)
    session.commit()
    session.refresh(user)
    return PasswordSetupIssue(user=user, setup_token=setup_token)


def reset_user_password(session: Session, *, user_id: str, actor: AuthUser) -> PasswordSetupIssue:
    ensure_auth_bootstrapped(session)
    user = _get_user_or_raise(session, user_id)
    if user.is_admin:
        raise BusinessValidationError("管理员密码重置请直接通过数据库处理")
    if user.id == actor.id:
        raise BusinessValidationError("不能重置自己的密码")
    user.password_hash = None
    user.password_salt = None
    setup_token = _issue_password_setup_token(user)
    user.updated_at = utcnow()
    session.commit()
    session.refresh(user)
    return PasswordSetupIssue(user=user, setup_token=setup_token)


def set_user_enabled(session: Session, *, user_id: str, enabled: bool) -> AuthUser:
    ensure_auth_bootstrapped(session)
    user = _get_user_or_raise(session, user_id)
    if user.is_admin and not enabled:
        raise BusinessValidationError("不能禁用管理员")
    user.enabled = enabled
    user.updated_at = utcnow()
    session.commit()
    session.refresh(user)
    return user


def list_users(
    session: Session,
    *,
    page: int = 1,
    page_size: int = 100,
    username: str | None = None,
    role_id: str | None = None,
) -> tuple[list[AuthUser], int]:
    ensure_auth_bootstrapped(session)
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    start = (page - 1) * page_size
    filters = [AuthUser.archived_at.is_(None)]
    normalized_username = username.strip() if username else ""
    if normalized_username:
        filters.append(AuthUser.username.ilike(f"%{normalized_username}%"))
    normalized_role_id = role_id.strip() if role_id else ""
    if normalized_role_id:
        filters.append(AuthUser.role_id == normalized_role_id)

    total = session.scalar(select(func.count()).select_from(AuthUser).where(*filters)) or 0
    users = session.scalars(
        select(AuthUser)
        .options(selectinload(AuthUser.role))
        .where(*filters)
        .order_by(AuthUser.is_admin.desc(), AuthUser.created_at)
        .offset(start)
        .limit(page_size)
    ).all()
    return list(users), total


def list_roles(session: Session) -> list[AuthRole]:
    ensure_auth_bootstrapped(session)
    return list(session.scalars(select(AuthRole).where(AuthRole.archived_at.is_(None)).order_by(AuthRole.created_at)))


def list_roles_with_user_counts(session: Session) -> list[RoleWithUserCount]:
    roles = list_roles(session)
    user_counts = {
        role_id: count
        for role_id, count in session.execute(
            select(AuthUser.role_id, func.count()).where(AuthUser.archived_at.is_(None)).group_by(AuthUser.role_id)
        )
    }
    return [RoleWithUserCount(role=role, user_count=user_counts.get(role.id, 0)) for role in roles]


def create_role(session: Session, *, code: str, name: str) -> AuthRole:
    ensure_auth_bootstrapped(session)
    normalized_code = _normalize_role_code(code)
    if session.scalar(select(AuthRole).where(AuthRole.code == normalized_code)) is not None:
        raise BusinessValidationError("角色编码已存在")
    role = AuthRole(code=normalized_code, name=_normalize_role_name(name), is_admin=False)
    session.add(role)
    session.commit()
    session.refresh(role)
    return role


def update_role(session: Session, *, role_id: str, name: str) -> AuthRole:
    ensure_auth_bootstrapped(session)
    role = _get_role_or_raise(session, role_id)
    if role.is_admin:
        raise BusinessValidationError("管理员角色不可编辑")
    role.name = _normalize_role_name(name)
    role.updated_at = utcnow()
    session.commit()
    session.refresh(role)
    return role


def archive_role(session: Session, *, role_id: str) -> AuthRole:
    ensure_auth_bootstrapped(session)
    role = _get_role_or_raise(session, role_id)
    if role.is_admin:
        raise BusinessValidationError("管理员角色不可删除")
    assigned_user = session.scalar(
        select(AuthUser.id).where(AuthUser.role_id == role.id, AuthUser.archived_at.is_(None))
    )
    if assigned_user is not None:
        raise BusinessValidationError("角色仍有用户使用")
    role.archived_at = utcnow()
    role.updated_at = utcnow()
    session.commit()
    session.refresh(role)
    return role


def get_role_permissions(session: Session, *, role_id: str) -> tuple[list[str], list[str]]:
    ensure_auth_bootstrapped(session)
    role = _get_role_or_raise(session, role_id)
    if role.is_admin:
        return (
            [definition.code for definition in MENU_DEFINITIONS],
            [definition.code for definition in API_PERMISSION_DEFINITIONS],
        )
    menu_codes = list(
        session.scalars(select(RoleMenuPermission.menu_code).where(RoleMenuPermission.role_id == role.id))
    )
    api_permission_codes = list(
        session.scalars(select(RoleApiPermission.permission_code).where(RoleApiPermission.role_id == role.id))
    )
    return menu_codes, api_permission_codes


def replace_role_permissions(
    session: Session,
    *,
    role_id: str,
    menu_codes: Iterable[str],
    api_permission_codes: Iterable[str],
) -> tuple[list[str], list[str]]:
    ensure_auth_bootstrapped(session)
    role = _get_role_or_raise(session, role_id)
    if role.is_admin:
        raise BusinessValidationError("管理员角色不可编辑权限")
    valid_menu_codes = {definition.code for definition in MENU_DEFINITIONS}
    valid_api_codes = {definition.code for definition in API_PERMISSION_DEFINITIONS}
    next_api_codes = _normalize_role_api_permission_codes(set(api_permission_codes) & valid_api_codes)
    next_menu_codes = _normalize_role_menu_codes(set(menu_codes) & valid_menu_codes, next_api_codes)

    session.query(RoleMenuPermission).filter(RoleMenuPermission.role_id == role.id).delete()
    session.query(RoleApiPermission).filter(RoleApiPermission.role_id == role.id).delete()
    session.add_all(RoleMenuPermission(role_id=role.id, menu_code=code) for code in next_menu_codes)
    session.add_all(RoleApiPermission(role_id=role.id, permission_code=code) for code in next_api_codes)
    session.commit()
    return next_menu_codes, next_api_codes


def list_available_generation_resource_groups_for_user(
    session: Session,
    *,
    user: AuthUser,
) -> list[GenerationResourceGroup]:
    ensure_auth_bootstrapped(session)
    ensure_provider_config_bootstrapped(session)
    if user.is_admin:
        return list(
            session.scalars(
                select(GenerationResourceGroup)
                .where(
                    GenerationResourceGroup.enabled.is_(True),
                    GenerationResourceGroup.archived_at.is_(None),
                )
                .order_by(
                    GenerationResourceGroup.sort_order,
                    GenerationResourceGroup.created_at,
                    GenerationResourceGroup.name,
                )
            ).all()
        )
    return list(
        session.scalars(
            select(GenerationResourceGroup)
            .join(
                UserGenerationResourceGroupGrant,
                UserGenerationResourceGroupGrant.resource_group_id == GenerationResourceGroup.id,
            )
            .where(
                UserGenerationResourceGroupGrant.user_id == user.id,
                GenerationResourceGroup.enabled.is_(True),
                GenerationResourceGroup.archived_at.is_(None),
            )
            .order_by(
                GenerationResourceGroup.sort_order,
                GenerationResourceGroup.created_at,
                GenerationResourceGroup.name,
            )
        ).all()
    )


def require_generation_resource_group_for_user(
    session: Session,
    *,
    user_id: str | None,
    is_admin: bool,
    resource_group_id: str | None,
) -> GenerationResourceGroup:
    ensure_auth_bootstrapped(session)
    ensure_provider_config_bootstrapped(session)
    normalized_group_id = str(resource_group_id or "").strip()
    if not normalized_group_id:
        raise BusinessValidationError("请选择供应商生成分组")
    try:
        group = require_generation_resource_group(session, normalized_group_id, require_enabled=True)
    except ValueError as exc:
        raise BusinessValidationError(str(exc)) from exc
    if is_admin:
        return group
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        raise BusinessValidationError("账号未授权使用该供应商生成分组")
    grant_exists = session.scalar(
        select(UserGenerationResourceGroupGrant.resource_group_id).where(
            UserGenerationResourceGroupGrant.user_id == normalized_user_id,
            UserGenerationResourceGroupGrant.resource_group_id == group.id,
        )
    )
    if grant_exists is None:
        raise BusinessValidationError("账号未授权使用该供应商生成分组")
    return group


def get_user_generation_resource_group_grant_ids(session: Session, *, user_id: str) -> list[str]:
    ensure_auth_bootstrapped(session)
    ensure_provider_config_bootstrapped(session)
    user = _get_user_or_raise(session, user_id)
    if user.is_admin:
        return list(
            session.scalars(
                select(GenerationResourceGroup.id)
                .where(
                    GenerationResourceGroup.enabled.is_(True),
                    GenerationResourceGroup.archived_at.is_(None),
                )
                .order_by(
                    GenerationResourceGroup.sort_order,
                    GenerationResourceGroup.created_at,
                    GenerationResourceGroup.name,
                )
            ).all()
        )
    return list(
        session.scalars(
            select(UserGenerationResourceGroupGrant.resource_group_id)
            .join(
                GenerationResourceGroup,
                GenerationResourceGroup.id == UserGenerationResourceGroupGrant.resource_group_id,
            )
            .where(
                UserGenerationResourceGroupGrant.user_id == user.id,
                GenerationResourceGroup.archived_at.is_(None),
            )
            .order_by(
                GenerationResourceGroup.sort_order,
                GenerationResourceGroup.created_at,
                GenerationResourceGroup.name,
            )
        ).all()
    )


def replace_user_generation_resource_group_grants(
    session: Session,
    *,
    user_id: str,
    resource_group_ids: Iterable[str],
) -> list[str]:
    ensure_auth_bootstrapped(session)
    ensure_provider_config_bootstrapped(session)
    user = _get_user_or_raise(session, user_id)
    if user.is_admin:
        raise BusinessValidationError("管理员账号默认拥有全部分组")
    normalized_ids = _dedupe_generation_resource_group_ids(resource_group_ids)
    for resource_group_id in normalized_ids:
        require_generation_resource_group(session, resource_group_id)
    session.query(UserGenerationResourceGroupGrant).filter(
        UserGenerationResourceGroupGrant.user_id == user.id,
    ).delete()
    session.add_all(
        UserGenerationResourceGroupGrant(user_id=user.id, resource_group_id=resource_group_id)
        for resource_group_id in normalized_ids
    )
    session.commit()
    return get_user_generation_resource_group_grant_ids(session, user_id=user.id)


def _ensure_role(session: Session, *, code: str, name: str, is_admin: bool) -> AuthRole:
    role = session.scalar(select(AuthRole).where(AuthRole.code == code))
    if role is not None:
        return role
    role = AuthRole(code=code, name=name, is_admin=is_admin)
    session.add(role)
    session.flush()
    return role


def _ensure_admin_user(session: Session, admin_role: AuthRole) -> AuthUser:
    user = session.scalar(select(AuthUser).where(AuthUser.username == ADMIN_USERNAME))
    if user is None:
        user = AuthUser(
            id=ADMIN_USER_ID,
            username=ADMIN_USERNAME,
            display_name=ADMIN_USERNAME,
            role_id=admin_role.id,
            is_admin=True,
        )
        session.add(user)
        session.flush()
        _ensure_admin_password_setup_token(user)
        return user
    if not user.is_admin or user.role_id != admin_role.id:
        user.is_admin = True
        user.role_id = admin_role.id
    _ensure_admin_password_setup_token(user)
    return user


def _ensure_admin_password_setup_token(user: AuthUser) -> None:
    if user_has_password(user):
        _clear_password_setup_token(user)
        return
    user.password_setup_token_hash = _password_setup_token_hash(get_settings().admin_access_key)
    user.password_setup_token_expires_at = None


def _normalize_role_api_permission_codes(permission_codes: set[str]) -> list[str]:
    next_api_codes = set(permission_codes)
    if next_api_codes & {
        API_SETTINGS_WRITE,
        API_SETTINGS_PROVIDER_WRITE,
        API_SETTINGS_MIGRATE,
        API_GLOBAL_TEMPLATES_MANAGE,
    }:
        next_api_codes.add(API_SETTINGS_READ)
    return sorted(next_api_codes)


def _normalize_role_menu_codes(menu_codes: set[str], api_permission_codes: Iterable[str]) -> list[str]:
    next_menu_codes = set(menu_codes)
    menu_code_by_permission = {definition.code: definition.menu_code for definition in API_PERMISSION_DEFINITIONS}
    next_menu_codes.update(
        menu_code_by_permission[permission_code]
        for permission_code in api_permission_codes
        if permission_code in menu_code_by_permission
    )
    return sorted(next_menu_codes)


def _ensure_registry(session: Session) -> None:
    for definition in MENU_DEFINITIONS:
        menu = session.get(RbacMenu, definition.code)
        if menu is None:
            session.add(RbacMenu(code=definition.code, title=definition.title, sort_order=definition.sort_order))
        else:
            menu.title = definition.title
            menu.sort_order = definition.sort_order
            menu.enabled = True

    for definition in API_PERMISSION_DEFINITIONS:
        permission = session.get(RbacApiPermission, definition.code)
        if permission is None:
            session.add(
                RbacApiPermission(
                    code=definition.code,
                    menu_code=definition.menu_code,
                    title=definition.title,
                    description=definition.description,
                    sort_order=definition.sort_order,
                )
            )
        else:
            permission.menu_code = definition.menu_code
            permission.title = definition.title
            permission.description = definition.description
            permission.sort_order = definition.sort_order
            permission.enabled = True
    session.flush()


def _ensure_default_role_permissions(session: Session, default_role: AuthRole) -> None:
    _ensure_role_menu_permissions(session, default_role.id, DEFAULT_ROLE_MENU_CODES)
    _ensure_role_api_permissions(session, default_role.id, DEFAULT_ROLE_API_PERMISSION_CODES)


def _ensure_role_menu_permissions(session: Session, role_id: str, menu_codes: Iterable[str]) -> None:
    existing = set(session.scalars(select(RoleMenuPermission.menu_code).where(RoleMenuPermission.role_id == role_id)))
    session.add_all(
        RoleMenuPermission(role_id=role_id, menu_code=menu_code)
        for menu_code in menu_codes
        if menu_code not in existing
    )


def _ensure_role_api_permissions(session: Session, role_id: str, permission_codes: Iterable[str]) -> None:
    existing = set(
        session.scalars(select(RoleApiPermission.permission_code).where(RoleApiPermission.role_id == role_id))
    )
    session.add_all(
        RoleApiPermission(role_id=role_id, permission_code=permission_code)
        for permission_code in permission_codes
        if permission_code not in existing
    )


def _get_role_or_default(session: Session, role_id: str | None) -> AuthRole:
    if role_id:
        return _get_role_or_raise(session, role_id)
    default_role = session.scalar(select(AuthRole).where(AuthRole.code == DEFAULT_ROLE_CODE))
    if default_role is None:
        raise BusinessValidationError("默认角色未初始化")
    return default_role


def _get_role_or_raise(session: Session, role_id: str) -> AuthRole:
    role = session.get(AuthRole, role_id)
    if role is None or role.archived_at is not None:
        raise NotFoundError("角色不存在")
    return role


def _get_user_or_raise(session: Session, user_id: str) -> AuthUser:
    user = session.get(AuthUser, user_id)
    if user is None or user.archived_at is not None:
        raise NotFoundError("用户不存在")
    return user


def _normalize_role_code(code: str) -> str:
    normalized = code.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_-]{1,39}", normalized):
        raise BusinessValidationError("角色编码只能包含小写字母、数字、下划线和连字符")
    return normalized


def _normalize_role_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise BusinessValidationError("角色名称不能为空")
    if len(normalized) > 80:
        raise BusinessValidationError("角色名称不能超过 80 个字符")
    return normalized


def _dedupe_generation_resource_group_ids(resource_group_ids: Iterable[str]) -> list[str]:
    normalized_ids: list[str] = []
    seen: set[str] = set()
    for raw_id in resource_group_ids:
        resource_group_id = str(raw_id or "").strip()
        if not resource_group_id or resource_group_id in seen:
            continue
        seen.add(resource_group_id)
        normalized_ids.append(resource_group_id)
    return normalized_ids
