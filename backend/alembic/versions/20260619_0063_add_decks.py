"""add decks and deck_slides

Revision ID: 20260619_0063
Revises: 20260619_0062
Create Date: 2026-06-19
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260619_0063"
down_revision = "20260619_0062"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    table_names = _table_names()
    if "decks" not in table_names:
        op.create_table(
            "decks",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("inspiration_id", sa.String(length=36), nullable=False),
            sa.Column("resource_group_id", sa.String(length=36), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("status", sa.String(length=17), nullable=False),
            sa.Column("source_input", sa.Text(), nullable=True),
            sa.Column("outline_json", sa.JSON(), nullable=True),
            sa.Column("style_key", sa.String(length=80), nullable=True),
            sa.Column("style_reference_asset_id", sa.String(length=36), nullable=True),
            sa.Column("speaker_notes_enabled", sa.Boolean(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("pptx_storage_path", sa.String(length=500), nullable=True),
            sa.Column("pptx_storage_backend", sa.String(length=50), nullable=True),
            sa.Column("pptx_storage_bucket", sa.String(length=255), nullable=True),
            sa.Column("pptx_storage_object_key", sa.String(length=500), nullable=True),
            sa.Column("pptx_generated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_decks_inspiration_id" not in _index_names("decks"):
        op.create_index("ix_decks_inspiration_id", "decks", ["inspiration_id"], unique=False)

    table_names = _table_names()
    if "deck_slides" not in table_names:
        op.create_table(
            "deck_slides",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("deck_id", sa.String(length=36), nullable=False),
            sa.Column("order_index", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("points_json", sa.JSON(), nullable=True),
            sa.Column("speaker_notes", sa.Text(), nullable=True),
            sa.Column("slide_status", sa.String(length=9), nullable=False),
            sa.Column("attempts", sa.Integer(), nullable=False),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("image_storage_path", sa.String(length=500), nullable=True),
            sa.Column("image_storage_backend", sa.String(length=50), nullable=True),
            sa.Column("image_storage_bucket", sa.String(length=255), nullable=True),
            sa.Column("image_storage_object_key", sa.String(length=500), nullable=True),
            sa.Column("image_mime_type", sa.String(length=100), nullable=True),
            sa.Column("image_width", sa.Integer(), nullable=True),
            sa.Column("image_height", sa.Integer(), nullable=True),
            sa.Column("material_source", sa.String(length=16), nullable=True),
            sa.Column("material_storage_path", sa.String(length=500), nullable=True),
            sa.Column("material_storage_backend", sa.String(length=50), nullable=True),
            sa.Column("material_storage_bucket", sa.String(length=255), nullable=True),
            sa.Column("material_storage_object_key", sa.String(length=500), nullable=True),
            sa.Column("material_mime_type", sa.String(length=100), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_deck_slides_deck_id" not in _index_names("deck_slides"):
        op.create_index("ix_deck_slides_deck_id", "deck_slides", ["deck_id"], unique=False)


def downgrade() -> None:
    table_names = _table_names()
    if "deck_slides" in table_names:
        if "ix_deck_slides_deck_id" in _index_names("deck_slides"):
            op.drop_index("ix_deck_slides_deck_id", table_name="deck_slides")
        op.drop_table("deck_slides")

    table_names = _table_names()
    if "decks" in table_names:
        if "ix_decks_inspiration_id" in _index_names("decks"):
            op.drop_index("ix_decks_inspiration_id", table_name="decks")
        op.drop_table("decks")
