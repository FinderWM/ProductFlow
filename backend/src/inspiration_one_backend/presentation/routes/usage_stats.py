from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from inspiration_one_backend.application.usage_stats import (
    list_user_usage_stats,
    resolve_usage_stat_user,
)
from inspiration_one_backend.domain.rbac import API_USAGE_STATS_READ
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.presentation.deps import get_session, require_api_permission
from inspiration_one_backend.presentation.schemas.usage_stats import (
    UserUsageStatsResponse,
    serialize_usage_stat,
    serialize_usage_stat_summary,
    serialize_usage_stat_user,
)

router = APIRouter(prefix="/api/usage-stats", tags=["usage-stats"])


@router.get("", response_model=UserUsageStatsResponse)
def get_usage_stats_endpoint(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    user_id: str | None = Query(default=None),
    username: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_USAGE_STATS_READ)),
) -> UserUsageStatsResponse:
    today = datetime.now().astimezone().date()
    range_start = start_date or end_date or today
    range_end = end_date or range_start
    if range_end < range_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="日期范围无效")

    selected_user_id: str | None
    if current_user.is_admin:
        selected_user = resolve_usage_stat_user(session, user_id=user_id, username=username)
        if (user_id or username) and selected_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在")
        selected_user_id = selected_user.id if selected_user is not None else None
    else:
        if user_id and user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能查看自己的统计")
        if username and username != current_user.username:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能查看自己的统计")
        selected_user_id = current_user.id

    result = list_user_usage_stats(
        session,
        start_date=range_start,
        end_date=range_end,
        user_id=selected_user_id,
    )
    return UserUsageStatsResponse(
        start_date=result.start_date.isoformat(),
        end_date=result.end_date.isoformat(),
        selected_user_id=selected_user_id,
        items=[serialize_usage_stat(item) for item in result.items],
        summary=serialize_usage_stat_summary(result.summary),
        users=[serialize_usage_stat_user(user) for user in result.users] if current_user.is_admin else [],
    )
