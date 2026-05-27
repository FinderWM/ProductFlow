from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter

from fastapi.testclient import TestClient
from helpers import _login
from sqlalchemy.orm import Session

from productflow_backend.application.auth import ensure_auth_bootstrapped
from productflow_backend.application.generation_config_runtime import (
    RuntimeGenerationConfigClaim,
    release_runtime_generation_config,
)
from productflow_backend.application.usage_stats import list_user_usage_stats, record_user_usage_result
from productflow_backend.domain.rbac import ADMIN_USER_ID
from productflow_backend.infrastructure.db.models import AuthUser, UserDailyUsageStat
from productflow_backend.infrastructure.db.session import get_session_factory
from productflow_backend.infrastructure.provider_config import IMAGE_PURPOSE, TEXT_PURPOSE, GenerationConfigClaim


def _password_md5(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def _create_user_client(app, admin_client: TestClient, username: str) -> tuple[TestClient, str]:
    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": username, "display_name": username.title()},
    )
    assert created_user.status_code == 201
    user_id = created_user.json()["id"]

    client = TestClient(app)
    password_md5 = _password_md5(f"{username}-password")
    set_password = client.post(
        "/api/auth/password",
        json={"username": username, "client_password_md5": password_md5},
    )
    assert set_password.status_code == 200
    return client, user_id


def _runtime_claim() -> RuntimeGenerationConfigClaim:
    return RuntimeGenerationConfigClaim(
        claim=GenerationConfigClaim(
            generation_config_id="generation-config-1",
            purpose=TEXT_PURPOSE,
            provider_kind="mock",
            score=1.0,
        ),
        started_perf_counter=perf_counter(),
    )


def test_release_runtime_generation_config_records_user_stats_before_global_stats(
    configured_env: Path,
    monkeypatch,
) -> None:
    calls: list[str] = []

    class FakeSession:
        def commit(self) -> None:
            calls.append("commit")

        def rollback(self) -> None:
            calls.append("rollback")

        def close(self) -> None:
            calls.append("close")

    fake_session = FakeSession()
    monkeypatch.setattr(
        "productflow_backend.application.generation_config_runtime.get_session_factory",
        lambda: lambda: fake_session,
    )
    monkeypatch.setattr(
        "productflow_backend.application.generation_config_runtime.record_user_usage_result",
        lambda session, **kwargs: calls.append("user_stats"),
    )
    monkeypatch.setattr(
        "productflow_backend.application.generation_config_runtime.release_generation_config_claim",
        lambda session, generation_config_id, **kwargs: calls.append("global_stats"),
    )

    release_runtime_generation_config(_runtime_claim(), success=True, user_id="user-1", generated_unit_count=2)

    assert calls == ["user_stats", "global_stats", "commit", "close"]


def test_release_runtime_generation_config_skips_user_stats_when_result_is_not_recorded(
    configured_env: Path,
    monkeypatch,
) -> None:
    calls: list[str] = []

    class FakeSession:
        def commit(self) -> None:
            calls.append("commit")

        def rollback(self) -> None:
            calls.append("rollback")

        def close(self) -> None:
            calls.append("close")

    monkeypatch.setattr(
        "productflow_backend.application.generation_config_runtime.get_session_factory",
        lambda: lambda: FakeSession(),
    )
    monkeypatch.setattr(
        "productflow_backend.application.generation_config_runtime.record_user_usage_result",
        lambda session, **kwargs: calls.append("user_stats"),
    )
    monkeypatch.setattr(
        "productflow_backend.application.generation_config_runtime.release_generation_config_claim",
        lambda session, generation_config_id, **kwargs: calls.append("global_stats"),
    )

    release_runtime_generation_config(_runtime_claim(), success=False, user_id="user-1", record_result=False)

    assert calls == ["global_stats", "commit", "close"]


def test_user_usage_stats_aggregate_counts_text_image_timeout_and_throttled(db_session: Session) -> None:
    ensure_auth_bootstrapped(db_session)
    user = db_session.get(AuthUser, ADMIN_USER_ID)
    assert user is not None
    now = datetime.now(UTC)

    record_user_usage_result(
        db_session,
        user_id=user.id,
        purpose=TEXT_PURPOSE,
        success=True,
        latency_ms=120,
        generated_unit_count=2,
        now=now,
    )
    record_user_usage_result(
        db_session,
        user_id=user.id,
        purpose=IMAGE_PURPOSE,
        success=False,
        latency_ms=80,
        generated_unit_count=0,
        timeout=True,
        throttled=True,
        now=now,
    )
    db_session.commit()

    result = list_user_usage_stats(
        db_session,
        start_date=now.astimezone().date(),
        end_date=now.astimezone().date(),
        user_id=user.id,
    )

    assert result.summary.attempt_count == 2
    assert result.summary.success_count == 1
    assert result.summary.failure_count == 1
    assert result.summary.timeout_count == 1
    assert result.summary.throttled_count == 1
    assert result.summary.generated_unit_count == 2
    assert result.summary.total_latency_ms == 200
    assert result.summary.text_attempt_count == 1
    assert result.summary.image_attempt_count == 1
    assert {item.purpose for item in result.items} == {TEXT_PURPOSE, IMAGE_PURPOSE}


def test_usage_stats_api_self_only_and_admin_filters(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    admin_state = admin_client.get("/api/auth/session")
    assert admin_state.status_code == 200
    admin_id = admin_state.json()["user"]["id"]
    alice_client, alice_id = _create_user_client(app, admin_client, "alice")

    today = datetime.now().astimezone().date()
    session = get_session_factory()()
    try:
        session.add_all(
            [
                UserDailyUsageStat(
                    user_id=admin_id,
                    stat_date=today,
                    purpose=TEXT_PURPOSE,
                    attempt_count=3,
                    success_count=2,
                    failure_count=1,
                    generated_unit_count=4,
                    total_latency_ms=300,
                    last_success_at=datetime.now(UTC) - timedelta(minutes=2),
                ),
                UserDailyUsageStat(
                    user_id=alice_id,
                    stat_date=today,
                    purpose=IMAGE_PURPOSE,
                    attempt_count=5,
                    success_count=5,
                    generated_unit_count=5,
                    total_latency_ms=700,
                    last_success_at=datetime.now(UTC),
                ),
            ]
        )
        session.commit()
    finally:
        session.close()

    forbidden = alice_client.get("/api/usage-stats", params={"user_id": admin_id})
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "只能查看自己的统计"

    alice_stats = alice_client.get("/api/usage-stats")
    assert alice_stats.status_code == 200
    alice_payload = alice_stats.json()
    assert alice_payload["selected_user_id"] == alice_id
    assert alice_payload["summary"]["attempt_count"] == 5
    assert {item["user_id"] for item in alice_payload["items"]} == {alice_id}
    assert alice_payload["users"] == []

    admin_by_username = admin_client.get("/api/usage-stats", params={"username": "alice"})
    assert admin_by_username.status_code == 200
    username_payload = admin_by_username.json()
    assert username_payload["selected_user_id"] == alice_id
    assert username_payload["summary"]["attempt_count"] == 5
    assert {item["user_id"] for item in username_payload["items"]} == {alice_id}
    assert {user["username"] for user in username_payload["users"]} >= {"libow", "alice"}

    admin_by_id = admin_client.get("/api/usage-stats", params={"user_id": admin_id})
    assert admin_by_id.status_code == 200
    id_payload = admin_by_id.json()
    assert id_payload["selected_user_id"] == admin_id
    assert id_payload["summary"]["attempt_count"] == 3
    assert {item["user_id"] for item in id_payload["items"]} == {admin_id}
