from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from productflow_backend.application.usage_stats import UserUsageStatsAggregate
from productflow_backend.infrastructure.db.models import AuthUser, UserDailyUsageStat


class UserUsageStatsUserResponse(BaseModel):
    id: str
    username: str
    display_name: str
    is_admin: bool


class UserUsageStatsSummaryResponse(BaseModel):
    attempt_count: int
    success_count: int
    failure_count: int
    timeout_count: int
    throttled_count: int
    generated_unit_count: int
    total_latency_ms: int
    text_attempt_count: int
    image_attempt_count: int
    last_success_at: str | None = None
    last_failure_at: str | None = None


class UserUsageStatResponse(BaseModel):
    id: str
    user_id: str
    username: str
    display_name: str
    stat_date: str
    purpose: str
    attempt_count: int
    success_count: int
    failure_count: int
    timeout_count: int
    throttled_count: int
    generated_unit_count: int
    total_latency_ms: int
    last_success_at: str | None = None
    last_failure_at: str | None = None
    created_at: str
    updated_at: str


class UserUsageStatsResponse(BaseModel):
    start_date: str
    end_date: str
    selected_user_id: str | None = None
    items: list[UserUsageStatResponse] = Field(default_factory=list)
    summary: UserUsageStatsSummaryResponse
    users: list[UserUsageStatsUserResponse] = Field(default_factory=list)


def serialize_usage_stat_user(user: AuthUser) -> UserUsageStatsUserResponse:
    return UserUsageStatsUserResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        is_admin=user.is_admin,
    )


def serialize_usage_stat_summary(summary: UserUsageStatsAggregate) -> UserUsageStatsSummaryResponse:
    return UserUsageStatsSummaryResponse(
        attempt_count=summary.attempt_count,
        success_count=summary.success_count,
        failure_count=summary.failure_count,
        timeout_count=summary.timeout_count,
        throttled_count=summary.throttled_count,
        generated_unit_count=summary.generated_unit_count,
        total_latency_ms=summary.total_latency_ms,
        text_attempt_count=summary.text_attempt_count,
        image_attempt_count=summary.image_attempt_count,
        last_success_at=_serialize_dt(summary.last_success_at),
        last_failure_at=_serialize_dt(summary.last_failure_at),
    )


def serialize_usage_stat(stat: UserDailyUsageStat) -> UserUsageStatResponse:
    user = stat.user
    return UserUsageStatResponse(
        id=stat.id,
        user_id=stat.user_id,
        username=user.username if user else "",
        display_name=user.display_name if user else "",
        stat_date=stat.stat_date.isoformat(),
        purpose=stat.purpose,
        attempt_count=stat.attempt_count,
        success_count=stat.success_count,
        failure_count=stat.failure_count,
        timeout_count=stat.timeout_count,
        throttled_count=stat.throttled_count,
        generated_unit_count=stat.generated_unit_count,
        total_latency_ms=stat.total_latency_ms,
        last_success_at=_serialize_dt(stat.last_success_at),
        last_failure_at=_serialize_dt(stat.last_failure_at),
        created_at=stat.created_at.isoformat(),
        updated_at=stat.updated_at.isoformat(),
    )


def _serialize_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None
