from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from productflow_backend.infrastructure.db.models import (
    GenerationConfig,
    GenerationConfigDailyStat,
    GenerationConfigState,
)
from productflow_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    TEXT_PURPOSE,
    add_generation_config,
    claim_generation_config,
    ensure_provider_config_bootstrapped,
    list_generation_configs,
    release_generation_config_claim,
    update_generation_config,
)


def _add_mock_config(
    session: Session,
    *,
    purpose: str,
    name: str,
    priority: int = 100,
    max_concurrency: int = 1,
    enabled: bool = True,
    failure_threshold: int = 3,
) -> GenerationConfig:
    return add_generation_config(
        session,
        name=name,
        purpose=purpose,
        provider_kind="mock",
        provider_profile_id=None,
        model_settings=(
            {"brief_model": "mock-brief", "copy_model": "mock-copy"}
            if purpose == TEXT_PURPOSE
            else {"model": "mock-image"}
        ),
        config={},
        priority=priority,
        max_concurrency=max_concurrency,
        enabled=enabled,
        availability_window_minutes=5,
        failure_threshold=failure_threshold,
        cooldown_minutes=10,
    )


def test_bootstrap_creates_default_generation_configs_and_states(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)

    configs = list_generation_configs(db_session)
    purposes = {item.purpose for item in configs}
    state_ids = set(db_session.scalars(select(GenerationConfigState.generation_config_id)).all())

    assert purposes == {TEXT_PURPOSE, IMAGE_PURPOSE}
    assert {item.id for item in configs}.issubset(state_ids)


def test_auto_claim_prefers_higher_priority_healthy_config(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    preferred = _add_mock_config(db_session, purpose=IMAGE_PURPOSE, name="高优先级图片", priority=200)

    claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE)

    assert claim is not None
    assert claim.generation_config_id == preferred.id


def test_claim_respects_max_concurrency(db_session: Session) -> None:
    config = _add_mock_config(db_session, purpose=IMAGE_PURPOSE, name="单并发图片", max_concurrency=1)

    first_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=config.id)
    second_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=config.id)

    assert first_claim is not None
    assert second_claim is None


def test_manual_disabled_config_raises_clear_error(db_session: Session) -> None:
    config = _add_mock_config(db_session, purpose=TEXT_PURPOSE, name="停用文案")
    update_generation_config(db_session, config.id, enabled=False)

    with pytest.raises(ValueError, match="手动指定的生成配置已停用"):
        claim_generation_config(db_session, purpose=TEXT_PURPOSE, generation_config_id=config.id)


def test_manual_full_or_frozen_config_returns_none(db_session: Session) -> None:
    full_config = _add_mock_config(db_session, purpose=IMAGE_PURPOSE, name="满并发图片", max_concurrency=1)
    first_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=full_config.id)

    assert first_claim is not None
    assert claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=full_config.id) is None

    frozen_config = _add_mock_config(db_session, purpose=IMAGE_PURPOSE, name="冻结图片", max_concurrency=1)
    state = db_session.get(GenerationConfigState, frozen_config.id)
    assert state is not None
    state.frozen_until = datetime.now(UTC) + timedelta(minutes=10)
    db_session.commit()

    assert claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=frozen_config.id) is None


def test_release_updates_stats_and_freeze_window(db_session: Session) -> None:
    config = _add_mock_config(
        db_session,
        purpose=TEXT_PURPOSE,
        name="统计文案",
        failure_threshold=2,
    )
    first_claim = claim_generation_config(db_session, purpose=TEXT_PURPOSE, generation_config_id=config.id)
    assert first_claim is not None

    release_generation_config_claim(
        db_session,
        config.id,
        success=False,
        latency_ms=120,
        generated_unit_count=0,
        failure_reason="provider error",
    )
    db_session.commit()

    state = db_session.get(GenerationConfigState, config.id)
    stat = db_session.scalar(
        select(GenerationConfigDailyStat).where(GenerationConfigDailyStat.generation_config_id == config.id)
    )
    assert state is not None
    assert stat is not None
    assert state.current_concurrency == 0
    assert state.failure_count_in_window == 1
    assert stat.attempt_count == 1
    assert stat.failure_count == 1

    success_claim = claim_generation_config(db_session, purpose=TEXT_PURPOSE, generation_config_id=config.id)
    assert success_claim is not None
    release_generation_config_claim(db_session, config.id, success=True, generated_unit_count=2)
    db_session.commit()
    db_session.refresh(state)
    db_session.refresh(stat)

    assert state.current_concurrency == 0
    assert state.failure_count_in_window == 0
    assert state.failure_window_started_at is None
    assert state.last_failure_reason is None
    assert stat.attempt_count == 2
    assert stat.success_count == 1
    assert stat.generated_unit_count == 2

    for reason in ("first failure", "second failure"):
        claim = claim_generation_config(db_session, purpose=TEXT_PURPOSE, generation_config_id=config.id)
        assert claim is not None
        release_generation_config_claim(
            db_session,
            config.id,
            success=False,
            generated_unit_count=0,
            failure_reason=reason,
        )
    db_session.commit()
    db_session.refresh(state)
    db_session.refresh(stat)

    assert state.current_concurrency == 0
    assert state.frozen_until is not None
    frozen_until = (
        state.frozen_until if state.frozen_until.tzinfo is not None else state.frozen_until.replace(tzinfo=UTC)
    )
    assert frozen_until > datetime.now(UTC)
    assert state.failure_count_in_window == 0
    assert stat.failure_count == 3
    assert stat.freeze_count == 1
