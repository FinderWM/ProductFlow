from __future__ import annotations

from typing import Any, Literal

from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.generation_config_runtime import GenerationConfigSelection
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import Deck, GenerationConfig, Inspiration, WorkflowNode
from inspiration_one_backend.infrastructure.provider_config import (
    TEXT_PURPOSE,
    generation_config_resource_group_ids,
)

DeckGenerationPurpose = Literal["text", "image"]

_TEXT_MODE_KEY = "text_generation_config_mode"
_TEXT_ID_KEY = "text_generation_config_id"
_IMAGE_MODE_KEY = "image_generation_config_mode"
_IMAGE_ID_KEY = "image_generation_config_id"
DECK_SLIDE_SIZE_OPTIONS = ("2048x1152", "1920x1080", "1280x720")
DEFAULT_DECK_SLIDE_SIZE = DECK_SLIDE_SIZE_OPTIONS[0]


def deck_generation_config_selection_from_config(
    raw_config: dict[str, Any] | None,
    *,
    purpose: DeckGenerationPurpose,
    resource_group_id: str | None = None,
) -> GenerationConfigSelection:
    config = raw_config or {}
    mode_key, id_key = _deck_generation_config_keys(purpose)
    mode = str(config.get(mode_key) or "auto").strip().lower()
    generation_config_id = _optional_text(config.get(id_key))
    resolved_resource_group_id = resource_group_id or _optional_text(config.get("resource_group_id"))
    if mode != "manual":
        return GenerationConfigSelection(
            mode="auto",
            generation_config_id=None,
            resource_group_id=resolved_resource_group_id,
        )
    return GenerationConfigSelection(
        mode="manual",
        generation_config_id=generation_config_id,
        resource_group_id=resolved_resource_group_id,
    )


def require_deck_generation_config_selection(
    session: Session,
    *,
    raw_config: dict[str, Any] | None,
    purpose: DeckGenerationPurpose,
    actor_user_id: str | None,
    actor_is_admin: bool,
    resource_group_id: str | None = None,
) -> GenerationConfigSelection:
    selection = deck_generation_config_selection_from_config(
        raw_config,
        purpose=purpose,
        resource_group_id=resource_group_id,
    )
    return validate_deck_generation_config_selection(
        session,
        selection=selection,
        purpose=purpose,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def validate_deck_generation_config_selection(
    session: Session,
    *,
    selection: GenerationConfigSelection,
    purpose: DeckGenerationPurpose,
    actor_user_id: str | None,
    actor_is_admin: bool,
) -> GenerationConfigSelection:
    if not selection.resource_group_id:
        raise BusinessValidationError("请选择供应商生成分组")
    if selection.mode == "manual" and not selection.generation_config_id:
        raise BusinessValidationError("手动指定生成配置时必须选择配置")
    group = require_generation_resource_group_for_user(
        session,
        user_id=actor_user_id,
        is_admin=actor_is_admin,
        resource_group_id=selection.resource_group_id,
    )
    authorized_selection = GenerationConfigSelection(
        mode=selection.mode,
        generation_config_id=selection.generation_config_id,
        resource_group_id=group.id,
    )
    if authorized_selection.mode != "manual":
        return authorized_selection
    generation_config = session.get(GenerationConfig, authorized_selection.generation_config_id)
    if generation_config is None or generation_config.archived_at is not None:
        raise BusinessValidationError("生成配置不存在")
    if generation_config.purpose != purpose:
        raise BusinessValidationError(_deck_generation_config_purpose_error(purpose))
    if group.id not in generation_config_resource_group_ids(generation_config):
        raise BusinessValidationError("手动指定的生成配置不属于当前供应商生成分组")
    return authorized_selection


def resolve_deck_generation_config_selection_for_execution(
    session: Session,
    *,
    deck: Deck,
    purpose: DeckGenerationPurpose,
) -> GenerationConfigSelection:
    fallback = GenerationConfigSelection(resource_group_id=deck.resource_group_id)
    if not deck.workflow_node_id:
        return fallback
    deck_node = session.get(WorkflowNode, deck.workflow_node_id)
    if deck_node is None:
        return fallback
    inspiration = session.get(Inspiration, deck.inspiration_id)
    if inspiration is None:
        return fallback
    return require_deck_generation_config_selection(
        session,
        raw_config=deck_node.config_json,
        purpose=purpose,
        actor_user_id=inspiration.owner_user_id,
        actor_is_admin=bool(inspiration.owner and inspiration.owner.is_admin),
        resource_group_id=(
            _optional_text(deck_node.config_json.get("resource_group_id"))
            if isinstance(deck_node.config_json, dict)
            else None
        )
        or deck.resource_group_id,
    )


def normalize_deck_slide_size(value: Any) -> str | None:
    normalized = _optional_text(value)
    if normalized in DECK_SLIDE_SIZE_OPTIONS:
        return normalized
    return None


def resolve_deck_slide_size_for_execution(session: Session, *, deck: Deck) -> str:
    node_slide_size: str | None = None
    if deck.workflow_node_id:
        deck_node = session.get(WorkflowNode, deck.workflow_node_id)
        if deck_node is not None and isinstance(deck_node.config_json, dict):
            node_slide_size = normalize_deck_slide_size(deck_node.config_json.get("deck_slide_size"))
    runtime_slide_size = normalize_deck_slide_size(get_runtime_settings().deck_slide_size)
    return node_slide_size or runtime_slide_size or DEFAULT_DECK_SLIDE_SIZE


def deck_generation_config_keys_for_purpose(purpose: DeckGenerationPurpose) -> tuple[str, str]:
    return _deck_generation_config_keys(purpose)


def _deck_generation_config_keys(purpose: DeckGenerationPurpose) -> tuple[str, str]:
    if purpose == TEXT_PURPOSE:
        return _TEXT_MODE_KEY, _TEXT_ID_KEY
    return _IMAGE_MODE_KEY, _IMAGE_ID_KEY


def _deck_generation_config_purpose_error(purpose: DeckGenerationPurpose) -> str:
    if purpose == TEXT_PURPOSE:
        return "演示文稿文案只能使用文案生成配置"
    return "演示文稿图片只能使用图片生成配置"


def _optional_text(value: Any) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None
