"""Tests for provider capabilities and resolution limits."""

import pytest
from sqlalchemy.orm import Session

from inspiration_one_backend.infrastructure.db.models import GenerationConfig, ProviderProfile
from inspiration_one_backend.infrastructure.provider_config import (
    ProviderCapabilities,
    create_provider_profile,
    enforce_generation_config_resolution,
    get_provider_capabilities,
    parse_image_size_dimensions,
    resolve_effective_max_dimension,
    update_provider_profile,
)


def test_provider_capabilities_parsing_none():
    """Empty capabilities dict returns image_max_dimension=None."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {}},
    )
    caps = get_provider_capabilities(profile)
    assert caps.image_max_dimension is None


def test_provider_capabilities_parsing_missing_key():
    """config_json={} returns image_max_dimension=None."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={},
    )
    caps = get_provider_capabilities(profile)
    assert caps.image_max_dimension is None


def test_provider_capabilities_parsing_2048():
    """JSON with image_max_dimension=2048 returns 2048."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {"image_max_dimension": 2048}},
    )
    caps = get_provider_capabilities(profile)
    assert caps.image_max_dimension == 2048


def test_provider_capabilities_parsing_normalizes_step():
    """JSON with image_max_dimension=2050 returns normalized 2048."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {"image_max_dimension": 2050}},
    )
    caps = get_provider_capabilities(profile)
    assert caps.image_max_dimension == 2048


def test_provider_capabilities_mock_profile():
    """provider_profile=None returns default capabilities."""
    caps = get_provider_capabilities(None)
    assert isinstance(caps, ProviderCapabilities)
    assert caps.image_max_dimension is None


def test_resolve_effective_max_dimension_none():
    """provider_max=None, global=3840 → 3840."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={},
    )
    result = resolve_effective_max_dimension(profile, 3840)
    assert result == 3840


def test_resolve_effective_max_dimension_lower():
    """provider_max=2048, global=3840 → 2048."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {"image_max_dimension": 2048}},
    )
    result = resolve_effective_max_dimension(profile, 3840)
    assert result == 2048


def test_resolve_effective_max_dimension_higher():
    """provider_max=4096, global=3840 → 3840."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {"image_max_dimension": 4096}},
    )
    result = resolve_effective_max_dimension(profile, 3840)
    assert result == 3840


def test_parse_image_size_dimensions():
    """Parse '1024x768' → (1024, 768)."""
    width, height = parse_image_size_dimensions("1024x768")
    assert width == 1024
    assert height == 768


def test_parse_image_size_dimensions_invalid():
    """Invalid format raises ValueError."""
    with pytest.raises(ValueError, match="Invalid image size format"):
        parse_image_size_dimensions("1024")

    with pytest.raises(ValueError, match="Invalid image size dimensions"):
        parse_image_size_dimensions("1024xabc")


def test_enforce_resolution_within_limit():
    """1024×1024, provider_max=2048 → pass."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {"image_max_dimension": 2048}},
    )
    config = GenerationConfig(
        name="测试配置",
        purpose="image",
        provider_kind="openai_images",
        provider_profile_id=profile.id,
        provider_profile=profile,
    )
    # Should not raise
    enforce_generation_config_resolution(1024, 1024, config, profile, 3840)


def test_enforce_resolution_exceeds_provider():
    """2048×2048, provider_max=1024 → ValueError with provider name."""
    profile = ProviderProfile(
        name="供应商A",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {"image_max_dimension": 1024}},
    )
    config = GenerationConfig(
        name="测试配置",
        purpose="image",
        provider_kind="openai_images",
        provider_profile_id=profile.id,
        provider_profile=profile,
    )
    with pytest.raises(ValueError, match="供应商 供应商A 最大分辨率限制为 1024，请求 2048 超限"):
        enforce_generation_config_resolution(2048, 2048, config, profile, 3840)


def test_enforce_resolution_exceeds_global():
    """4096×4096, provider_max=None, global=3840 → ValueError."""
    profile = ProviderProfile(
        name="供应商B",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={},
    )
    config = GenerationConfig(
        name="测试配置",
        purpose="image",
        provider_kind="openai_images",
        provider_profile_id=profile.id,
        provider_profile=profile,
    )
    # When provider_max is None, effective_max = global, so error message includes provider name
    with pytest.raises(ValueError, match="供应商 供应商B 最大分辨率限制为 3840，请求 4096 超限"):
        enforce_generation_config_resolution(4096, 4096, config, profile, 3840)


def test_enforce_resolution_at_boundary():
    """2048×2048, provider_max=2048 → pass."""
    profile = ProviderProfile(
        name="测试",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities_json=["image"],
        config_json={"capabilities": {"image_max_dimension": 2048}},
    )
    config = GenerationConfig(
        name="测试配置",
        purpose="image",
        provider_kind="openai_images",
        provider_profile_id=profile.id,
        provider_profile=profile,
    )
    # Should not raise
    enforce_generation_config_resolution(2048, 2048, config, profile, 3840)


def test_enforce_resolution_mock_profile():
    """mock (provider=None), 1024×1024 → pass."""
    config = GenerationConfig(
        name="测试配置",
        purpose="image",
        provider_kind="mock",
    )
    # Should not raise
    enforce_generation_config_resolution(1024, 1024, config, None, 3840)


def test_create_provider_profile_normalizes_image_max_dimension(db_session: Session):
    """Create profile stores normalized provider image max dimension."""
    profile = create_provider_profile(
        db_session,
        name="测试供应商",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities=["image_images"],
        config={"capabilities": {"image_max_dimension": 2050}},
    )
    assert profile.config_json == {"capabilities": {"image_max_dimension": 2048}}


def test_update_provider_profile_normalizes_image_max_dimension(db_session: Session):
    """Update profile stores normalized provider image max dimension."""
    profile = create_provider_profile(
        db_session,
        name="测试供应商",
        provider_type="openai_compatible",
        base_url="http://test",
        api_key="key",
        capabilities=["image_images"],
        config={},
    )

    updated = update_provider_profile(
        db_session,
        profile.id,
        config={"capabilities": {"image_max_dimension": 2817}},
    )
    assert updated.config_json == {"capabilities": {"image_max_dimension": 2816}}
