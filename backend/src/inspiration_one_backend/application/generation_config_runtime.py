from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Any, Literal

from dramatiq.middleware.time_limit import TimeLimitExceeded
from sqlalchemy.orm import Session

from inspiration_one_backend.application.usage_stats import record_user_usage_result
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    TEXT_PURPOSE,
    GenerationConfigClaim,
    claim_generation_config,
    release_generation_config_claim,
)

GENERATION_CONFIG_RETRY_DELAY_MS = 2000
GenerationConfigMode = Literal["auto", "manual"]


class GenerationConfigWaitError(RuntimeError):
    """Raised when a generation config exists but is temporarily unavailable."""


@dataclass(frozen=True, slots=True)
class GenerationConfigSelection:
    mode: GenerationConfigMode = "auto"
    generation_config_id: str | None = None
    resource_group_id: str | None = None
    required_max_dimension: int | None = None


@dataclass(slots=True)
class RuntimeGenerationConfigClaim:
    claim: GenerationConfigClaim
    started_perf_counter: float

    @property
    def generation_config_id(self) -> str:
        return self.claim.generation_config_id

    @property
    def purpose(self) -> str:
        return self.claim.purpose

    @property
    def resource_group_id(self) -> str:
        return self.claim.resource_group_id


def generation_config_selection_from_config(raw_config: dict[str, Any] | None) -> GenerationConfigSelection:
    config = raw_config or {}
    mode = str(config.get("generation_config_mode") or "auto").strip().lower()
    generation_config_id = _optional_text(config.get("generation_config_id"))
    resource_group_id = _optional_text(config.get("resource_group_id"))
    if mode != "manual":
        return GenerationConfigSelection(mode="auto", generation_config_id=None, resource_group_id=resource_group_id)
    return GenerationConfigSelection(
        mode="manual",
        generation_config_id=generation_config_id,
        resource_group_id=resource_group_id,
    )


def generation_config_id_for_claim(selection: GenerationConfigSelection) -> str | None:
    if selection.mode != "manual":
        return None
    if not selection.generation_config_id:
        raise BusinessValidationError("手动指定生成配置时必须选择配置")
    return selection.generation_config_id


def claim_runtime_generation_config(
    *,
    purpose: Literal["text", "image"],
    selection: GenerationConfigSelection | None = None,
    session: Session | None = None,
) -> RuntimeGenerationConfigClaim:
    if purpose not in {TEXT_PURPOSE, IMAGE_PURPOSE}:
        raise BusinessValidationError("用途必须是 text 或 image")
    resolved_selection = selection or GenerationConfigSelection()
    owns_session = session is None
    working_session = session or get_session_factory()()
    try:
        claim = claim_generation_config(
            working_session,
            purpose=purpose,
            resource_group_id=resolved_selection.resource_group_id,
            generation_config_id=generation_config_id_for_claim(resolved_selection),
            required_max_dimension=resolved_selection.required_max_dimension,
        )
        if claim is None:
            if owns_session:
                working_session.commit()
            raise GenerationConfigWaitError("生成配置暂时不可用，等待并发容量或冷冻期恢复")
        if owns_session:
            working_session.commit()
        return RuntimeGenerationConfigClaim(claim=claim, started_perf_counter=perf_counter())
    except Exception:
        if owns_session:
            working_session.rollback()
        raise
    finally:
        if owns_session:
            working_session.close()


def release_runtime_generation_config(
    runtime_claim: RuntimeGenerationConfigClaim | None,
    *,
    success: bool,
    session: Session | None = None,
    user_id: str | None = None,
    generated_unit_count: int = 1,
    failure_reason: str | None = None,
    timeout: bool = False,
    throttled: bool = False,
    record_result: bool = True,
) -> None:
    if runtime_claim is None:
        return
    latency_ms = int(max(0.0, perf_counter() - runtime_claim.started_perf_counter) * 1000)
    owns_session = session is None
    working_session = session or get_session_factory()()
    try:
        now = datetime.now(UTC)
        if user_id is not None and record_result:
            record_user_usage_result(
                working_session,
                user_id=user_id,
                purpose=runtime_claim.purpose,
                success=success,
                latency_ms=latency_ms,
                generated_unit_count=generated_unit_count,
                timeout=timeout,
                throttled=throttled,
                now=now,
            )
        release_generation_config_claim(
            working_session,
            runtime_claim.generation_config_id,
            success=success,
            latency_ms=latency_ms,
            generated_unit_count=generated_unit_count,
            failure_reason=failure_reason,
            timeout=timeout,
            throttled=throttled,
            record_result=record_result,
            now=now,
        )
        if owns_session:
            working_session.commit()
    except Exception:
        if owns_session:
            working_session.rollback()
        raise
    finally:
        if owns_session:
            working_session.close()


def generation_failure_reason(exc: BaseException) -> str:
    return str(exc)[:1000] or type(exc).__name__


def generation_failure_is_timeout(exc: BaseException) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    return isinstance(exc, TimeLimitExceeded)


def generation_failure_is_throttled(exc: BaseException) -> bool:
    for current in _iter_exception_chain(exc):
        category = getattr(current, "failure_category", None)
        if category in {"rate_limit", "quota"}:
            return True
        status_code = getattr(current, "status_code", None)
        response = getattr(current, "response", None)
        response_status_code = getattr(response, "status_code", None)
        if status_code == 429 or response_status_code == 429:
            return True
        message = str(current).lower()
        if any(token in message for token in ("rate limit", "rate_limit", "too many requests", "quota")):
            return True
        if "限流" in message or "配额" in message:
            return True
    return False


def _iter_exception_chain(exc: BaseException):
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def _optional_text(value: Any) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None
