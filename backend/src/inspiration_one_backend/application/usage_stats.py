from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.ownership import require_active_user_id
from inspiration_one_backend.infrastructure.db.models import AuthUser, UserDailyUsageStat
from inspiration_one_backend.infrastructure.provider_config import IMAGE_PURPOSE, TEXT_PURPOSE


@dataclass(slots=True)
class UserUsageStatsAggregate:
    attempt_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    timeout_count: int = 0
    throttled_count: int = 0
    generated_unit_count: int = 0
    total_latency_ms: int = 0
    text_attempt_count: int = 0
    image_attempt_count: int = 0
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class UserUsageStatsResult:
    start_date: date
    end_date: date
    items: list[UserDailyUsageStat]
    summary: UserUsageStatsAggregate
    users: list[AuthUser]


def record_user_usage_result(
    session: Session,
    *,
    user_id: str,
    purpose: str,
    success: bool,
    latency_ms: int = 0,
    generated_unit_count: int = 1,
    timeout: bool = False,
    throttled: bool = False,
    now: datetime,
) -> None:
    if purpose not in {TEXT_PURPOSE, IMAGE_PURPOSE}:
        raise ValueError("用途必须是 text 或 image")
    stat = _usage_stat_for_update(session, user_id=user_id, purpose=purpose, now=now)
    stat.attempt_count += 1
    stat.generated_unit_count += max(0, int(generated_unit_count or 0))
    stat.total_latency_ms += max(0, int(latency_ms or 0))
    if success:
        stat.success_count += 1
        stat.last_success_at = now
    else:
        stat.failure_count += 1
        if timeout:
            stat.timeout_count += 1
        if throttled:
            stat.throttled_count += 1
        stat.last_failure_at = now
    session.flush()


def list_user_usage_stats(
    session: Session,
    *,
    start_date: date,
    end_date: date,
    user_id: str | None = None,
) -> UserUsageStatsResult:
    statement = (
        select(UserDailyUsageStat)
        .options(selectinload(UserDailyUsageStat.user))
        .where(
            UserDailyUsageStat.stat_date >= start_date,
            UserDailyUsageStat.stat_date <= end_date,
        )
        .order_by(UserDailyUsageStat.stat_date.desc(), UserDailyUsageStat.purpose)
    )
    if user_id is not None:
        statement = statement.where(UserDailyUsageStat.user_id == user_id)
    items = list(session.scalars(statement))
    return UserUsageStatsResult(
        start_date=start_date,
        end_date=end_date,
        items=items,
        summary=_aggregate_usage_stats(items),
        users=list_usage_stat_users(session),
    )


def list_usage_stat_users(session: Session) -> list[AuthUser]:
    return list(
        session.scalars(
            select(AuthUser).where(AuthUser.archived_at.is_(None)).order_by(AuthUser.is_admin.desc(), AuthUser.username)
        )
    )


def resolve_usage_stat_user(
    session: Session,
    *,
    user_id: str | None = None,
    username: str | None = None,
) -> AuthUser | None:
    normalized_username = (username or "").strip()
    if user_id:
        return session.scalar(select(AuthUser).where(AuthUser.id == user_id, AuthUser.archived_at.is_(None)))
    if normalized_username:
        return session.scalar(
            select(AuthUser).where(AuthUser.username == normalized_username, AuthUser.archived_at.is_(None))
        )
    return None


def _usage_stat_for_update(
    session: Session,
    *,
    user_id: str,
    purpose: str,
    now: datetime,
) -> UserDailyUsageStat:
    normalized_user_id = require_active_user_id(session, user_id, missing_message="用户不存在")
    stat_date = _local_stat_date(now)
    stat = session.scalar(
        select(UserDailyUsageStat).where(
            UserDailyUsageStat.user_id == normalized_user_id,
            UserDailyUsageStat.stat_date == stat_date,
            UserDailyUsageStat.purpose == purpose,
        )
    )
    if stat is None:
        stat = UserDailyUsageStat(user_id=normalized_user_id, stat_date=stat_date, purpose=purpose)
        session.add(stat)
        session.flush()
    return stat


def _aggregate_usage_stats(items: list[UserDailyUsageStat]) -> UserUsageStatsAggregate:
    summary = UserUsageStatsAggregate()
    for item in items:
        summary.attempt_count += item.attempt_count
        summary.success_count += item.success_count
        summary.failure_count += item.failure_count
        summary.timeout_count += item.timeout_count
        summary.throttled_count += item.throttled_count
        summary.generated_unit_count += item.generated_unit_count
        summary.total_latency_ms += item.total_latency_ms
        if item.purpose == TEXT_PURPOSE:
            summary.text_attempt_count += item.attempt_count
        if item.purpose == IMAGE_PURPOSE:
            summary.image_attempt_count += item.attempt_count
        if item.last_success_at is not None and (
            summary.last_success_at is None or item.last_success_at > summary.last_success_at
        ):
            summary.last_success_at = item.last_success_at
        if item.last_failure_at is not None and (
            summary.last_failure_at is None or item.last_failure_at > summary.last_failure_at
        ):
            summary.last_failure_at = item.last_failure_at
    return summary


def _local_stat_date(value: datetime) -> date:
    if value.tzinfo is None:
        return value.astimezone().date()
    return value.astimezone().date()
