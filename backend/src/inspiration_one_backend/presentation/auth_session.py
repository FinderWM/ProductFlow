from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from fastapi import Request
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth_sessions import (
    ensure_utc,
    get_auth_session_global_state,
    parse_session_datetime,
    serialize_session_datetime,
    touch_user_last_seen_if_stale,
)
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.infrastructure.db.models import AuthUser


@dataclass(frozen=True, slots=True)
class AuthSessionValidation:
    user: AuthUser | None = None
    disabled: bool = False

    @property
    def authenticated(self) -> bool:
        return self.user is not None and not self.disabled


def write_login_session(request: Request, session: Session, user: AuthUser) -> None:
    now = now_utc()
    expires_at = now + timedelta(minutes=get_runtime_settings().auth_session_ttl_minutes)
    global_state = get_auth_session_global_state(session)
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["issued_at"] = serialize_session_datetime(now)
    request.session["expires_at"] = serialize_session_datetime(expires_at)
    request.session["policy_version"] = global_state.policy_version


def validate_auth_session(
    request: Request,
    session: Session,
    *,
    touch_last_seen: bool = True,
) -> AuthSessionValidation:
    user_id = request.session.get("user_id")
    issued_at = parse_session_datetime(request.session.get("issued_at"))
    expires_at = parse_session_datetime(request.session.get("expires_at"))
    policy_version = _parse_payload_policy_version(request.session.get("policy_version"))
    if not isinstance(user_id, str) or not user_id or issued_at is None or expires_at is None or policy_version is None:
        request.session.clear()
        return AuthSessionValidation()

    resolved_now = now_utc()
    if expires_at <= resolved_now:
        request.session.clear()
        return AuthSessionValidation()

    user = session.get(AuthUser, user_id)
    if user is None or user.archived_at is not None:
        request.session.clear()
        return AuthSessionValidation()
    if not user.enabled:
        request.session.clear()
        return AuthSessionValidation(disabled=True)

    user_revoked_after = ensure_utc(user.session_revoked_after)
    if user_revoked_after is not None and issued_at <= user_revoked_after:
        request.session.clear()
        return AuthSessionValidation()

    global_state = get_auth_session_global_state(session)
    if global_state.revoked_after is not None and issued_at <= global_state.revoked_after:
        request.session.clear()
        return AuthSessionValidation()
    if policy_version != global_state.policy_version:
        request.session.clear()
        return AuthSessionValidation()

    if touch_last_seen and touch_user_last_seen_if_stale(user, now=resolved_now):
        session.commit()

    return AuthSessionValidation(user=user)


def _parse_payload_policy_version(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 1 else None
    if isinstance(value, str):
        try:
            parsed = int(value)
        except ValueError:
            return None
        return parsed if parsed >= 1 else None
    return None
