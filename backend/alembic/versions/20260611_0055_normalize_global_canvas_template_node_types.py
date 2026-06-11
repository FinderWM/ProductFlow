"""normalize global canvas template node types

Revision ID: 20260611_0055
Revises: 20260610_0054
Create Date: 2026-06-11 00:00:00.000000
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa

from alembic import op

revision = "20260611_0055"
down_revision = "20260610_0054"
branch_labels = None
depends_on = None

GLOBAL_TEMPLATE_SCOPE = "global"
NODE_TYPE_ALIASES_UPGRADE = {"product_context": "inspiration_context"}
NODE_TYPE_ALIASES_DOWNGRADE = {"inspiration_context": "product_context"}


def upgrade() -> None:
    _rewrite_global_template_payloads(
        node_type_aliases=NODE_TYPE_ALIASES_UPGRADE,
    )


def downgrade() -> None:
    _rewrite_global_template_payloads(
        node_type_aliases=NODE_TYPE_ALIASES_DOWNGRADE,
    )


def _rewrite_global_template_payloads(
    *,
    node_type_aliases: dict[str, str],
) -> None:
    connection = op.get_bind()
    canvas_templates = sa.table(
        "canvas_templates",
        sa.column("id", sa.String()),
        sa.column("scope", sa.String()),
        sa.column("template_json", sa.JSON()),
    )
    rows = connection.execute(
        sa.select(canvas_templates.c.id, canvas_templates.c.template_json).where(
            canvas_templates.c.scope == GLOBAL_TEMPLATE_SCOPE
        )
    ).mappings().all()
    for row in rows:
        raw_payload = _json_object(row["template_json"])
        normalized_payload = _normalize_template_payload(
            raw_payload,
            node_type_aliases=node_type_aliases,
        )
        if normalized_payload != raw_payload:
            connection.execute(
                canvas_templates.update()
                .where(canvas_templates.c.id == row["id"])
                .values(template_json=normalized_payload)
            )


def _normalize_template_payload(
    payload: dict[str, Any],
    *,
    node_type_aliases: dict[str, str],
) -> dict[str, Any]:
    normalized = dict(payload)

    nodes = normalized.get("nodes")
    if isinstance(nodes, list):
        normalized["nodes"] = [
            _normalize_template_node(node, node_type_aliases=node_type_aliases) for node in nodes
        ]

    return normalized


def _normalize_template_node(node: Any, *, node_type_aliases: dict[str, str]) -> Any:
    if not isinstance(node, dict):
        return node
    normalized = dict(node)
    node_type = normalized.get("node_type")
    if isinstance(node_type, str) and node_type in node_type_aliases:
        normalized["node_type"] = node_type_aliases[node_type]
    return normalized


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise TypeError("canvas template template_json must be a JSON object") from exc
        if isinstance(parsed, dict):
            return parsed
    raise TypeError("canvas template template_json must be a JSON object")
