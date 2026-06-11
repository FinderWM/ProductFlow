"""add gallery entry view events

Revision ID: 20260611_0056
Revises: 20260611_0055
Create Date: 2026-06-11
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260611_0056"
down_revision = "20260611_0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "image_gallery_entry_view_events" in inspector.get_table_names():
        return
    op.create_table(
        "image_gallery_entry_view_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("gallery_entry_id", sa.String(length=36), nullable=False),
        sa.Column("viewer_key", sa.String(length=128), nullable=False),
        sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_image_gallery_entry_view_events_entry_id",
        "image_gallery_entry_view_events",
        ["gallery_entry_id"],
        unique=False,
    )
    op.create_index(
        "ix_image_gallery_entry_view_events_dedup",
        "image_gallery_entry_view_events",
        ["gallery_entry_id", "viewer_key", "viewed_at"],
        unique=False,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "image_gallery_entry_view_events" not in inspector.get_table_names():
        return
    op.drop_index(
        "ix_image_gallery_entry_view_events_dedup",
        table_name="image_gallery_entry_view_events",
    )
    op.drop_index(
        "ix_image_gallery_entry_view_events_entry_id",
        table_name="image_gallery_entry_view_events",
    )
    op.drop_table("image_gallery_entry_view_events")
