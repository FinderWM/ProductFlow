from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from inspiration_one_backend.infrastructure.provider_config import (
    TEXT_STRUCTURED_OUTPUT_MODE_JSON_OBJECT,
    TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA,
    TextStructuredOutputConfig,
)


@dataclass(frozen=True, slots=True)
class TextStructuredOutputSchema:
    name: str
    schema: dict[str, Any]
    description: str


def responses_text_config(
    config: TextStructuredOutputConfig,
    schema: TextStructuredOutputSchema,
) -> dict[str, Any] | None:
    if not config.enabled:
        return None
    if config.mode == TEXT_STRUCTURED_OUTPUT_MODE_JSON_OBJECT:
        return {"format": {"type": "json_object"}}
    if config.mode == TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA:
        return {
            "format": {
                "type": "json_schema",
                "name": schema.name,
                "description": schema.description,
                "schema": deepcopy(schema.schema),
                "strict": True,
            }
        }
    raise ValueError(f"暂不支持的文案结构化输出模式: {config.mode}")


def chat_response_format(
    config: TextStructuredOutputConfig,
    schema: TextStructuredOutputSchema,
) -> dict[str, Any] | None:
    if not config.enabled:
        return None
    if config.mode == TEXT_STRUCTURED_OUTPUT_MODE_JSON_OBJECT:
        return {"type": "json_object"}
    if config.mode == TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": schema.name,
                "description": schema.description,
                "schema": deepcopy(schema.schema),
                "strict": True,
            },
        }
    raise ValueError(f"暂不支持的文案结构化输出模式: {config.mode}")


def structured_output_instructions(
    instructions: str,
    config: TextStructuredOutputConfig,
    schema: TextStructuredOutputSchema,
) -> str:
    if not config.enabled:
        return instructions
    return (
        f"{instructions.rstrip()}\n"
        f"请只输出 JSON 对象，字段必须符合 {schema.name} 结构，不要输出 markdown、标题或解释。"
    )


def read_polished_prompt_from_payload(payload: dict[str, Any]) -> str:
    value = payload.get("polished_prompt")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("文案 provider 未返回润色结果")
    return value.strip()


BRIEF_SCHEMA = TextStructuredOutputSchema(
    name="creative_brief",
    description="Structured creative brief for copy and poster generation.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["positioning", "audience", "selling_angles", "taboo_phrases", "poster_style_hint"],
        "properties": {
            "positioning": {"type": "string"},
            "audience": {"type": "string"},
            "selling_angles": {
                "type": "array",
                "minItems": 3,
                "maxItems": 5,
                "items": {"type": "string"},
            },
            "taboo_phrases": {"type": "array", "items": {"type": "string"}},
            "poster_style_hint": {"type": "string"},
        },
    },
)


_COPY_BLOCK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "role", "label", "text", "note", "visual_hint", "priority"],
    "properties": {
        "id": {"type": "string"},
        "role": {"type": ["string", "null"]},
        "label": {"type": ["string", "null"]},
        "text": {"type": "string"},
        "note": {"type": ["string", "null"]},
        "visual_hint": {"type": ["string", "null"]},
        "priority": {"type": ["integer", "null"]},
    },
}

_COPY_SECTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "title", "body", "items", "visual_hint"],
    "properties": {
        "id": {"type": "string"},
        "title": {"type": ["string", "null"]},
        "body": {"type": ["string", "null"]},
        "items": {"type": "array", "items": _COPY_BLOCK_SCHEMA},
        "visual_hint": {"type": ["string", "null"]},
    },
}

COPY_SCHEMA = TextStructuredOutputSchema(
    name="copy_payload_v2",
    description="Structured v2 copy payload for editable text output.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["version", "purpose", "summary", "content", "visual_guidance"],
        "properties": {
            "version": {"type": "integer", "enum": [2]},
            "purpose": {"type": ["string", "null"]},
            "summary": {"type": "string"},
            "content": {
                "anyOf": [
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["kind", "text"],
                        "properties": {
                            "kind": {"type": "string", "enum": ["freeform"]},
                            "text": {"type": "string"},
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["kind", "blocks"],
                        "properties": {
                            "kind": {"type": "string", "enum": ["blocks"]},
                            "blocks": {"type": "array", "minItems": 1, "items": _COPY_BLOCK_SCHEMA},
                        },
                    },
                    {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["kind", "sections"],
                        "properties": {
                            "kind": {"type": "string", "enum": ["layout_brief"]},
                            "sections": {"type": "array", "minItems": 1, "items": _COPY_SECTION_SCHEMA},
                        },
                    },
                ]
            },
            "visual_guidance": {
                "type": ["object", "null"],
                "additionalProperties": False,
                "required": ["main_message", "hierarchy", "composition_hint", "text_density", "avoid"],
                "properties": {
                    "main_message": {"type": ["string", "null"]},
                    "hierarchy": {"type": "array", "items": {"type": "string"}},
                    "composition_hint": {"type": ["string", "null"]},
                    "text_density": {"type": ["string", "null"], "enum": ["none", "low", "medium", "high", None]},
                    "avoid": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
)

TAIL_SPLIT_SCHEMA = TextStructuredOutputSchema(
    name="tail_split_plan",
    description="Structured plan for splitting long upstream content into image prompts.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["source_summary", "items"],
        "properties": {
            "source_summary": {"type": "string"},
            "items": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "instruction", "visual_intent", "source_refs"],
                    "properties": {
                        "title": {"type": "string"},
                        "instruction": {"type": "string"},
                        "visual_intent": {"type": "string"},
                        "source_refs": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        },
    },
)

POLISHED_PROMPT_SCHEMA = TextStructuredOutputSchema(
    name="polished_image_prompt",
    description="Structured polished image prompt output.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["polished_prompt"],
        "properties": {"polished_prompt": {"type": "string"}},
    },
)

STRUCTURED_OUTPUT_TEST_SCHEMA = TextStructuredOutputSchema(
    name="text_structured_output_test",
    description="Small schema used to test provider structured output support.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["ok", "kind", "items"],
        "properties": {
            "ok": {"type": "boolean"},
            "kind": {"type": "string"},
            "items": {"type": "array", "items": {"type": "string"}},
        },
    },
)

DECK_OUTLINE_SCHEMA = TextStructuredOutputSchema(
    name="deck_outline",
    description="Structured outline for an image-based slide deck.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["title", "slides"],
        "properties": {
            "title": {"type": "string"},
            "slides": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["title", "points", "material_hint"],
                    "properties": {
                        "title": {"type": "string"},
                        "points": {"type": "array", "items": {"type": "string"}},
                        "material_hint": {"type": ["string", "null"]},
                    },
                },
            },
        },
    },
)

SPEAKER_NOTES_SCHEMA = TextStructuredOutputSchema(
    name="deck_speaker_notes",
    description="Structured speaker notes for a single slide.",
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["notes"],
        "properties": {"notes": {"type": "string"}},
    },
)

