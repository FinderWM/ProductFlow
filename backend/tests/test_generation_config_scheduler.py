from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    GenerationConfig,
    GenerationConfigDailyStat,
    GenerationConfigResourceGroup,
    GenerationConfigState,
    GenerationResourceGroup,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    TEXT_PURPOSE,
    _ensure_generation_config_state,
    add_generation_config,
    add_generation_resource_group,
    claim_generation_config,
    create_provider_profile,
    ensure_provider_config_bootstrapped,
    list_generation_configs,
    list_generation_resource_groups,
    release_generation_config_claim,
    unfreeze_generation_config,
    update_generation_config,
    update_provider_profile,
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
    resource_group_id: str | None = DEFAULT_GENERATION_RESOURCE_GROUP_ID,
) -> GenerationConfig:
    return add_generation_config(
        session,
        resource_group_id=resource_group_id,
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
    default_group = db_session.get(GenerationResourceGroup, DEFAULT_GENERATION_RESOURCE_GROUP_ID)

    assert purposes == {TEXT_PURPOSE, IMAGE_PURPOSE}
    assert {item.id for item in configs}.issubset(state_ids)
    assert default_group is not None
    assert default_group.key == "default"
    assert {item.resource_group_id for item in configs} == {DEFAULT_GENERATION_RESOURCE_GROUP_ID}


def test_generation_config_state_requires_existing_config(db_session: Session) -> None:
    with pytest.raises(ValueError, match="生成配置不存在"):
        _ensure_generation_config_state(db_session, "missing-generation-config")


def test_list_generation_resource_groups_orders_by_priority_desc(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    premium = add_generation_resource_group(db_session, key="premium", name="高优先级分组", sort_order=300)
    campaign = add_generation_resource_group(db_session, key="campaign", name="活动分组", sort_order=100)

    groups = list_generation_resource_groups(db_session)

    assert [group.id for group in groups[:3]] == [premium.id, campaign.id, DEFAULT_GENERATION_RESOURCE_GROUP_ID]


def test_auto_claim_prefers_higher_priority_healthy_config(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    preferred = _add_mock_config(db_session, purpose=IMAGE_PURPOSE, name="高优先级图片", priority=200)

    claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE)

    assert claim is not None
    assert claim.generation_config_id == preferred.id
    assert claim.resource_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID


def test_claim_generation_config_is_scoped_by_resource_group(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    group = add_generation_resource_group(db_session, key="campaign", name="活动分组")
    grouped_config = _add_mock_config(
        db_session,
        purpose=IMAGE_PURPOSE,
        name="活动图片",
        priority=1000,
        resource_group_id=group.id,
    )

    default_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE)
    grouped_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE, resource_group_id=group.id)

    assert default_claim is not None
    assert default_claim.generation_config_id != grouped_config.id
    assert default_claim.resource_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID
    assert grouped_claim is not None
    assert grouped_claim.generation_config_id == grouped_config.id
    assert grouped_claim.resource_group_id == group.id


def test_generation_config_can_be_claimed_from_multiple_resource_groups(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    campaign = add_generation_resource_group(db_session, key="campaign", name="活动分组")
    seasonal = add_generation_resource_group(db_session, key="seasonal", name="季节分组")
    shared_config = _add_mock_config(
        db_session,
        purpose=TEXT_PURPOSE,
        name="共享文案",
        priority=1000,
        max_concurrency=2,
        resource_group_id=None,
    )

    update_generation_config(db_session, shared_config.id, resource_group_ids=[campaign.id, seasonal.id])

    campaign_claim = claim_generation_config(db_session, purpose=TEXT_PURPOSE, resource_group_id=campaign.id)
    seasonal_claim = claim_generation_config(db_session, purpose=TEXT_PURPOSE, resource_group_id=seasonal.id)
    db_session.refresh(shared_config)

    assert campaign_claim is not None
    assert campaign_claim.generation_config_id == shared_config.id
    assert campaign_claim.resource_group_id == campaign.id
    assert seasonal_claim is not None
    assert seasonal_claim.generation_config_id == shared_config.id
    assert seasonal_claim.resource_group_id == seasonal.id
    assert shared_config.resource_group_id == campaign.id
    assert {
        link.resource_group_id
        for link in db_session.scalars(
            select(GenerationConfigResourceGroup).where(
                GenerationConfigResourceGroup.generation_config_id == shared_config.id
            )
        )
    } == {campaign.id, seasonal.id}


def test_unbound_generation_config_is_not_claimed_by_group_scheduler(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    unbound_config = _add_mock_config(
        db_session,
        purpose=IMAGE_PURPOSE,
        name="未绑定图片",
        priority=1000,
        resource_group_id=None,
    )
    group = add_generation_resource_group(db_session, key="empty-campaign", name="空活动分组")

    default_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE)
    grouped_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE, resource_group_id=group.id)

    assert unbound_config.resource_group_id is None
    assert default_claim is not None
    assert default_claim.generation_config_id != unbound_config.id
    assert default_claim.resource_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID
    assert grouped_claim is None


def test_update_generation_config_can_clear_resource_group(db_session: Session) -> None:
    config = _add_mock_config(db_session, purpose=TEXT_PURPOSE, name="可清除文案")

    update_generation_config(db_session, config.id, name="可清除文案重命名")
    db_session.refresh(config)
    assert config.resource_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID

    update_generation_config(db_session, config.id, resource_group_id=None)
    db_session.refresh(config)
    assert config.resource_group_id is None


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


def test_disabled_provider_makes_generation_config_effectively_unavailable(db_session: Session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    profile = create_provider_profile(
        db_session,
        name="停用供应商",
        base_url=None,
        api_key="secret",
        capabilities=["text_responses"],
    )
    config = add_generation_config(
        db_session,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        name="真实文案",
        purpose=TEXT_PURPOSE,
        provider_kind="openai",
        provider_profile_id=profile.id,
        model_settings={"brief_model": "gpt-4.1", "copy_model": "gpt-4.1"},
        config={},
        priority=1000,
        max_concurrency=1,
        enabled=True,
        availability_window_minutes=5,
        failure_threshold=3,
        cooldown_minutes=10,
    )

    update_provider_profile(db_session, profile.id, enabled=False)

    auto_claim = claim_generation_config(db_session, purpose=TEXT_PURPOSE)
    assert auto_claim is None or auto_claim.generation_config_id != config.id
    db_session.refresh(config)
    assert config.enabled is True
    with pytest.raises(ValueError, match="手动指定的生成配置供应商不可用"):
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


def test_unfreeze_generation_config_clears_frozen_state_and_allows_claim(db_session: Session) -> None:
    config = _add_mock_config(db_session, purpose=IMAGE_PURPOSE, name="手动恢复图片")
    state = db_session.get(GenerationConfigState, config.id)
    assert state is not None
    state.frozen_until = datetime.now(UTC) + timedelta(minutes=10)
    state.failure_window_started_at = datetime.now(UTC)
    state.failure_count_in_window = 2
    db_session.commit()

    restored = unfreeze_generation_config(db_session, config.id)
    db_session.refresh(state)

    assert restored.id == config.id
    assert state.frozen_until is None
    assert state.failure_window_started_at is None
    assert state.failure_count_in_window == 0
    assert claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=config.id) is not None


def test_release_generation_config_claim_decrements_from_database_value(db_session: Session) -> None:
    config = _add_mock_config(db_session, purpose=IMAGE_PURPOSE, name="双并发图片", max_concurrency=2)
    first_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=config.id)
    second_claim = claim_generation_config(db_session, purpose=IMAGE_PURPOSE, generation_config_id=config.id)
    assert first_claim is not None
    assert second_claim is not None
    db_session.commit()

    factory = get_session_factory()
    first_session = factory()
    second_session = factory()
    try:
        first_state = first_session.get(GenerationConfigState, config.id)
        second_state = second_session.get(GenerationConfigState, config.id)
        assert first_state is not None
        assert second_state is not None
        assert first_state.current_concurrency == 2
        assert second_state.current_concurrency == 2

        release_generation_config_claim(first_session, config.id, success=True, record_result=False)
        first_session.commit()
        release_generation_config_claim(second_session, config.id, success=True, record_result=False)
        second_session.commit()
    finally:
        first_session.close()
        second_session.close()

    db_session.expire_all()
    state = db_session.get(GenerationConfigState, config.id)
    assert state is not None
    assert state.current_concurrency == 0
