from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.infrastructure.db.models import AppSetting, AuthUser

AUTH_SESSIONS_REVOKED_AFTER_KEY = "auth_sessions_revoked_after"
AUTH_SESSION_POLICY_VERSION_KEY = "auth_session_policy_version"
AUTH_SESSION_DEFAULT_POLICY_VERSION = 1
AUTH_SESSION_LAST_SEEN_UPDATE_INTERVAL = timedelta(minutes=5)
AUTH_SESSION_POSSIBLY_ONLINE_WINDOW = timedelta(minutes=5)


@dataclass(frozen=True, slots=True)
class AuthSessionGlobalState:
    revoked_after: datetime | None
    policy_version: int


def ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def parse_session_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return ensure_utc(parsed)


def serialize_session_datetime(value: datetime) -> str:
    resolved = ensure_utc(value) or value
    return resolved.isoformat()


def get_auth_session_global_state(session: Session) -> AuthSessionGlobalState:
    revoked_after_row = session.get(AppSetting, AUTH_SESSIONS_REVOKED_AFTER_KEY)
    policy_version_row = session.get(AppSetting, AUTH_SESSION_POLICY_VERSION_KEY)
    return AuthSessionGlobalState(
        revoked_after=parse_session_datetime(revoked_after_row.value) if revoked_after_row is not None else None,
        policy_version=_parse_policy_version(policy_version_row.value if policy_version_row is not None else None),
    )


def revoke_all_auth_sessions(session: Session, *, now: datetime | None = None) -> None:
    resolved_now = ensure_utc(now) or now_utc()
    state = get_auth_session_global_state(session)
    _upsert_app_setting(session, AUTH_SESSIONS_REVOKED_AFTER_KEY, serialize_session_datetime(resolved_now))
    _upsert_app_setting(session, AUTH_SESSION_POLICY_VERSION_KEY, str(state.policy_version + 1))


def mark_user_sessions_revoked(user: AuthUser, *, now: datetime | None = None) -> None:
    resolved_now = ensure_utc(now) or now_utc()
    user.session_revoked_after = resolved_now
    user.updated_at = resolved_now


def record_user_login(user: AuthUser, *, now: datetime | None = None) -> None:
    resolved_now = ensure_utc(now) or now_utc()
    user.last_login_at = resolved_now
    user.last_seen_at = resolved_now
    user.updated_at = resolved_now


def touch_user_last_seen_if_stale(user: AuthUser, *, now: datetime | None = None) -> bool:
    resolved_now = ensure_utc(now) or now_utc()
    last_seen_at = ensure_utc(user.last_seen_at)
    if last_seen_at is not None and resolved_now - last_seen_at < AUTH_SESSION_LAST_SEEN_UPDATE_INTERVAL:
        return False
    user.last_seen_at = resolved_now
    return True


def auth_user_possibly_online(user: AuthUser, *, now: datetime | None = None) -> bool:
    last_seen_at = ensure_utc(user.last_seen_at)
    if last_seen_at is None:
        return False
    resolved_now = ensure_utc(now) or now_utc()
    return resolved_now - last_seen_at <= AUTH_SESSION_POSSIBLY_ONLINE_WINDOW


def _parse_policy_version(value: object) -> int:
    try:
        policy_version = int(value)
    except (TypeError, ValueError):
        return AUTH_SESSION_DEFAULT_POLICY_VERSION
    return max(policy_version, AUTH_SESSION_DEFAULT_POLICY_VERSION)


def _upsert_app_setting(session: Session, key: str, value: str) -> None:
    existing = session.get(AppSetting, key)
    if existing is None:
        session.add(AppSetting(key=key, value=value))
    else:
        existing.value = value
