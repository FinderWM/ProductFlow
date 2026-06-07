from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from inspiration_one_backend.application.admission import get_generation_queue_overview
from inspiration_one_backend.domain.rbac import API_STATUS_READ
from inspiration_one_backend.presentation.deps import get_session, require_api_permission
from inspiration_one_backend.presentation.schemas.generation_queue import (
    GenerationQueueOverviewResponse,
    serialize_generation_queue_overview,
)

router = APIRouter(
    prefix="/api/generation-queue",
    tags=["generation-queue"],
    dependencies=[Depends(require_api_permission(API_STATUS_READ))],
)


@router.get("", response_model=GenerationQueueOverviewResponse)
def get_generation_queue_overview_endpoint(session: Session = Depends(get_session)) -> GenerationQueueOverviewResponse:
    return serialize_generation_queue_overview(get_generation_queue_overview(session))
