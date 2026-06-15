from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path

import itsdangerous.timed
import pytest
from fastapi.testclient import TestClient
from helpers import _login
from sqlalchemy import select

from inspiration_one_backend.config import (
    CONFIG_DEFINITION_BY_KEY,
    RUNTIME_CONFIG_KEYS,
    build_settings_with_overrides,
    get_runtime_settings,
    get_settings,
    normalize_config_values,
)
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    AppSetting,
    GenerationConfig,
    GenerationConfigDailyStat,
    GenerationConfigResourceGroup,
    GenerationConfigState,
    GenerationConfigTestResult,
    GenerationResourceGroup,
    ImageSession,
    ImageSessionRound,
    ProviderBinding,
    ProviderProfile,
    UserUiPreference,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.openai_client import (
    OPENAI_COMPATIBLE_DEFAULT_HEADERS,
    OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
)
from inspiration_one_backend.infrastructure.provider_config import (
    resolve_image_provider_config,
    resolve_text_provider_config,
)


def test_auth_session_required(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)

    unauthorized = client.get("/api/inspirations", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert unauthorized.status_code == 401

    admin_key_login = client.post("/api/auth/session", json={"admin_key": "wrong-admin-key"})
    assert admin_key_login.status_code == 401
    assert admin_key_login.json()["detail"] == "请使用账号密码登录"

    wrong_password = client.post("/api/auth/login", json={"username": "libow", "password": "wrong-admin-password"})
    assert wrong_password.status_code == 401
    assert wrong_password.json()["detail"] == "账号或密码不正确"

    _login(client)

    authorized = client.get("/api/inspirations", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert authorized.status_code == 200
    assert authorized.json()["items"] == []


def test_user_ui_preferences_require_login(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)

    response = client.get("/api/settings/ui-preferences")

    assert response.status_code == 401
    assert response.json()["detail"] == "请先登录"


def test_user_ui_preferences_default_to_masking_and_persist(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    initial = client.get("/api/settings/ui-preferences")

    assert initial.status_code == 200
    payload = initial.json()
    assert payload["ui_layout_scheme"] == "classic"
    assert payload["mask_sensitive_images_in_inspirations"] is True
    assert payload["mask_sensitive_images_in_image_chat"] is True

    session = get_session_factory()()
    try:
        preferences = session.get(UserUiPreference, payload["user_id"])
        assert preferences is not None
        assert preferences.ui_layout_scheme == "classic"
        assert preferences.mask_sensitive_images_in_inspirations is True
        assert preferences.mask_sensitive_images_in_image_chat is True
    finally:
        session.close()


def test_user_ui_preferences_initial_layout_uses_global_default(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    updated_config = client.patch("/api/settings", json={"values": {"ui_layout_scheme": "workspace"}})
    assert updated_config.status_code == 200

    initial_preferences = client.get("/api/settings/ui-preferences")
    assert initial_preferences.status_code == 200
    payload = initial_preferences.json()
    assert payload["ui_layout_scheme"] == "workspace"

    session = get_session_factory()()
    try:
        preferences = session.get(UserUiPreference, payload["user_id"])
        assert preferences is not None
        assert preferences.ui_layout_scheme == "workspace"
    finally:
        session.close()


def test_user_ui_preferences_patch_updates_only_submitted_fields(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    updated_inspirations = client.patch(
        "/api/settings/ui-preferences",
        json={"mask_sensitive_images_in_inspirations": False},
    )

    assert updated_inspirations.status_code == 200
    inspirations_payload = updated_inspirations.json()
    assert inspirations_payload["mask_sensitive_images_in_inspirations"] is False
    assert inspirations_payload["mask_sensitive_images_in_image_chat"] is True

    updated_image_chat = client.patch(
        "/api/settings/ui-preferences",
        json={"mask_sensitive_images_in_image_chat": False},
    )

    assert updated_image_chat.status_code == 200
    image_chat_payload = updated_image_chat.json()
    assert image_chat_payload["ui_layout_scheme"] == "classic"
    assert image_chat_payload["mask_sensitive_images_in_inspirations"] is False
    assert image_chat_payload["mask_sensitive_images_in_image_chat"] is False

    updated_layout = client.patch(
        "/api/settings/ui-preferences",
        json={"ui_layout_scheme": "workspace"},
    )

    assert updated_layout.status_code == 200
    layout_payload = updated_layout.json()
    assert layout_payload["ui_layout_scheme"] == "workspace"
    assert layout_payload["mask_sensitive_images_in_inspirations"] is False
    assert layout_payload["mask_sensitive_images_in_image_chat"] is False

    reloaded = client.get("/api/settings/ui-preferences")
    assert reloaded.status_code == 200
    assert reloaded.json()["ui_layout_scheme"] == "workspace"
    assert reloaded.json()["mask_sensitive_images_in_inspirations"] is False
    assert reloaded.json()["mask_sensitive_images_in_image_chat"] is False


def test_user_ui_preferences_reject_invalid_layout_scheme(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.patch(
        "/api/settings/ui-preferences",
        json={"ui_layout_scheme": "future"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "不支持的 UI 布局方案"


def test_auth_session_survives_small_wall_clock_rollback(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    current_timestamp = 1_800_000_000
    monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: current_timestamp)
    app = create_app()
    client = TestClient(app)

    _login(client)

    current_timestamp -= 2
    authorized = client.get("/api/inspirations", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})

    assert authorized.status_code == 200
    assert authorized.json()["items"] == []


def test_session_signer_does_not_keep_large_future_timestamp_after_clock_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.session import MonotonicTimestampSigner

    current_timestamp = 1_800_000_000
    monkeypatch.setattr(itsdangerous.timed.time, "time", lambda: current_timestamp)
    signer = MonotonicTimestampSigner("super-secret-session-key-123")

    future_signed = signer.sign(b"payload")
    current_timestamp -= 60
    recovered_signed = signer.sign(b"payload")

    assert signer.unsign(recovered_signed) == b"payload"
    assert future_signed != recovered_signed


def test_admin_access_required_setting_no_longer_bypasses_account_login(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    disabled = admin_client.patch("/api/settings", json={"values": {"admin_access_required": False}})
    assert disabled.status_code == 400
    assert "未知配置项" in disabled.json()["detail"]

    public_client = TestClient(app)
    public_inspirations = public_client.get(
        "/api/inspirations",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
    )
    assert public_inspirations.status_code == 401

    session_state = public_client.get("/api/auth/session")
    assert session_state.status_code == 200
    assert session_state.json()["authenticated"] is False
    assert session_state.json()["access_required"] is True

    locked_settings = public_client.get("/api/settings")
    assert locked_settings.status_code == 401

    _login(public_client)
    assert (
        public_client.get(
            "/api/inspirations",
            params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        ).status_code
        == 200
    )

    new_client = TestClient(app)
    private_inspirations = new_client.get(
        "/api/inspirations",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
    )
    assert private_inspirations.status_code == 401

    required_session = new_client.get("/api/auth/session")
    assert required_session.status_code == 200
    assert required_session.json()["authenticated"] is False
    assert required_session.json()["access_required"] is True


def test_settings_api_uses_rbac_without_extra_unlock(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    config = client.get("/api/settings")
    assert config.status_code == 200
    payload = config.json()
    assert "super-secret-admin-key" not in str(payload)

    relogin = client.post(
        "/api/auth/login",
        json={"username": "libow", "password": "super-secret-admin-key"},
    )
    assert relogin.status_code == 200

    relogin_config = client.get("/api/settings")
    assert relogin_config.status_code == 200


def test_runtime_config_registry_excludes_env_only_settings(configured_env: Path) -> None:
    assert RUNTIME_CONFIG_KEYS == set(CONFIG_DEFINITION_BY_KEY)
    assert {
        "admin_access_key",
        "session_secret",
        "database_url",
        "redis_url",
    }.isdisjoint(RUNTIME_CONFIG_KEYS)


def test_legacy_generation_capacity_setting_seeds_split_capacity_defaults(configured_env: Path) -> None:
    settings = build_settings_with_overrides({"generation_max_concurrent_tasks": "7"})

    assert settings.text_generation_max_concurrent_tasks == 7
    assert settings.image_generation_max_concurrent_tasks == 7


def test_runtime_config_ignores_database_rows_for_env_only_settings(configured_env: Path) -> None:
    session = get_session_factory()()
    try:
        session.add(AppSetting(key="admin_access_key", value="database-admin-key"))
        session.add(AppSetting(key="session_secret", value="database-session-secret-123"))
        session.add(AppSetting(key="database_url", value="sqlite:///database-override.db"))
        session.add(AppSetting(key="redis_url", value="redis://database-override:6379/0"))
        session.commit()
    finally:
        session.close()

    settings = get_runtime_settings()
    assert settings.admin_access_key == "super-secret-admin-key"
    assert settings.session_secret == "super-secret-session-key-123"
    assert settings.database_url != "sqlite:///database-override.db"
    assert settings.redis_url == "redis://localhost:6379/9"


def test_settings_api_has_no_extra_unlock_dependency(
    configured_env: Path,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    config = client.get("/api/settings")
    assert config.status_code == 200


def test_public_login_page_config_returns_configured_template_without_auth(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    updated = admin_client.patch(
        "/api/settings",
        json={
            "values": {
                "login_page_mode": "image-lab",
                "login_page_image_lab_config": {
                    "hero_description": "用一张视觉邀请函进入创作现场。",
                    "hero_image_asset_id": "",
                },
            }
        },
    )
    assert updated.status_code == 200

    response = TestClient(app).get("/api/public/login-page-config")

    assert response.status_code == 200
    assert response.json() == {
        "template_id": "image-lab",
        "template_name": "Image Lab",
        "content": {"hero_description": "用一张视觉邀请函进入创作现场。"},
        "assets": {"hero_image": "/hero.png"},
    }


def test_public_login_page_config_random_uses_all_templates(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app
    from inspiration_one_backend.presentation.routes import public

    app = create_app()
    seen_candidates: dict[str, tuple[str, ...]] = {}

    def choose_last(candidates: tuple[str, ...]) -> str:
        seen_candidates["value"] = candidates
        return candidates[-1]

    monkeypatch.setattr(public.random, "choice", choose_last)

    response = TestClient(app).get("/api/public/login-page-config")

    assert response.status_code == 200
    assert seen_candidates["value"] == ("command-orbit", "fluid-mist", "image-lab")
    assert response.json()["template_id"] == "image-lab"


def test_public_login_page_config_migrates_legacy_selected_template(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    session = get_session_factory()()
    try:
        session.add(AppSetting(key="login_page_mode", value="selected"))
        session.add(AppSetting(key="login_page_selected_template_id", value="fluid-mist"))
        session.add(AppSetting(key="login_page_fluid_mist_greeting_title", value="从旧字段迁移"))
        session.commit()
    finally:
        session.close()

    app = create_app()
    response = TestClient(app).get("/api/public/login-page-config")

    assert response.status_code == 200
    assert response.json()["template_id"] == "fluid-mist"
    assert response.json()["content"]["greeting_title"] == "从旧字段迁移"


def test_settings_api_persists_database_overrides(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    initial = client.get("/api/settings")
    assert initial.status_code == 200
    initial_items = {item["key"]: item for item in initial.json()["items"]}
    assert {
        "text_provider_kind",
        "text_api_key",
        "text_base_url",
        "text_brief_model",
        "text_copy_model",
        "image_provider_kind",
        "image_api_key",
        "image_base_url",
        "image_generate_model",
        "image_images_quality",
        "image_images_style",
        "image_responses_background_enabled",
    }.isdisjoint(initial_items)
    assert "generation_max_concurrent_tasks" not in initial_items
    assert initial_items["text_generation_max_concurrent_tasks"]["value"] == 3
    assert initial_items["text_generation_max_concurrent_tasks"]["category"] == "全局生成配置 / 队列容量"
    assert initial_items["image_generation_max_concurrent_tasks"]["value"] == 3
    assert initial_items["image_generation_max_concurrent_tasks"]["category"] == "全局生成配置 / 队列容量"
    assert initial_items["generation_tail_splitter_max_items"]["value"] == 36
    assert initial_items["generation_tail_splitter_max_items"]["category"] == "全局生成配置 / 工作流生成"
    assert initial_items["generation_tail_splitter_max_items"]["minimum"] == 1
    assert initial_items["generation_tail_splitter_max_items"]["maximum"] == 100
    assert initial_items["image_session_max_base_images"]["value"] == 6
    assert initial_items["image_session_max_base_images"]["category"] == "全局生成配置 / 文/图生图"
    assert initial_items["image_session_max_base_images"]["minimum"] == 0
    assert initial_items["image_session_max_base_images"]["maximum"] == 20
    assert initial_items["workflow_node_max_retry_count"]["value"] == 10
    assert initial_items["workflow_node_max_retry_count"]["category"] == "全局生成配置 / 工作流生成"
    assert initial_items["workflow_node_max_retry_count"]["minimum"] == 0
    assert initial_items["workflow_node_max_retry_count"]["maximum"] == 100
    assert initial_items["workflow_node_retry_delay_ms"]["value"] == 2000
    assert initial_items["workflow_node_retry_delay_ms"]["category"] == "全局生成配置 / 工作流生成"
    assert initial_items["workflow_node_retry_delay_ms"]["minimum"] == 0
    assert initial_items["workflow_node_retry_delay_ms"]["maximum"] == 60 * 60 * 1000
    assert initial_items["image_session_stale_running_after_minutes"]["value"] == 90
    assert initial_items["image_session_stale_running_after_minutes"]["category"] == "全局生成配置 / 任务恢复"
    assert initial_items["image_session_stale_running_after_minutes"]["minimum"] == 1
    assert initial_items["image_session_stale_running_after_minutes"]["maximum"] == 24 * 60
    assert "progress heartbeat" in initial_items["image_session_stale_running_after_minutes"]["description"]
    assert initial_items["workflow_image_generation_provider_timeout_seconds"]["value"] == 15 * 60
    assert (
        initial_items["workflow_image_generation_provider_timeout_seconds"]["category"] == "全局生成配置 / 工作流生成"
    )
    assert initial_items["workflow_image_generation_provider_timeout_seconds"]["minimum"] == 1
    assert initial_items["workflow_image_generation_provider_timeout_seconds"]["maximum"] == 24 * 60 * 60
    assert initial_items["ui_layout_scheme"]["value"] == "classic"
    assert initial_items["ui_layout_scheme"]["category"] == "界面与外观"
    assert initial_items["ui_layout_scheme"]["input_type"] == "select"
    assert initial_items["ui_layout_scheme"]["options"] == [
        {"value": "classic", "label": "经典"},
        {"value": "workspace", "label": "工作台"},
    ]
    assert initial_items["gallery_show_generation_resource_group"]["value"] is True
    assert initial_items["gallery_show_generation_resource_group"]["category"] == "界面与外观"
    assert initial_items["gallery_show_generation_resource_group"]["input_type"] == "boolean"
    assert initial_items["login_page_mode"]["value"] == "random"
    assert initial_items["login_page_mode"]["category"] == "登录页"
    assert initial_items["login_page_mode"]["input_type"] == "select"
    assert initial_items["login_page_mode"]["options"] == [
        {"value": "random", "label": "随机"},
        {"value": "command-orbit", "label": "Command Orbit"},
        {"value": "fluid-mist", "label": "Fluid Mist"},
        {"value": "image-lab", "label": "Image Lab"},
    ]
    assert initial_items["login_page_command_orbit_config"]["input_type"] == "textarea"
    assert "brand_subtitle" in initial_items["login_page_command_orbit_config"]["value"]
    assert initial_items["login_page_image_lab_config"]["input_type"] == "textarea"
    assert "hero_image_asset_id" in initial_items["login_page_image_lab_config"]["value"]
    assert "login_page_selected_template_id" not in initial_items
    assert "login_page_enabled_template_ids" not in initial_items
    assert "admin_access_required" not in initial_items
    assert initial_items["deletion_enabled"]["value"] is False
    assert initial_items["deletion_enabled"]["category"] == "安全与运维"

    updated = client.patch(
        "/api/settings",
        json={
            "values": {
                "text_generation_max_concurrent_tasks": 2,
                "image_generation_max_concurrent_tasks": 4,
                "generation_tail_splitter_max_items": 48,
                "image_session_max_base_images": 7,
                "workflow_node_max_retry_count": 12,
                "workflow_node_retry_delay_ms": 5000,
                "image_session_stale_running_after_minutes": 75,
                "workflow_image_generation_provider_timeout_seconds": 120,
                "ui_layout_scheme": "workspace",
                "gallery_show_generation_resource_group": False,
                "login_page_mode": "fluid-mist",
                "login_page_fluid_mist_config": {
                    "greeting_title": "进入雾面工作台",
                    "greeting_description": "继续整理灵感",
                },
                "deletion_enabled": True,
            }
        },
    )
    assert updated.status_code == 200
    assert get_runtime_settings().text_generation_max_concurrent_tasks == 2
    assert get_runtime_settings().image_generation_max_concurrent_tasks == 4
    assert get_runtime_settings().generation_tail_splitter_max_items == 48
    assert get_runtime_settings().image_session_max_base_images == 7
    assert get_runtime_settings().workflow_node_max_retry_count == 12
    assert get_runtime_settings().workflow_node_retry_delay_ms == 5000
    assert get_runtime_settings().image_session_stale_running_after_minutes == 75
    assert get_runtime_settings().workflow_image_generation_provider_timeout_seconds == 120
    assert get_runtime_settings().ui_layout_scheme == "workspace"
    assert get_runtime_settings().gallery_show_generation_resource_group is False
    assert get_runtime_settings().login_page_mode == "fluid-mist"
    assert get_runtime_settings().deletion_enabled is True

    session = get_session_factory()()
    try:
        assert session.get(AppSetting, "text_generation_max_concurrent_tasks").value == "2"
        assert session.get(AppSetting, "image_generation_max_concurrent_tasks").value == "4"
        assert session.get(AppSetting, "generation_tail_splitter_max_items").value == "48"
        assert session.get(AppSetting, "image_session_max_base_images").value == "7"
        assert session.get(AppSetting, "workflow_node_max_retry_count").value == "12"
        assert session.get(AppSetting, "workflow_node_retry_delay_ms").value == "5000"
        assert session.get(AppSetting, "image_session_stale_running_after_minutes").value == "75"
        assert session.get(AppSetting, "workflow_image_generation_provider_timeout_seconds").value == "120"
        assert session.get(AppSetting, "ui_layout_scheme").value == "workspace"
        assert session.get(AppSetting, "gallery_show_generation_resource_group").value == "false"
        assert session.get(AppSetting, "login_page_mode").value == "fluid-mist"
        assert "进入雾面工作台" in session.get(AppSetting, "login_page_fluid_mist_config").value
    finally:
        session.close()

    invalid_timeout = client.patch(
        "/api/settings",
        json={"values": {"image_session_stale_running_after_minutes": 0}},
    )
    assert invalid_timeout.status_code == 400
    assert "不能小于 1" in invalid_timeout.json()["detail"]

    invalid_layout = client.patch(
        "/api/settings",
        json={"values": {"ui_layout_scheme": "future"}},
    )
    assert invalid_layout.status_code == 400
    assert "默认 UI 布局 必须是以下之一" in invalid_layout.json()["detail"]

    invalid_login_page = client.patch(
        "/api/settings",
        json={"values": {"login_page_mode": "selected"}},
    )
    assert invalid_login_page.status_code == 400
    assert "登录页选择 必须是以下之一" in invalid_login_page.json()["detail"]

    invalid_workflow_timeout = client.patch(
        "/api/settings",
        json={"values": {"workflow_image_generation_provider_timeout_seconds": 0}},
    )
    assert invalid_workflow_timeout.status_code == 400
    assert "不能小于 1" in invalid_workflow_timeout.json()["detail"]

    invalid_tail_limit = client.patch(
        "/api/settings",
        json={"values": {"generation_tail_splitter_max_items": 101}},
    )
    assert invalid_tail_limit.status_code == 400
    assert "不能大于 100" in invalid_tail_limit.json()["detail"]

    invalid_node_retry_limit = client.patch(
        "/api/settings",
        json={"values": {"workflow_node_max_retry_count": -1}},
    )
    assert invalid_node_retry_limit.status_code == 400
    assert "不能小于 0" in invalid_node_retry_limit.json()["detail"]

    invalid_node_retry_delay = client.patch(
        "/api/settings",
        json={"values": {"workflow_node_retry_delay_ms": -1}},
    )
    assert invalid_node_retry_delay.status_code == 400
    assert "不能小于 0" in invalid_node_retry_delay.json()["detail"]

    invalid_base_limit = client.patch(
        "/api/settings",
        json={"values": {"image_session_max_base_images": 21}},
    )
    assert invalid_base_limit.status_code == 400
    assert "不能大于 20" in invalid_base_limit.json()["detail"]

    legacy_provider_update = client.patch("/api/settings", json={"values": {"image_provider_kind": "openai_images"}})
    assert legacy_provider_update.status_code == 400
    assert "未知配置项: image_provider_kind" in legacy_provider_update.json()["detail"]


def test_login_page_settings_endpoints_save_and_reset_independently(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    template_update = client.patch(
        "/api/settings/login-page-template-config/image-lab",
        json={"config": {"hero_description": "独立大图说明", "hero_image_asset_id": "asset-1"}},
    )
    assert template_update.status_code == 200
    template_items = {item["key"]: item for item in template_update.json()["items"]}
    assert template_items["login_page_mode"]["value"] == "random"
    assert template_items["login_page_mode"]["source"] == "env_default"
    assert "asset-1" in template_items["login_page_image_lab_config"]["value"]

    selection_update = client.patch("/api/settings/login-page-selection", json={"value": "fluid-mist"})
    assert selection_update.status_code == 200
    selection_items = {item["key"]: item for item in selection_update.json()["items"]}
    assert selection_items["login_page_mode"]["value"] == "fluid-mist"
    assert "asset-1" in selection_items["login_page_image_lab_config"]["value"]

    command_update = client.patch(
        "/api/settings/login-page-template-config/command-orbit",
        json={
            "config": {
                "brand_subtitle": "Orbit",
                "hero_title": "Console",
                "hero_description": "Command copy",
            }
        },
    )
    assert command_update.status_code == 200
    command_items = {item["key"]: item for item in command_update.json()["items"]}
    assert command_items["login_page_mode"]["value"] == "fluid-mist"
    assert "Command copy" in command_items["login_page_command_orbit_config"]["value"]
    assert "asset-1" in command_items["login_page_image_lab_config"]["value"]

    reset_selection = client.post("/api/settings/login-page-selection/reset")
    assert reset_selection.status_code == 200
    reset_selection_items = {item["key"]: item for item in reset_selection.json()["items"]}
    assert reset_selection_items["login_page_mode"]["value"] == "random"
    assert reset_selection_items["login_page_mode"]["source"] == "env_default"
    assert "asset-1" in reset_selection_items["login_page_image_lab_config"]["value"]

    reset_template = client.post("/api/settings/login-page-template-config/image-lab/reset")
    assert reset_template.status_code == 200
    reset_template_items = {item["key"]: item for item in reset_template.json()["items"]}
    assert reset_template_items["login_page_mode"]["value"] == "random"
    assert reset_template_items["login_page_image_lab_config"]["source"] == "env_default"
    assert "asset-1" not in reset_template_items["login_page_image_lab_config"]["value"]
    assert "Command copy" in reset_template_items["login_page_command_orbit_config"]["value"]

    invalid_selection = client.patch("/api/settings/login-page-selection", json={"value": "selected"})
    assert invalid_selection.status_code == 400
    assert "登录页选择 必须是以下之一" in invalid_selection.json()["detail"]

    invalid_template = client.patch(
        "/api/settings/login-page-template-config/unknown",
        json={"config": {}},
    )
    assert invalid_template.status_code == 400
    assert "登录页模板必须是以下之一" in invalid_template.json()["detail"]

    invalid_config = client.patch(
        "/api/settings/login-page-template-config/image-lab",
        json={"config": {"hero_description": "说明", "hero_image_asset_id": "", "extra": "nope"}},
    )
    assert invalid_config.status_code == 400
    assert "配置包含不支持字段" in invalid_config.json()["detail"]


def test_settings_export_includes_migratable_runtime_config_provider_secrets_and_excludes_env_only(
    configured_env: Path,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    updated = client.patch(
        "/api/settings",
        json={
            "values": {
                "text_generation_max_concurrent_tasks": 2,
                "image_generation_max_concurrent_tasks": 5,
                "gallery_show_generation_resource_group": False,
                "deletion_enabled": True,
            }
        },
    )
    assert updated.status_code == 200

    created_profile = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "导出网关",
            "base_url": "https://export.example/v1",
            "api_key": "export-secret-key",
            "capabilities": ["text_responses", "image_images"],
            "default_models": {"brief_model": "brief-export", "copy_model": "copy-export"},
            "config": {"note": "exportable"},
            "enabled": True,
        },
    )
    assert created_profile.status_code == 200
    profile_id = created_profile.json()["id"]

    text_binding = client.patch(
        "/api/settings/provider-bindings/text",
        json={
            "provider_kind": "openai",
            "provider_profile_id": profile_id,
            "model_settings": {"brief_model": "brief-export", "copy_model": "copy-export"},
            "config": {},
        },
    )
    assert text_binding.status_code == 200

    exported = client.get("/api/settings/export")

    assert exported.status_code == 200
    payload = exported.json()
    assert payload["metadata"]["schema_version"] == 1
    assert payload["metadata"]["app"] == "Inspiration One"
    assert payload["metadata"]["app_version"]
    assert payload["runtime_config"]["text_generation_max_concurrent_tasks"] == 2
    assert payload["runtime_config"]["image_generation_max_concurrent_tasks"] == 5
    assert "generation_max_concurrent_tasks" not in payload["runtime_config"]
    assert "login_page_selected_template_id" not in payload["runtime_config"]
    assert "login_page_enabled_template_ids" not in payload["runtime_config"]
    assert "login_page_image_lab_config" in payload["runtime_config"]
    assert payload["runtime_config"]["gallery_show_generation_resource_group"] is False
    assert payload["runtime_config"]["deletion_enabled"] is True
    assert set(RUNTIME_CONFIG_KEYS).issubset(payload["runtime_config"])
    assert {
        "admin_access_key",
        "session_secret",
        "database_url",
        "redis_url",
        "backend_cors_origins",
        "app_port",
        "storage_root",
    }.isdisjoint(payload["runtime_config"])
    assert "super-secret-admin-key" not in str(payload)
    assert "super-secret-session-key-123" not in str(payload)
    assert "sqlite:///" not in str(payload)
    assert "redis://localhost:6379/9" not in str(payload)

    exported_profile = next(profile for profile in payload["provider_profiles"] if profile["id"] == profile_id)
    assert exported_profile["api_key"] == "export-secret-key"
    assert exported_profile["base_url"] == "https://export.example/v1"
    assert exported_profile["capabilities"] == ["text_responses", "image_images"]
    exported_bindings = {binding["purpose"]: binding for binding in payload["provider_bindings"]}
    assert exported_bindings["text"]["provider_kind"] == "openai"
    assert exported_bindings["text"]["provider_profile_id"] == profile_id


def test_settings_import_preview_and_commit_replaces_runtime_and_provider_config(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    exported = client.get("/api/settings/export")
    assert exported.status_code == 200
    document = exported.json()
    imported_profile_id = "11111111-1111-4111-8111-111111111111"
    document["runtime_config"]["text_generation_max_concurrent_tasks"] = 4
    document["runtime_config"]["image_generation_max_concurrent_tasks"] = 6
    document["runtime_config"]["gallery_show_generation_resource_group"] = False
    document["runtime_config"]["deletion_enabled"] = True
    document["generation_resource_groups"][0]["blur_images_by_default"] = True
    document["provider_profiles"] = [
        {
            "id": imported_profile_id,
            "name": "导入网关",
            "provider_type": "openai_compatible",
            "base_url": "https://import.example/v1",
            "api_key": "import-secret-key",
            "capabilities": ["text_responses", "image_responses"],
            "default_models": {
                "brief_model": "brief-import",
                "copy_model": "copy-import",
                "image_model": "image-import",
            },
            "config": {"region": "local"},
            "enabled": True,
        }
    ]
    document["provider_bindings"] = [
        {
            "purpose": "text",
            "provider_kind": "openai",
            "provider_profile_id": imported_profile_id,
            "model_settings": {"brief_model": "brief-import", "copy_model": "copy-import"},
            "config": {},
        },
        {
            "purpose": "image",
            "provider_kind": "openai_responses",
            "provider_profile_id": imported_profile_id,
            "model_settings": {"model": "image-import"},
            "config": {"responses_background_enabled": True, "images_quality": "high"},
        },
    ]
    document["generation_configs"] = [
        {
            "name": "导入文案配置",
            "purpose": "text",
            "provider_kind": "openai",
            "provider_profile_id": imported_profile_id,
            "model_settings": {"brief_model": "brief-import", "copy_model": "copy-import"},
            "config": {},
            "priority": 100,
            "max_concurrency": 2,
            "enabled": True,
            "availability_window_minutes": 5,
            "failure_threshold": 3,
            "cooldown_minutes": 10,
        },
        {
            "name": "导入图片配置",
            "purpose": "image",
            "provider_kind": "openai_responses",
            "provider_profile_id": imported_profile_id,
            "model_settings": {"model": "image-import"},
            "config": {"responses_background_enabled": True},
            "priority": 90,
            "max_concurrency": 1,
            "enabled": True,
            "availability_window_minutes": 5,
            "failure_threshold": 3,
            "cooldown_minutes": 10,
        },
    ]

    preview = client.post("/api/settings/import/preview", json=document)
    assert preview.status_code == 200
    assert preview.json() == {
        "schema_version": 1,
        "runtime_config_count": len(RUNTIME_CONFIG_KEYS),
        "provider_profile_count": 1,
        "provider_binding_count": 2,
        "generation_resource_group_count": 1,
        "generation_config_count": 2,
        "canvas_template_category_count": len(document["canvas_template_categories"]),
        "canvas_template_count": len(document["canvas_templates"]),
        "provider_profile_names": ["导入网关"],
        "provider_binding_purposes": ["image", "text"],
        "includes_api_keys": True,
        "provider_profiles_with_api_key_count": 1,
        "canvas_template_keys": [template["key"] for template in document["canvas_templates"]],
        "canvas_template_category_names": [category["name"] for category in document["canvas_template_categories"]],
    }

    imported = client.post("/api/settings/import", json=document)
    assert imported.status_code == 200
    response_payload = imported.json()
    imported_items = {item["key"]: item for item in response_payload["config"]["items"]}
    assert imported_items["text_generation_max_concurrent_tasks"]["value"] == 4
    assert imported_items["image_generation_max_concurrent_tasks"]["value"] == 6
    assert imported_items["gallery_show_generation_resource_group"]["value"] is False
    assert imported_items["deletion_enabled"]["value"] is True
    assert imported_items["poster_generation_mode"]["value"] == "generated"
    assert imported_items["poster_generation_mode"]["source"] == "database"
    assert "import-secret-key" not in str(response_payload)

    session = get_session_factory()()
    try:
        assert session.get(AppSetting, "text_generation_max_concurrent_tasks").value == "4"
        assert session.get(AppSetting, "image_generation_max_concurrent_tasks").value == "6"
        assert session.get(AppSetting, "gallery_show_generation_resource_group").value == "false"
        assert session.get(AppSetting, "deletion_enabled").value == "true"
        assert session.get(AppSetting, "poster_generation_mode").value == "generated"
        profiles = session.scalars(select(ProviderProfile)).all()
        assert [profile.id for profile in profiles] == [imported_profile_id]
        assert profiles[0].api_key == "import-secret-key"
        bindings = {binding.purpose: binding for binding in session.scalars(select(ProviderBinding)).all()}
        assert bindings["text"].provider_profile_id == imported_profile_id
        assert bindings["image"].provider_kind == "openai_responses"
        assert bindings["image"].config_json == {"responses_background_enabled": True}
        default_group = session.get(GenerationResourceGroup, DEFAULT_GENERATION_RESOURCE_GROUP_ID)
        assert default_group is not None
        assert default_group.blur_images_by_default is True
        generation_configs = session.scalars(select(GenerationConfig).order_by(GenerationConfig.purpose)).all()
        assert {config.resource_group_id for config in generation_configs} == {DEFAULT_GENERATION_RESOURCE_GROUP_ID}
        assert {
            (link.generation_config_id, link.resource_group_id)
            for link in session.scalars(select(GenerationConfigResourceGroup)).all()
        } == {(config.id, DEFAULT_GENERATION_RESOURCE_GROUP_ID) for config in generation_configs}
    finally:
        session.close()


def test_settings_import_rejects_unknown_version_and_rolls_back_invalid_bindings(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    exported = client.get("/api/settings/export")
    assert exported.status_code == 200
    document = exported.json()

    unknown_version = {**document, "metadata": {**document["metadata"], "schema_version": 99}}
    rejected_version = client.post("/api/settings/import/preview", json=unknown_version)
    assert rejected_version.status_code == 400
    assert rejected_version.json()["detail"] == "配置文件版本不支持"

    renamed_default_group = deepcopy(document)
    renamed_default_group["generation_resource_groups"] = [
        {
            **document["generation_resource_groups"][0],
            "id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "key": "renamed-default",
        }
    ]
    accepted_renamed_default_group = client.post("/api/settings/import/preview", json=renamed_default_group)
    assert accepted_renamed_default_group.status_code == 200

    disabled_default_group = deepcopy(document)
    disabled_default_group["generation_resource_groups"] = [
        {
            **document["generation_resource_groups"][0],
            "enabled": False,
        }
    ]
    accepted_disabled_default_group = client.post("/api/settings/import/preview", json=disabled_default_group)
    assert accepted_disabled_default_group.status_code == 200

    legacy_capacity_document = deepcopy(document)
    legacy_capacity_document["runtime_config"].pop("text_generation_max_concurrent_tasks")
    legacy_capacity_document["runtime_config"].pop("image_generation_max_concurrent_tasks")
    legacy_capacity_document["runtime_config"]["generation_max_concurrent_tasks"] = 7
    legacy_capacity_preview = client.post("/api/settings/import/preview", json=legacy_capacity_document)
    assert legacy_capacity_preview.status_code == 200

    legacy_login_page_document = deepcopy(document)
    legacy_login_page_document["runtime_config"].pop("login_page_command_orbit_config")
    legacy_login_page_document["runtime_config"].pop("login_page_fluid_mist_config")
    legacy_login_page_document["runtime_config"].pop("login_page_image_lab_config")
    legacy_login_page_document["runtime_config"]["login_page_mode"] = "selected"
    legacy_login_page_document["runtime_config"]["login_page_selected_template_id"] = "image-lab"
    legacy_login_page_document["runtime_config"]["login_page_enabled_template_ids"] = ["image-lab"]
    legacy_login_page_document["runtime_config"]["login_page_command_orbit_brand_subtitle"] = "旧 Command"
    legacy_login_page_document["runtime_config"]["login_page_command_orbit_hero_title"] = "旧标题"
    legacy_login_page_document["runtime_config"]["login_page_command_orbit_hero_description"] = "旧说明"
    legacy_login_page_document["runtime_config"]["login_page_fluid_mist_greeting_title"] = "旧欢迎"
    legacy_login_page_document["runtime_config"]["login_page_fluid_mist_greeting_description"] = "旧欢迎说明"
    legacy_login_page_document["runtime_config"]["login_page_image_lab_hero_description"] = "旧图像说明"
    legacy_login_page_document["runtime_config"]["login_page_image_lab_hero_image_asset_id"] = ""
    legacy_login_page_preview = client.post("/api/settings/import/preview", json=legacy_login_page_document)
    assert legacy_login_page_preview.status_code == 200

    invalid_binding = dict(document)
    invalid_binding["runtime_config"] = {**document["runtime_config"], "text_generation_max_concurrent_tasks": 5}
    invalid_binding["provider_profiles"] = []
    invalid_binding["provider_bindings"] = [
        {
            "purpose": "text",
            "provider_kind": "openai",
            "provider_profile_id": "missing-profile",
            "model_settings": {"brief_model": "brief", "copy_model": "copy"},
            "config": {},
        },
        {
            "purpose": "image",
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {"model": "mock-image"},
            "config": {},
        },
    ]
    rejected_import = client.post("/api/settings/import", json=invalid_binding)
    assert rejected_import.status_code == 400
    assert "供应商不存在" in rejected_import.json()["detail"]

    missing_owner = deepcopy(document)
    missing_owner["canvas_template_categories"].append(
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "scope": "user",
            "owner_user_id": "missing-user",
            "name": "缺失用户分类",
            "sort_order": 100,
            "enabled": True,
            "disabled_reason": None,
        }
    )
    rejected_owner = client.post("/api/settings/import", json=missing_owner)
    assert rejected_owner.status_code == 400
    assert rejected_owner.json()["detail"] == "导入文件引用的用户不存在"

    assert get_runtime_settings().text_generation_max_concurrent_tasks == 3
    assert get_runtime_settings().image_generation_max_concurrent_tasks == 3
    session = get_session_factory()()
    try:
        assert session.get(AppSetting, "text_generation_max_concurrent_tasks") is None
        assert session.get(AppSetting, "image_generation_max_concurrent_tasks") is None
        bindings = {binding.purpose: binding for binding in session.scalars(select(ProviderBinding)).all()}
        assert {purpose: binding.provider_kind for purpose, binding in bindings.items()} == {
            "image": "mock",
            "text": "mock",
        }
    finally:
        session.close()


def test_provider_bootstrap_runs_on_app_startup(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    session = get_session_factory()()
    try:
        session.add_all(
            [
                AppSetting(key="text_provider_kind", value="openai"),
                AppSetting(key="text_api_key", value="shared-key"),
                AppSetting(key="text_base_url", value="http://localhost:3000/v1"),
                AppSetting(key="image_provider_kind", value="openai_responses"),
                AppSetting(key="image_api_key", value="shared-key"),
                AppSetting(key="image_base_url", value="http://localhost:3000/v1"),
            ]
        )
        session.commit()
    finally:
        session.close()

    app = create_app()
    with TestClient(app):
        session = get_session_factory()()
        try:
            profiles = session.scalars(select(ProviderProfile)).all()
            bindings = session.scalars(select(ProviderBinding)).all()
        finally:
            session.close()

    assert len(profiles) == 1
    assert set(profiles[0].capabilities_json) == {"text_responses", "image_responses"}
    assert {binding.purpose for binding in bindings} == {"text", "image"}


def test_provider_bootstrap_merges_matching_legacy_text_and_image_config(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    session = get_session_factory()()
    try:
        session.add_all(
            [
                AppSetting(key="text_provider_kind", value="openai"),
                AppSetting(key="text_api_key", value="shared-key"),
                AppSetting(key="text_base_url", value="http://localhost:3000/v1"),
                AppSetting(key="text_brief_model", value="brief-model"),
                AppSetting(key="text_copy_model", value="copy-model"),
                AppSetting(key="image_provider_kind", value="openai_images"),
                AppSetting(key="image_api_key", value="shared-key"),
                AppSetting(key="image_base_url", value="http://localhost:3000/v1"),
                AppSetting(key="image_generate_model", value="gpt-image-2"),
                AppSetting(key="image_images_quality", value="high"),
                AppSetting(key="image_images_style", value="natural"),
                AppSetting(key="image_responses_background_enabled", value="false"),
            ]
        )
        session.commit()
    finally:
        session.close()

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.get("/api/settings/provider-config")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["profiles"]) == 1
    profile = payload["profiles"][0]
    assert profile["base_url"] == "http://localhost:3000/v1"
    assert profile["has_api_key"] is True
    assert "shared-key" not in str(payload)
    assert set(profile["capabilities"]) == {"text_responses", "image_images"}
    bindings = {binding["purpose"]: binding for binding in payload["bindings"]}
    assert bindings["text"]["provider_kind"] == "openai"
    assert bindings["text"]["provider_profile_id"] == profile["id"]
    assert bindings["text"]["model_settings"] == {"brief_model": "brief-model", "copy_model": "copy-model"}
    assert bindings["image"]["provider_kind"] == "openai_images"
    assert bindings["image"]["provider_profile_id"] == profile["id"]
    assert bindings["image"]["model_settings"] == {"model": "gpt-image-2"}
    assert bindings["image"]["config"] == {
        "images_quality": "high",
        "images_style": "natural",
    }

    assert client.get("/api/settings/provider-config").json()["profiles"] == payload["profiles"]

    text_config = resolve_text_provider_config()
    assert text_config.provider_kind == "openai"
    assert text_config.api_key == "shared-key"
    assert text_config.base_url == "http://localhost:3000/v1"
    assert text_config.brief_model == "brief-model"
    assert text_config.copy_model == "copy-model"

    image_config = resolve_image_provider_config()
    assert image_config.provider_kind == "openai_images"
    assert image_config.api_key == "shared-key"
    assert image_config.base_url == "http://localhost:3000/v1"
    assert image_config.model == "gpt-image-2"
    assert image_config.images_quality == "high"
    assert image_config.images_style == "natural"
    assert image_config.responses_background_enabled is False


def test_provider_bootstrap_splits_different_legacy_connections(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    session = get_session_factory()()
    try:
        session.add_all(
            [
                AppSetting(key="text_provider_kind", value="openai"),
                AppSetting(key="text_api_key", value="text-key"),
                AppSetting(key="text_base_url", value="https://text.example/v1"),
                AppSetting(key="image_provider_kind", value="openai_responses"),
                AppSetting(key="image_api_key", value="image-key"),
                AppSetting(key="image_base_url", value="https://image.example/v1"),
            ]
        )
        session.commit()
    finally:
        session.close()

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.get("/api/settings/provider-config")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["profiles"]) == 2
    profiles_by_base_url = {profile["base_url"]: profile for profile in payload["profiles"]}
    assert set(profiles_by_base_url["https://text.example/v1"]["capabilities"]) == {"text_responses"}
    assert set(profiles_by_base_url["https://image.example/v1"]["capabilities"]) == {"image_responses"}
    bindings = {binding["purpose"]: binding for binding in payload["bindings"]}
    assert bindings["text"]["provider_profile_id"] == profiles_by_base_url["https://text.example/v1"]["id"]
    assert bindings["image"]["provider_profile_id"] == profiles_by_base_url["https://image.example/v1"]["id"]


def test_generation_config_status_filters_date_range_and_splits_purpose_stats(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    provider_config = client.get("/api/settings/provider-config")
    assert provider_config.status_code == 200
    configs = provider_config.json()["generation_configs"]
    text_config_id = next(item["id"] for item in configs if item["purpose"] == "text")
    image_config_id = next(item["id"] for item in configs if item["purpose"] == "image")
    today = datetime.now().astimezone().date()
    start_date = today - timedelta(days=6)
    outside_date = start_date - timedelta(days=1)

    session = get_session_factory()()
    try:
        session.add_all(
            [
                GenerationConfigDailyStat(
                    generation_config_id=text_config_id,
                    stat_date=today,
                    attempt_count=5,
                    success_count=4,
                    failure_count=1,
                    generated_unit_count=8,
                ),
                GenerationConfigDailyStat(
                    generation_config_id=image_config_id,
                    stat_date=today - timedelta(days=1),
                    attempt_count=7,
                    success_count=6,
                    failure_count=1,
                    generated_unit_count=7,
                ),
                GenerationConfigDailyStat(
                    generation_config_id=text_config_id,
                    stat_date=outside_date,
                    attempt_count=99,
                    success_count=99,
                    failure_count=0,
                ),
            ]
        )
        session.commit()
    finally:
        session.close()

    response = client.get(
        f"/api/settings/generation-config-status?start_date={start_date.isoformat()}&end_date={today.isoformat()}"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["start_date"] == start_date.isoformat()
    assert payload["end_date"] == today.isoformat()
    assert payload["range_attempt_count"] == 12
    assert payload["range_success_count"] == 10
    assert payload["range_failure_count"] == 2
    assert payload["range_text_attempt_count"] == 5
    assert payload["range_image_attempt_count"] == 7
    assert payload["today_attempt_count"] == 5
    assert payload["today_text_attempt_count"] == 5
    assert payload["today_image_attempt_count"] == 0

    configs_by_id = {item["id"]: item for item in payload["configs"]}
    assert configs_by_id[text_config_id]["range_stat"]["attempt_count"] == 5
    assert configs_by_id[image_config_id]["range_stat"]["attempt_count"] == 7

    invalid = client.get(
        f"/api/settings/generation-config-status?start_date={today.isoformat()}&end_date={outside_date.isoformat()}"
    )
    assert invalid.status_code == 400
    assert invalid.json()["detail"] == "日期范围无效"


def test_generation_config_unfreeze_endpoint_clears_runtime_freeze(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    provider_config = client.get("/api/settings/provider-config")
    assert provider_config.status_code == 200
    config_id = next(item["id"] for item in provider_config.json()["generation_configs"] if item["purpose"] == "image")

    session = get_session_factory()()
    try:
        state = session.get(GenerationConfigState, config_id)
        assert state is not None
        state.frozen_until = datetime.now().astimezone() + timedelta(minutes=10)
        state.failure_window_started_at = datetime.now().astimezone()
        state.failure_count_in_window = 2
        session.commit()
    finally:
        session.close()

    frozen_status = client.get("/api/settings/generation-config-status")
    assert frozen_status.status_code == 200
    assert frozen_status.json()["frozen_count"] == 1

    unfrozen = client.post(f"/api/settings/generation-configs/{config_id}/unfreeze")
    assert unfrozen.status_code == 200
    assert unfrozen.json()["state"]["frozen_until"] is None
    assert unfrozen.json()["state"]["failure_window_started_at"] is None
    assert unfrozen.json()["state"]["failure_count_in_window"] == 0

    restored_status = client.get("/api/settings/generation-config-status")
    assert restored_status.status_code == 200
    assert restored_status.json()["frozen_count"] == 0


def test_generation_config_api_accepts_multiple_resource_groups(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created_group = client.post(
        "/api/settings/generation-resource-groups",
        json={"key": "seasonal", "name": "季节分组", "sort_order": 120, "enabled": True},
    )
    assert created_group.status_code == 200
    seasonal_group_id = created_group.json()["id"]

    created_config = client.post(
        "/api/settings/generation-configs",
        json={
            "resource_group_ids": [seasonal_group_id, DEFAULT_GENERATION_RESOURCE_GROUP_ID],
            "name": "共享文案配置",
            "purpose": "text",
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {"brief_model": "mock-brief", "copy_model": "mock-copy"},
            "config": {},
            "priority": 300,
            "max_concurrency": 2,
            "enabled": True,
            "availability_window_minutes": 5,
            "failure_threshold": 3,
            "cooldown_minutes": 10,
        },
    )
    assert created_config.status_code == 200
    payload = created_config.json()
    assert payload["resource_group_id"] == seasonal_group_id
    assert payload["resource_group_ids"] == [seasonal_group_id, DEFAULT_GENERATION_RESOURCE_GROUP_ID]

    listed = client.get("/api/settings/provider-config")
    assert listed.status_code == 200
    listed_config = next(item for item in listed.json()["generation_configs"] if item["id"] == payload["id"])
    assert listed_config["resource_group_id"] == seasonal_group_id
    assert listed_config["resource_group_ids"] == [seasonal_group_id, DEFAULT_GENERATION_RESOURCE_GROUP_ID]

    explicit_null_groups = client.post(
        "/api/settings/generation-configs",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "resource_group_ids": None,
            "name": "显式未绑定文案配置",
            "purpose": "text",
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {"brief_model": "mock-brief", "copy_model": "mock-copy"},
            "config": {},
            "priority": 200,
            "max_concurrency": 1,
            "enabled": True,
            "availability_window_minutes": 5,
            "failure_threshold": 3,
            "cooldown_minutes": 10,
        },
    )
    assert explicit_null_groups.status_code == 200
    assert explicit_null_groups.json()["resource_group_id"] is None
    assert explicit_null_groups.json()["resource_group_ids"] == []


def test_provider_config_api_masks_keys_preserves_blank_update_and_validates_bindings(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    initial = client.get("/api/settings/provider-config")
    assert initial.status_code == 200
    initial_payload = initial.json()
    assert initial_payload["profiles"] == []
    assert {binding["purpose"]: binding["provider_kind"] for binding in initial_payload["bindings"]} == {
        "image": "mock",
        "text": "mock",
    }

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "本地 3000 网关",
            "base_url": "http://localhost:3000/v1",
            "api_key": "chatgpt2api",
            "capabilities": ["text_responses", "image_responses", "image_images"],
            "default_models": {"brief_model": "gpt-4.1", "copy_model": "gpt-4.1", "image_model": "gpt-image-2"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200
    profile = created.json()
    profile_id = profile["id"]
    assert profile["has_api_key"] is True
    assert "chatgpt2api" not in str(profile)

    updated_blank_key = client.patch(
        f"/api/settings/provider-profiles/{profile_id}",
        json={
            "name": "本地 3000 网关",
            "base_url": None,
            "api_key": "",
            "capabilities": ["text_responses", "image_images"],
            "default_models": {"brief_model": "gpt-4.1-mini", "copy_model": "gpt-4.1-mini"},
            "config": {},
            "enabled": True,
        },
    )
    assert updated_blank_key.status_code == 200
    assert updated_blank_key.json()["base_url"] is None

    session = get_session_factory()()
    try:
        db_profile = session.get(ProviderProfile, profile_id)
        assert db_profile is not None
        assert db_profile.api_key == "chatgpt2api"
        assert db_profile.base_url is None
    finally:
        session.close()

    text_binding = client.patch(
        "/api/settings/provider-bindings/text",
        json={
            "provider_kind": "openai",
            "provider_profile_id": profile_id,
            "model_settings": {
                "brief_model": "brief-model",
                "copy_model": "copy-model",
            },
            "config": {},
        },
    )
    assert text_binding.status_code == 200
    assert text_binding.json()["provider_kind"] == "openai"
    assert text_binding.json()["model_settings"] == {
        "brief_model": "brief-model",
        "copy_model": "copy-model",
    }

    image_binding = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "openai_images",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "gpt-image-2"},
            "config": {"images_quality": "high", "images_style": "natural", "responses_background_enabled": True},
        },
    )
    assert image_binding.status_code == 200
    assert image_binding.json()["provider_kind"] == "openai_images"
    assert image_binding.json()["config"] == {"images_quality": "high", "images_style": "natural"}

    invalid_binding = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "openai_responses",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "gpt-image-2"},
            "config": {"responses_background_enabled": True},
        },
    )
    assert invalid_binding.status_code == 400
    assert "不支持当前接口能力" in invalid_binding.json()["detail"]

    missing_text_model = client.patch(
        "/api/settings/provider-bindings/text",
        json={"provider_kind": "mock", "provider_profile_id": None, "model_settings": {}, "config": {}},
    )
    assert missing_text_model.status_code == 400
    assert "文案灵感产物理解模型未配置" in missing_text_model.json()["detail"]

    missing_image_model = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {},
            "config": {},
        },
    )
    assert missing_image_model.status_code == 400
    assert "图片模型未配置" in missing_image_model.json()["detail"]

    missing_responses_background = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "openai_responses",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "gpt-5.4"},
            "config": {},
        },
    )
    assert missing_responses_background.status_code == 400
    assert "图片 Responses 后台响应模式未配置" in missing_responses_background.json()["detail"]

    remove_active_capability = client.patch(
        f"/api/settings/provider-profiles/{profile_id}",
        json={
            "capabilities": ["text_responses"],
        },
    )
    assert remove_active_capability.status_code == 400
    assert "不能移除当前接口能力" in remove_active_capability.json()["detail"]

    disable_active_profile = client.patch(
        f"/api/settings/provider-profiles/{profile_id}",
        json={"enabled": False},
    )
    assert disable_active_profile.status_code == 400
    assert "不能停用" in disable_active_profile.json()["detail"]

    archive_active = client.delete(f"/api/settings/provider-profiles/{profile_id}")
    assert archive_active.status_code == 400
    assert "仍被文案或图片配置使用" in archive_active.json()["detail"]

    reset_image = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "mock",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "mock-image"},
            "config": {"images_quality": "high", "responses_background_enabled": True},
        },
    )
    assert reset_image.status_code == 200
    assert reset_image.json()["provider_profile_id"] is None
    assert reset_image.json()["config"] == {}
    reset_text = client.patch(
        "/api/settings/provider-bindings/text",
        json={
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {"brief_model": "mock-brief", "copy_model": "mock-copy"},
            "config": {},
        },
    )
    assert reset_text.status_code == 200
    archived = client.delete(f"/api/settings/provider-profiles/{profile_id}")
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None


def test_text_generation_config_test_api_runs_mock_without_persistence(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/settings/generation-configs/test-text",
        json={
            "generation_config": {
                "name": "测试文案配置",
                "purpose": "text",
                "provider_kind": "mock",
                "provider_profile_id": None,
                "model_settings": {"brief_model": "mock-brief", "copy_model": "mock-copy"},
                "config": {},
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
            },
            "inspiration": {"name": "便携咖啡杯", "category": "杯具", "source_note": "适合通勤"},
            "copy_request": {"instruction": "突出保温和便携", "output_mode": "blocks"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["generation_config_id"] is None
    assert payload["provider_kind"] == "mock"
    assert payload["brief_model"] == "mock-brief-v1"
    assert payload["copy_model"] == "mock-copy-v2"
    assert payload["brief"]["positioning"]
    assert payload["copy_result"]["summary"]

    session = get_session_factory()()
    try:
        configs = session.scalars(select(GenerationConfig).where(GenerationConfig.name == "测试文案配置")).all()
        test_results = session.scalars(select(GenerationConfigTestResult)).all()
    finally:
        session.close()
    assert configs == []
    assert test_results == []


def test_text_generation_config_test_api_persists_latest_result_for_saved_config(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/generation-configs",
        json={
            "name": "已保存文案测试配置",
            "purpose": "text",
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {"brief_model": "mock-brief", "copy_model": "mock-copy"},
            "config": {},
            "priority": 100,
            "max_concurrency": 1,
            "enabled": True,
        },
    )
    assert created.status_code == 200
    generation_config_id = created.json()["id"]

    response = client.post(
        "/api/settings/generation-configs/test-text",
        json={
            "generation_config_id": generation_config_id,
            "inspiration": {"name": "便携咖啡杯", "category": "杯具", "source_note": "适合通勤"},
            "copy_request": {"instruction": "突出保温和便携", "output_mode": "blocks"},
        },
    )

    assert response.status_code == 200
    session = get_session_factory()()
    try:
        test_results = session.scalars(
            select(GenerationConfigTestResult).where(
                GenerationConfigTestResult.generation_config_id == generation_config_id
            )
        ).all()
    finally:
        session.close()
    assert len(test_results) == 1
    assert test_results[0].test_type == "text"
    assert test_results[0].status == "success"
    assert test_results[0].provider_kind == "mock"
    assert test_results[0].duration_ms is not None
    assert test_results[0].model_summary_json == {"brief_model": "mock-brief-v1", "copy_model": "mock-copy-v2"}

    provider_config = client.get("/api/settings/provider-config")
    assert provider_config.status_code == 200
    persisted_config = next(
        item for item in provider_config.json()["generation_configs"] if item["id"] == generation_config_id
    )
    assert persisted_config["latest_test_result"]["test_type"] == "text"
    assert persisted_config["latest_test_result"]["status"] == "success"
    assert persisted_config["latest_test_result"]["model_summary"] == {
        "brief_model": "mock-brief-v1",
        "copy_model": "mock-copy-v2",
    }


def test_text_generation_config_test_api_reports_missing_real_provider_config(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/settings/generation-configs/test-text",
        json={
            "generation_config": {
                "name": "缺失供应商",
                "purpose": "text",
                "provider_kind": "openai",
                "provider_profile_id": None,
                "model_settings": {"brief_model": "gpt-4.1", "copy_model": "gpt-4.1"},
                "config": {},
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
            }
        },
    )

    assert response.status_code == 400
    assert "真实供应商必须选择供应商档案" in response.json()["detail"]


def test_image_generation_config_test_api_runs_mock_and_returns_gallery_saveable_asset(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/settings/generation-configs/test-image",
        json={
            "generation_config": {
                "name": "测试图片配置",
                "purpose": "image",
                "provider_kind": "mock",
                "provider_profile_id": None,
                "model_settings": {"model": "mock-image"},
                "config": {},
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
            },
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张干净的测试图",
            "size": "1024x1024",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["generation_config_id"] is None
    assert payload["provider_kind"] == "mock"
    assert payload["model_name"] == "mock-image-chat-v1"
    assert payload["provider_name"] == "mock"
    assert payload["round"]["prompt"] == "生成一张干净的测试图"
    assert payload["round"]["size"] == "1024x1024"
    assert payload["round"]["actual_size"] == "1024x1024"
    assert payload["round"]["resource_group"]["id"] == DEFAULT_GENERATION_RESOURCE_GROUP_ID
    assert payload["generated_asset"]["id"] == payload["round"]["generated_asset"]["id"]
    assert payload["generated_asset"]["gallery_saved"] is False
    assert payload["generated_asset"]["preview_url"].endswith("variant=preview")

    saved = client.post("/api/gallery", json={"image_session_asset_id": payload["generated_asset"]["id"]})
    assert saved.status_code == 201
    assert saved.json()["image"]["id"] == payload["generated_asset"]["id"]
    assert saved.json()["image"]["gallery_saved"] is True

    session = get_session_factory()()
    try:
        configs = session.scalars(select(GenerationConfig).where(GenerationConfig.name == "测试图片配置")).all()
        test_results = session.scalars(select(GenerationConfigTestResult)).all()
        image_session = session.get(ImageSession, payload["image_session_id"])
        round_item = session.get(ImageSessionRound, payload["round"]["id"])
    finally:
        session.close()
    assert configs == []
    assert test_results == []
    assert image_session is not None
    assert image_session.title.startswith("图片配置测试 - 测试图片配置")
    assert round_item is not None
    assert round_item.session_id == payload["image_session_id"]
    assert round_item.generation_config_id is None


def test_image_generation_config_test_api_persists_latest_result_for_saved_config(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/generation-configs",
        json={
            "name": "已保存图片测试配置",
            "purpose": "image",
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {"model": "mock-image"},
            "config": {},
            "priority": 100,
            "max_concurrency": 1,
            "enabled": True,
        },
    )
    assert created.status_code == 200
    generation_config_id = created.json()["id"]

    response = client.post(
        "/api/settings/generation-configs/test-image",
        json={
            "generation_config_id": generation_config_id,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张干净的测试图",
            "size": "1024x1024",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["generation_config_id"] == generation_config_id
    session = get_session_factory()()
    try:
        test_results = session.scalars(
            select(GenerationConfigTestResult).where(
                GenerationConfigTestResult.generation_config_id == generation_config_id
            )
        ).all()
        round_item = session.get(ImageSessionRound, payload["round"]["id"])
    finally:
        session.close()
    assert len(test_results) == 1
    assert test_results[0].test_type == "image"
    assert test_results[0].status == "success"
    assert test_results[0].provider_kind == "mock"
    assert test_results[0].model_summary_json == {
        "model_name": "mock-image-chat-v1",
        "provider_name": "mock",
    }
    assert round_item is not None
    assert round_item.generation_config_id == generation_config_id


def test_generation_config_test_api_persists_failure_for_saved_config(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/generation-configs",
        json={
            "name": "失败记录文案配置",
            "purpose": "text",
            "provider_kind": "mock",
            "provider_profile_id": None,
            "model_settings": {"brief_model": "mock-brief", "copy_model": "mock-copy"},
            "config": {},
            "priority": 100,
            "max_concurrency": 1,
            "enabled": True,
        },
    )
    assert created.status_code == 200
    generation_config_id = created.json()["id"]

    response = client.post(
        "/api/settings/generation-configs/test-json-response-format",
        json={"generation_config_id": generation_config_id},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "文案结构化输出仅支持 OpenAI Responses 或 Chat Completions 文案接口"
    session = get_session_factory()()
    try:
        test_result = session.scalar(
            select(GenerationConfigTestResult).where(
                GenerationConfigTestResult.generation_config_id == generation_config_id
            )
        )
    finally:
        session.close()
    assert test_result is not None
    assert test_result.test_type == "json_response_format"
    assert test_result.status == "failed"
    assert test_result.provider_kind == "mock"
    assert test_result.error_detail == "文案结构化输出仅支持 OpenAI Responses 或 Chat Completions 文案接口"


def test_image_generation_config_test_api_reports_provider_failure_detail(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    def raise_provider_failure(self, **_: object) -> None:
        raise ValueError("供应商测试失败：尺寸不支持")

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.image.chat_service.ImageChatService.generate",
        raise_provider_failure,
    )

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/settings/generation-configs/test-image",
        json={
            "generation_config": {
                "name": "失败图片配置",
                "purpose": "image",
                "provider_kind": "mock",
                "provider_profile_id": None,
                "model_settings": {"model": "mock-image"},
                "config": {},
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
            },
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张会失败的测试图",
            "size": "1024x1024",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "供应商测试失败：尺寸不支持"

    session = get_session_factory()()
    try:
        image_sessions = session.scalars(
            select(ImageSession).where(ImageSession.title.like("图片配置测试 - 失败图片配置%"))
        ).all()
    finally:
        session.close()
    assert image_sessions == []


def test_provider_config_supports_openai_chat_completions_text_profiles_and_bindings(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Chat Completions 文案网关",
            "provider_type": "openai_compatible",
            "base_url": "https://chat-text.example/v1",
            "api_key": "chat-text-secret-key",
            "capabilities": ["text_chat_completions"],
            "default_models": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200
    profile = created.json()
    profile_id = profile["id"]
    assert profile["provider_type"] == "openai_compatible"
    assert profile["capabilities"] == ["text_chat_completions"]
    assert "chat-text-secret-key" not in str(profile)

    rejected_binding = client.patch(
        "/api/settings/provider-bindings/text",
        json={
            "provider_kind": "openai",
            "provider_profile_id": profile_id,
            "model_settings": {"brief_model": "gpt-4.1", "copy_model": "gpt-4.1"},
            "config": {},
        },
    )
    assert rejected_binding.status_code == 400
    assert "不支持当前接口能力" in rejected_binding.json()["detail"]

    text_binding = client.patch(
        "/api/settings/provider-bindings/text",
        json={
            "provider_kind": "openai_chat_completions",
            "provider_profile_id": profile_id,
            "model_settings": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
            "config": {},
        },
    )
    assert text_binding.status_code == 200
    assert text_binding.json()["provider_kind"] == "openai_chat_completions"
    assert text_binding.json()["config"] == {"structured_output": {"enabled": False, "mode": "json_schema"}}

    text_config = resolve_text_provider_config()
    assert text_config.provider_kind == "openai_chat_completions"
    assert text_config.api_key == "chat-text-secret-key"
    assert text_config.base_url == "https://chat-text.example/v1"
    assert text_config.brief_model == "grok-brief"
    assert text_config.copy_model == "grok-copy"
    assert text_config.structured_json_response_format_enabled is False
    assert text_config.structured_output.enabled is False
    assert text_config.structured_output.mode == "json_schema"

    exported = client.get("/api/settings/export")
    assert exported.status_code == 200
    document = exported.json()
    exported_profile = next(item for item in document["provider_profiles"] if item["id"] == profile_id)
    assert exported_profile["capabilities"] == ["text_chat_completions"]
    exported_text = next(item for item in document["provider_bindings"] if item["purpose"] == "text")
    assert exported_text["provider_kind"] == "openai_chat_completions"
    assert exported_text["config"] == {"structured_output": {"enabled": False, "mode": "json_schema"}}


def test_chat_completions_generation_config_round_trips_structured_json_response_format(
    configured_env: Path,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Chat Completions JSON 网关",
            "provider_type": "openai_compatible",
            "base_url": "https://chat-json.example/v1",
            "api_key": "chat-json-secret-key",
            "capabilities": ["text_chat_completions"],
            "default_models": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200

    generation_config = client.post(
        "/api/settings/generation-configs",
        json={
            "resource_group_ids": [],
            "name": "Chat Completions JSON 文案",
            "purpose": "text",
            "provider_kind": "openai_chat_completions",
            "provider_profile_id": created.json()["id"],
            "model_settings": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
            "config": {"structured_json_response_format_enabled": True},
            "priority": 100,
            "max_concurrency": 1,
            "enabled": True,
        },
    )
    assert generation_config.status_code == 200
    payload = generation_config.json()
    assert payload["config"] == {"structured_output": {"enabled": True, "mode": "json_object"}}

    text_config = resolve_text_provider_config(generation_config_id=payload["id"])
    assert text_config.provider_kind == "openai_chat_completions"
    assert text_config.structured_json_response_format_enabled is True
    assert text_config.structured_output.enabled is True
    assert text_config.structured_output.mode == "json_object"

    exported = client.get("/api/settings/export")
    assert exported.status_code == 200
    exported_generation_config = next(
        item for item in exported.json()["generation_configs"] if item["id"] == payload["id"]
    )
    assert exported_generation_config["config"] == {"structured_output": {"enabled": True, "mode": "json_object"}}


def test_responses_generation_config_round_trips_structured_output(
    configured_env: Path,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Responses JSON 网关",
            "provider_type": "openai_compatible",
            "base_url": "https://responses-json.example/v1",
            "api_key": "responses-json-secret-key",
            "capabilities": ["text_responses"],
            "default_models": {"brief_model": "gpt-brief", "copy_model": "gpt-copy"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200

    generation_config = client.post(
        "/api/settings/generation-configs",
        json={
            "resource_group_ids": [],
            "name": "Responses 结构化文案",
            "purpose": "text",
            "provider_kind": "openai",
            "provider_profile_id": created.json()["id"],
            "model_settings": {"brief_model": "gpt-brief", "copy_model": "gpt-copy"},
            "config": {"structured_output": {"enabled": True, "mode": "json_schema"}},
            "priority": 100,
            "max_concurrency": 1,
            "enabled": True,
        },
    )
    assert generation_config.status_code == 200
    payload = generation_config.json()
    assert payload["config"] == {"structured_output": {"enabled": True, "mode": "json_schema"}}

    text_config = resolve_text_provider_config(generation_config_id=payload["id"])
    assert text_config.provider_kind == "openai"
    assert text_config.structured_json_response_format_enabled is True
    assert text_config.structured_output.enabled is True
    assert text_config.structured_output.mode == "json_schema"

    exported = client.get("/api/settings/export")
    assert exported.status_code == 200
    exported_generation_config = next(
        item for item in exported.json()["generation_configs"] if item["id"] == payload["id"]
    )
    assert exported_generation_config["config"] == {"structured_output": {"enabled": True, "mode": "json_schema"}}


def test_text_generation_config_test_api_runs_openai_chat_completions_provider(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.application.contracts import CopyPayloadV2, CreativeBriefPayload, FreeformCopyContent
    from inspiration_one_backend.presentation.api import create_app

    calls: list[str] = []

    def fake_generate_brief(self, inspiration):
        calls.append(f"brief:{self.provider_name}:{inspiration.name}")
        return (
            CreativeBriefPayload(
                positioning="通勤杯定位",
                audience="上班族",
                selling_angles=["保温", "轻便", "好清洁"],
                taboo_phrases=[],
                poster_style_hint="白底",
            ),
            self.brief_model,
        )

    def fake_generate_copy(self, inspiration, brief, config=None, reference_images=None):
        calls.append(f"copy:{self.provider_name}:{brief.positioning}:{len(reference_images or [])}")
        return (
            CopyPayloadV2(
                summary=f"{inspiration.name} 主图文案",
                content=FreeformCopyContent(text="轻便保温，通勤随手带。"),
            ),
            self.copy_model,
        )

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.text.openai_chat_completions_provider."
        "OpenAIChatCompletionsTextProvider.generate_brief",
        fake_generate_brief,
    )
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.text.openai_chat_completions_provider."
        "OpenAIChatCompletionsTextProvider.generate_copy",
        fake_generate_copy,
    )

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Chat Completions 测试网关",
            "provider_type": "openai_compatible",
            "base_url": "https://chat-test.example/v1",
            "api_key": "chat-test-secret-key",
            "capabilities": ["text_chat_completions"],
            "default_models": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200

    response = client.post(
        "/api/settings/generation-configs/test-text",
        json={
            "generation_config": {
                "name": "Chat Completions 文案测试",
                "purpose": "text",
                "provider_kind": "openai_chat_completions",
                "provider_profile_id": created.json()["id"],
                "model_settings": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
                "config": {},
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
            },
            "inspiration": {"name": "便携咖啡杯", "category": "杯具", "source_note": "适合通勤"},
            "copy_request": {"instruction": "突出保温和便携", "output_mode": "blocks"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["generation_config_id"] is None
    assert payload["provider_kind"] == "openai_chat_completions"
    assert payload["brief_model"] == "grok-brief"
    assert payload["copy_model"] == "grok-copy"
    assert payload["copy_result"]["summary"] == "便携咖啡杯 主图文案"
    assert calls == [
        "brief:openai-chat-completions:便携咖啡杯",
        "copy:openai-chat-completions:通勤杯定位:0",
    ]


def test_text_generation_config_json_response_format_test_api_sends_response_format(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    calls: list[dict] = []

    class DummyResponse:
        headers = {"content-type": "application/json"}

        def __init__(self) -> None:
            content = '{"ok":true,"kind":"text_structured_output_test","items":["structured_output"]}'
            self._payload = {"choices": [{"message": {"content": content}}]}
            self.text = str(self._payload)

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._payload

    class DummyHTTPXClient:
        def __init__(self, **kwargs) -> None:
            return None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, *, json: dict):
            calls.append({"url": url, "json": json})
            return DummyResponse()

    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.text.openai_chat_completions_provider.httpx.Client",
        DummyHTTPXClient,
    )

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Chat Completions JSON 测试网关",
            "provider_type": "openai_compatible",
            "base_url": "https://chat-json-test.example/v1",
            "api_key": "chat-json-test-secret-key",
            "capabilities": ["text_chat_completions"],
            "default_models": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200

    response = client.post(
        "/api/settings/generation-configs/test-json-response-format",
        json={
            "generation_config": {
                "name": "Chat Completions JSON 模式测试",
                "purpose": "text",
                "provider_kind": "openai_chat_completions",
                "provider_profile_id": created.json()["id"],
                "model_settings": {"brief_model": "grok-brief", "copy_model": "grok-copy"},
                "config": {"structured_json_response_format_enabled": True},
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
            }
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider_kind"] == "openai_chat_completions"
    assert payload["model"] == "grok-copy"
    assert payload["parsed_json"] == {
        "ok": True,
        "kind": "text_structured_output_test",
        "items": ["structured_output"],
    }
    assert calls[0]["url"] == "https://chat-json-test.example/v1/chat/completions"
    assert calls[0]["json"]["stream"] is False
    assert calls[0]["json"]["response_format"] == {"type": "json_object"}


def test_text_generation_config_structured_output_test_api_supports_responses(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    calls: list[dict] = []

    class DummyResponse:
        output_text = '{"ok":true,"kind":"text_structured_output_test","items":["structured_output"]}'

    class DummyResponses:
        def create(self, **kwargs):
            calls.append(kwargs)
            return DummyResponse()

    class DummyOpenAI:
        def __init__(self, **kwargs) -> None:
            self.responses = DummyResponses()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.text.openai_provider.OpenAI", DummyOpenAI)

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Responses JSON 测试网关",
            "provider_type": "openai_compatible",
            "base_url": "https://responses-json-test.example/v1",
            "api_key": "responses-json-test-secret-key",
            "capabilities": ["text_responses"],
            "default_models": {"brief_model": "gpt-brief", "copy_model": "gpt-copy"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200

    response = client.post(
        "/api/settings/generation-configs/test-json-response-format",
        json={
            "generation_config": {
                "name": "Responses 结构化输出测试",
                "purpose": "text",
                "provider_kind": "openai",
                "provider_profile_id": created.json()["id"],
                "model_settings": {"brief_model": "gpt-brief", "copy_model": "gpt-copy"},
                "config": {"structured_output": {"enabled": True, "mode": "json_schema"}},
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
            }
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider_kind"] == "openai"
    assert payload["model"] == "gpt-copy"
    assert payload["parsed_json"] == {
        "ok": True,
        "kind": "text_structured_output_test",
        "items": ["structured_output"],
    }
    assert calls[0]["model"] == "gpt-copy"
    assert calls[0]["text"]["format"]["type"] == "json_schema"
    assert calls[0]["text"]["format"]["name"] == "text_structured_output_test"


def test_real_image_binding_switches_visible_poster_mode_to_generated(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    initial_config = client.get("/api/settings")
    assert initial_config.status_code == 200
    initial_items = {item["key"]: item for item in initial_config.json()["items"]}
    assert initial_items["poster_generation_mode"]["value"] == "template"
    assert initial_items["poster_generation_mode"]["source"] == "env_default"

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "图片网关",
            "base_url": "https://image.example/v1",
            "api_key": "image-secret-key",
            "capabilities": ["image_images"],
            "default_models": {"image_model": "gpt-image-2"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200
    profile_id = created.json()["id"]

    image_binding = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "openai_images",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "gpt-image-2"},
            "config": {"images_quality": "high", "images_style": "natural"},
        },
    )
    assert image_binding.status_code == 200
    assert image_binding.json()["provider_kind"] == "openai_images"

    updated_config = client.get("/api/settings")
    assert updated_config.status_code == 200
    updated_items = {item["key"]: item for item in updated_config.json()["items"]}
    assert updated_items["poster_generation_mode"]["value"] == "generated"
    assert updated_items["poster_generation_mode"]["source"] == "database"
    assert get_runtime_settings().poster_generation_mode == "generated"

    session = get_session_factory()()
    try:
        app_setting = session.get(AppSetting, "poster_generation_mode")
        assert app_setting is not None
        assert app_setting.value == "generated"
    finally:
        session.close()


def test_provider_config_supports_google_gemini_profiles_bindings_and_import(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Gemini 图片",
            "provider_type": "google_gemini",
            "base_url": None,
            "api_key": "google-secret-key",
            "capabilities": ["image_google_gemini"],
            "default_models": {"image_model": "gemini-2.5-flash-image"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200
    profile = created.json()
    profile_id = profile["id"]
    assert profile["provider_type"] == "google_gemini"
    assert profile["capabilities"] == ["image_google_gemini"]
    assert profile["base_url"] is None
    assert profile["has_api_key"] is True
    assert "google-secret-key" not in str(profile)

    rejected_base_url = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Gemini 自定义地址",
            "provider_type": "google_gemini",
            "base_url": "https://example.invalid",
            "api_key": "google-secret-key",
            "capabilities": ["image_google_gemini"],
            "default_models": {},
            "config": {},
            "enabled": True,
        },
    )
    assert rejected_base_url.status_code == 400
    assert "暂不支持自定义 Base URL" in rejected_base_url.json()["detail"]

    image_binding = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "google_gemini_image",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "gemini-2.5-flash-image"},
            "config": {"gemini_api_version": "v1beta", "gemini_output_mime_type": "image/png"},
        },
    )
    assert image_binding.status_code == 200
    assert image_binding.json()["provider_kind"] == "google_gemini_image"
    assert image_binding.json()["config"] == {
        "gemini_api_version": "v1beta",
        "gemini_output_mime_type": "image/png",
    }

    image_config = resolve_image_provider_config()
    assert image_config.provider_kind == "google_gemini_image"
    assert image_config.api_key == "google-secret-key"
    assert image_config.base_url is None
    assert image_config.model == "gemini-2.5-flash-image"
    assert image_config.gemini_api_version == "v1beta"
    assert image_config.gemini_output_mime_type == "image/png"

    exported = client.get("/api/settings/export")
    assert exported.status_code == 200
    document = exported.json()
    exported_profile = next(item for item in document["provider_profiles"] if item["id"] == profile_id)
    assert exported_profile["provider_type"] == "google_gemini"
    assert exported_profile["api_key"] == "google-secret-key"
    exported_image = next(item for item in document["provider_bindings"] if item["purpose"] == "image")
    assert exported_image["provider_kind"] == "google_gemini_image"

    preview = client.post("/api/settings/import/preview", json=document)
    assert preview.status_code == 200
    assert preview.json()["provider_profile_count"] >= 1


def test_provider_config_supports_openai_chat_image_profiles_and_bindings(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Packy Banana",
            "provider_type": "openai_compatible",
            "base_url": "https://www.packyapi.com",
            "api_key": "packy-secret-key",
            "capabilities": ["image_chat"],
            "default_models": {"image_model": "gemini-3-pro-image-preview-16-9-4K"},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200
    profile = created.json()
    profile_id = profile["id"]
    assert profile["provider_type"] == "openai_compatible"
    assert profile["capabilities"] == ["image_chat"]
    assert "packy-secret-key" not in str(profile)

    rejected_binding = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "openai_images",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "gpt-image-1"},
            "config": {},
        },
    )
    assert rejected_binding.status_code == 400
    assert "不支持当前接口能力" in rejected_binding.json()["detail"]

    image_binding = client.patch(
        "/api/settings/provider-bindings/image",
        json={
            "provider_kind": "openai_chat_image",
            "provider_profile_id": profile_id,
            "model_settings": {"model": "gemini-3-pro-image-preview-16-9-4K"},
            "config": {"images_quality": "high", "responses_background_enabled": True},
        },
    )
    assert image_binding.status_code == 200
    assert image_binding.json()["provider_kind"] == "openai_chat_image"
    assert image_binding.json()["config"] == {}

    image_config = resolve_image_provider_config()
    assert image_config.provider_kind == "openai_chat_image"
    assert image_config.api_key == "packy-secret-key"
    assert image_config.base_url == "https://www.packyapi.com"
    assert image_config.model == "gemini-3-pro-image-preview-16-9-4K"

    exported = client.get("/api/settings/export")
    assert exported.status_code == 200
    document = exported.json()
    exported_image = next(item for item in document["provider_bindings"] if item["purpose"] == "image")
    assert exported_image["provider_kind"] == "openai_chat_image"
    assert exported_image["config"] == {}


def test_provider_model_list_endpoint_fetches_openai_compatible_models(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    captured_kwargs: dict[str, object] = {}

    class DummyModels:
        def list(self):
            class ModelList:
                data = [
                    {"id": "z-copy-model", "owned_by": "vendor", "created": "1700000002"},
                    {"id": "a-brief-model", "owned_by": "vendor", "created": 1700000001},
                    {"id": "a-brief-model", "owned_by": "duplicate", "created": 1700000000},
                    {"owned_by": "missing-id"},
                ]

            return ModelList()

    class DummyOpenAI:
        def __init__(self, **kwargs):
            captured_kwargs.update(kwargs)
            self.models = DummyModels()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.provider_models.OpenAI", DummyOpenAI)

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "模型列表供应商",
            "provider_type": "openai_compatible",
            "base_url": "https://models.example/v1",
            "api_key": "secret-model-key",
            "capabilities": ["text_responses", "image_images"],
            "default_models": {},
            "config": {},
            "enabled": True,
        },
    )
    assert created.status_code == 200

    listed = client.get(
        f"/api/settings/provider-profiles/{created.json()['id']}/models",
        params={"provider_kind": "openai_images"},
    )

    assert listed.status_code == 200
    assert captured_kwargs == {
        "api_key": "secret-model-key",
        "base_url": "https://models.example/v1",
        "default_headers": OPENAI_COMPATIBLE_DEFAULT_HEADERS,
        "timeout": OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
    }
    assert listed.json() == {
        "models": [
            {
                "id": "a-brief-model",
                "label": "a-brief-model",
                "owned_by": "duplicate",
                "created": 1700000000,
            },
            {
                "id": "z-copy-model",
                "label": "z-copy-model",
                "owned_by": "vendor",
                "created": 1700000002,
            },
        ]
    }
    assert "secret-model-key" not in listed.text


def test_provider_model_list_endpoint_validates_profile_and_maps_provider_failures(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    class FailingModels:
        def list(self):
            raise RuntimeError("upstream secret-model-key failed")

    class FailingOpenAI:
        def __init__(self, **kwargs):
            self.models = FailingModels()

    monkeypatch.setattr("inspiration_one_backend.infrastructure.provider_models.OpenAI", FailingOpenAI)

    app = create_app()
    client = TestClient(app)
    _login(client)

    missing_key = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "无 Key 供应商",
            "provider_type": "openai_compatible",
            "base_url": "https://models.example/v1",
            "api_key": None,
            "capabilities": ["text_responses"],
            "default_models": {},
            "config": {},
            "enabled": True,
        },
    )
    assert missing_key.status_code == 200
    missing_key_models = client.get(
        f"/api/settings/provider-profiles/{missing_key.json()['id']}/models",
        params={"provider_kind": "openai"},
    )
    assert missing_key_models.status_code == 400
    assert "缺少 API Key" in missing_key_models.json()["detail"]

    text_only = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "纯文案供应商",
            "provider_type": "openai_compatible",
            "base_url": "https://models.example/v1",
            "api_key": "secret-model-key",
            "capabilities": ["text_responses"],
            "default_models": {},
            "config": {},
            "enabled": True,
        },
    )
    assert text_only.status_code == 200
    wrong_capability = client.get(
        f"/api/settings/provider-profiles/{text_only.json()['id']}/models",
        params={"provider_kind": "openai_images"},
    )
    assert wrong_capability.status_code == 400
    assert "不支持当前接口能力" in wrong_capability.json()["detail"]

    upstream_failure = client.get(
        f"/api/settings/provider-profiles/{text_only.json()['id']}/models",
        params={"provider_kind": "openai"},
    )
    assert upstream_failure.status_code == 502
    assert "供应商模型列表拉取失败" in upstream_failure.json()["detail"]
    assert "secret-model-key" not in upstream_failure.text

    gemini = client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "Gemini 图片",
            "provider_type": "google_gemini",
            "base_url": None,
            "api_key": "google-secret-key",
            "capabilities": ["image_google_gemini"],
            "default_models": {},
            "config": {},
            "enabled": True,
        },
    )
    assert gemini.status_code == 200
    gemini_models = client.get(
        f"/api/settings/provider-profiles/{gemini.json()['id']}/models",
        params={"provider_kind": "google_gemini_image"},
    )
    assert gemini_models.status_code == 400
    assert "Google Gemini 暂不支持" in gemini_models.json()["detail"]


def test_resolvers_ignore_legacy_rows_after_provider_bindings_exist(configured_env: Path) -> None:
    session = get_session_factory()()
    try:
        legacy_rows = [
            AppSetting(key="text_provider_kind", value="openai"),
            AppSetting(key="text_api_key", value="legacy-text-key"),
            AppSetting(key="text_base_url", value="https://legacy-text.example/v1"),
            AppSetting(key="image_provider_kind", value="openai_images"),
            AppSetting(key="image_api_key", value="legacy-image-key"),
            AppSetting(key="image_base_url", value="https://legacy-image.example/v1"),
        ]
        profile = ProviderProfile(
            name="新供应商",
            provider_type="openai_compatible",
            base_url="https://new.example/v1",
            api_key="new-key",
            capabilities_json=["text_responses", "image_images"],
            default_models_json={},
            config_json={},
            enabled=True,
        )
        session.add_all([*legacy_rows, profile])
        session.flush()
        session.add_all(
            [
                ProviderBinding(
                    purpose="text",
                    provider_kind="openai",
                    provider_profile_id=profile.id,
                    model_settings_json={"brief_model": "new-brief", "copy_model": "new-copy"},
                    config_json={},
                ),
                ProviderBinding(
                    purpose="image",
                    provider_kind="openai_images",
                    provider_profile_id=profile.id,
                    model_settings_json={"model": "new-image"},
                    config_json={
                        "images_quality": "high",
                        "images_style": "natural",
                        "responses_background_enabled": True,
                    },
                ),
            ]
        )
        session.commit()
    finally:
        session.close()

    text_config = resolve_text_provider_config()
    assert text_config.api_key == "new-key"
    assert text_config.base_url == "https://new.example/v1"
    assert text_config.brief_model == "new-brief"

    image_config = resolve_image_provider_config()
    assert image_config.api_key == "new-key"
    assert image_config.base_url == "https://new.example/v1"
    assert image_config.model == "new-image"
    assert image_config.images_quality == "high"
    assert image_config.images_style == "natural"
    assert image_config.responses_background_enabled is False


def test_resolvers_reject_missing_models_instead_of_using_legacy_defaults(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TEXT_BRIEF_MODEL", "legacy-env-brief")
    monkeypatch.setenv("TEXT_COPY_MODEL", "legacy-env-copy")
    monkeypatch.setenv("IMAGE_GENERATE_MODEL", "legacy-env-image")
    monkeypatch.setenv("IMAGE_RESPONSES_BACKGROUND_ENABLED", "false")
    get_settings.cache_clear()

    session = get_session_factory()()
    try:
        legacy_rows = [
            AppSetting(key="text_brief_model", value="legacy-db-brief"),
            AppSetting(key="text_copy_model", value="legacy-db-copy"),
            AppSetting(key="image_generate_model", value="legacy-db-image"),
            AppSetting(key="image_responses_background_enabled", value="false"),
        ]
        profile = ProviderProfile(
            name="无模型默认供应商",
            provider_type="openai_compatible",
            base_url="https://new.example/v1",
            api_key="new-key",
            capabilities_json=["text_responses", "image_images"],
            default_models_json={},
            config_json={},
            enabled=True,
        )
        session.add_all([*legacy_rows, profile])
        session.flush()
        session.add_all(
            [
                ProviderBinding(
                    purpose="text",
                    provider_kind="openai",
                    provider_profile_id=profile.id,
                    model_settings_json={},
                    config_json={},
                ),
                ProviderBinding(
                    purpose="image",
                    provider_kind="openai_images",
                    provider_profile_id=profile.id,
                    model_settings_json={},
                    config_json={},
                ),
            ]
        )
        session.commit()
    finally:
        session.close()

    with pytest.raises(RuntimeError) as text_error:
        resolve_text_provider_config()
    assert "文案灵感产物理解模型未配置" in str(text_error.value)

    with pytest.raises(RuntimeError) as image_error:
        resolve_image_provider_config()
    assert "图片模型未配置" in str(image_error.value)


def test_images_api_runtime_options_normalize_and_validate_without_provider_key(configured_env: Path) -> None:
    with pytest.raises(ValueError) as error:
        normalize_config_values({"image_images_quality": "high"})
    assert "未知配置项: image_images_quality" in str(error.value)


def test_settings_api_accepts_and_validates_optional_image_tool_fields(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    initial = client.get("/api/settings")
    assert initial.status_code == 200
    initial_items = {item["key"]: item for item in initial.json()["items"]}
    assert initial_items["image_tool_allowed_fields"]["input_type"] == "multi_select"
    assert initial_items["image_tool_allowed_fields"]["value"] == [
        "model",
        "quality",
        "output_format",
        "output_compression",
        "moderation",
        "action",
        "input_fidelity",
        "partial_images",
    ]
    assert initial_items["image_tool_quality"]["category"] == "图片工具参数"
    assert initial_items["image_tool_quality"]["input_type"] == "select"
    assert initial_items["image_tool_output_compression"]["minimum"] == 0
    assert initial_items["image_tool_output_compression"]["maximum"] == 100
    assert initial_items["image_tool_background"]["input_type"] == "select"
    assert "n" not in {option["value"] for option in initial_items["image_tool_allowed_fields"]["options"]}
    assert "image_tool_n" not in initial_items

    updated = client.patch(
        "/api/settings",
        json={
            "values": {
                "image_tool_allowed_fields": ["model", "quality", "background", "n"],
                "image_tool_model": "gpt-image-2",
                "image_tool_quality": "high",
                "image_tool_output_format": "jpeg",
                "image_tool_output_compression": 82,
                "image_tool_background": "transparent",
                "image_tool_moderation": "low",
                "image_tool_action": "generate",
                "image_tool_input_fidelity": "high",
                "image_tool_partial_images": 2,
            }
        },
    )
    assert updated.status_code == 200
    settings = get_runtime_settings()
    assert settings.image_tool_allowed_fields == "model,quality,background"
    assert settings.image_tool_model == "gpt-image-2"
    assert settings.image_tool_quality == "high"
    assert settings.image_tool_output_format == "jpeg"
    assert settings.image_tool_output_compression == 82
    assert settings.image_tool_background == "transparent"
    assert settings.image_tool_moderation == "low"
    assert settings.image_tool_action == "generate"
    assert settings.image_tool_input_fidelity == "high"
    assert settings.image_tool_partial_images == 2

    invalid_number = client.patch("/api/settings", json={"values": {"image_tool_output_compression": 101}})
    assert invalid_number.status_code == 400
    assert "不能大于 100" in invalid_number.json()["detail"]

    invalid_provider_n = client.patch("/api/settings", json={"values": {"image_tool_n": 3}})
    assert invalid_provider_n.status_code == 400
    assert "未知配置项" in invalid_provider_n.json()["detail"]

    invalid_select = client.patch("/api/settings", json={"values": {"image_tool_quality": "ultra"}})
    assert invalid_select.status_code == 400
    assert "必须是以下之一" in invalid_select.json()["detail"]

    invalid_field = client.patch("/api/settings", json={"values": {"image_tool_allowed_fields": ["quality", "bogus"]}})
    assert invalid_field.status_code == 400
    assert "可用 Tool 字段包含不支持的字段" in invalid_field.json()["detail"]

    runtime = client.get("/api/settings/runtime")
    assert runtime.status_code == 200
    assert runtime.json()["image_tool_allowed_fields"] == ["model", "quality", "background"]

    cleared = client.patch("/api/settings", json={"values": {"image_tool_output_compression": ""}})
    assert cleared.status_code == 200
    assert get_runtime_settings().image_tool_output_compression is None


def test_prompt_settings_api_accepts_rejects_and_resets(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    initial = client.get("/api/settings")
    assert initial.status_code == 200
    initial_items = {item["key"]: item for item in initial.json()["items"]}
    assert initial_items["prompt_copy_system"]["category"] == "提示词"
    assert initial_items["prompt_copy_system"]["input_type"] == "textarea"
    assert initial_items["prompt_copy_system"]["secret"] is False
    assert initial_items["prompt_copy_system"]["source"] == "env_default"
    assert "内容生成助手" in initial_items["prompt_copy_system"]["value"]
    assert initial_items["prompt_poster_image_edit_template"]["category"] == "提示词"
    assert initial_items["prompt_poster_image_edit_template"]["input_type"] == "textarea"
    assert "显式连接的上游上下文" in initial_items["prompt_poster_image_edit_template"]["value"]
    assert initial_items["prompt_poster_image_reference_policy"]["category"] == "提示词"
    assert initial_items["prompt_poster_image_reference_policy"]["input_type"] == "textarea"
    assert (
        "输入图片中的主体、结构、材质、风格或场景作为视觉基准"
        in initial_items["prompt_poster_image_reference_policy"]["value"]
    )

    updated = client.patch("/api/settings", json={"values": {"prompt_copy_system": "自定义文案系统提示"}})
    assert updated.status_code == 200
    updated_items = {item["key"]: item for item in updated.json()["items"]}
    assert updated_items["prompt_copy_system"]["value"] == "自定义文案系统提示"
    assert updated_items["prompt_copy_system"]["source"] == "database"

    empty = client.patch("/api/settings", json={"values": {"prompt_copy_system": "   "}})
    assert empty.status_code == 400
    assert "不能为空" in empty.json()["detail"]

    reset = client.patch("/api/settings", json={"reset_keys": ["prompt_copy_system"]})
    assert reset.status_code == 200
    reset_items = {item["key"]: item for item in reset.json()["items"]}
    assert reset_items["prompt_copy_system"]["source"] == "env_default"
    assert "内容生成助手" in reset_items["prompt_copy_system"]["value"]


def test_settings_api_rejects_invalid_effective_config(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.patch(
        "/api/settings",
        json={"values": {"image_main_image_size": "0x1024"}},
    )

    assert response.status_code == 400
    assert "主图尺寸" in response.json()["detail"]


def test_settings_api_rejects_malformed_image_sizes_before_persist(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.patch(
        "/api/settings",
        json={
            "values": {
                "image_main_image_size": "foo",
                "image_promo_poster_size": "foo",
            }
        },
    )

    assert response.status_code == 400
    assert "宽x高" in response.json()["detail"]

    session = get_session_factory()()
    try:
        assert session.get(AppSetting, "image_main_image_size") is None
        assert session.get(AppSetting, "image_promo_poster_size") is None
    finally:
        session.close()


def test_settings_api_normalizes_custom_image_sizes_for_generation(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    updated = client.patch(
        "/api/settings",
        json={
            "values": {
                "image_main_image_size": "512X512",
                "image_promo_poster_size": "1024x768",
            }
        },
    )
    assert updated.status_code == 200
    updated_items = {item["key"]: item for item in updated.json()["items"]}
    assert updated_items["image_main_image_size"]["value"] == "512x512"

    created = client.post("/api/image-sessions", json={"title": "自定义尺寸"})
    assert created.status_code == 201
    session_id = created.json()["id"]

    generated = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张自定义尺寸灵感产物图",
            "size": "512x512",
        },
    )

    assert generated.status_code == 202
    assert generated.json()["rounds"][-1]["size"] == "512x512"


def test_runtime_image_size_env_defaults_are_generation_bounded(configured_env: Path, monkeypatch) -> None:
    monkeypatch.setenv("IMAGE_MAIN_IMAGE_SIZE", "4000x4000")
    monkeypatch.setenv("IMAGE_PROMO_POSTER_SIZE", "5000x2500")
    get_settings.cache_clear()

    settings = get_runtime_settings()

    assert settings.image_main_image_size == "2880x2880"
    assert settings.image_promo_poster_size == "3840x1920"


def test_image_generation_max_dimension_runtime_config_controls_size_bounds(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    runtime = client.get("/api/settings/runtime")
    assert runtime.status_code == 200
    assert runtime.json() == {
        "ui_layout_scheme": "classic",
        "image_generation_max_dimension": 3840,
        "image_session_max_base_images": 6,
        "image_tool_allowed_fields": [
            "model",
            "quality",
            "output_format",
            "output_compression",
            "moderation",
            "action",
            "input_fidelity",
            "partial_images",
        ],
        "text_generation_max_concurrent_tasks": 3,
        "image_generation_max_concurrent_tasks": 3,
        "generation_tail_splitter_max_items": 36,
        "workflow_node_max_retry_count": 10,
        "workflow_node_retry_delay_ms": 2000,
        "gallery_show_generation_resource_group": True,
        "deletion_enabled": False,
    }

    updated = client.patch(
        "/api/settings",
        json={"values": {"image_generation_max_dimension": 2048}},
    )
    assert updated.status_code == 200
    items = {item["key"]: item for item in updated.json()["items"]}
    assert items["image_generation_max_dimension"]["value"] == 2048
    assert get_runtime_settings().image_generation_max_dimension == 2048

    created = client.post("/api/image-sessions", json={"title": "运行时尺寸上限"})
    assert created.status_code == 201
    generated = client.post(
        f"/api/image-sessions/{created.json()['id']}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "尺寸应被运行时上限校准",
            "size": "3840x2160",
        },
    )
    assert generated.status_code == 202
    assert generated.json()["rounds"][-1]["size"] == "2048x1152"

    rejected = client.patch(
        "/api/settings",
        json={"values": {"image_generation_max_dimension": 256}},
    )
    assert rejected.status_code == 400
    assert "不能小于 512" in rejected.json()["detail"]


def test_legacy_image_chat_route_is_removed(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/image-chat/generate",
        json={"prompt": "做一张白底灵感产物图", "size": "1024x1024"},
    )
    assert response.status_code == 404
