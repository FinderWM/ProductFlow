"""backfill image session current resource group

Revision ID: 20260608_0047
Revises: 20260608_0046
Create Date: 2026-06-08
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260608_0047"
down_revision = "20260608_0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            """
            UPDATE image_sessions
            SET resource_group_id = (
                SELECT current_events.resource_group_id
                FROM (
                    SELECT
                        image_session_rounds.resource_group_id AS resource_group_id,
                        image_session_rounds.created_at AS event_at,
                        0 AS event_order,
                        image_session_rounds.id AS event_id
                    FROM image_session_rounds
                    WHERE image_session_rounds.session_id = image_sessions.id
                      AND image_session_rounds.resource_group_id IS NOT NULL
                    UNION ALL
                    SELECT
                        image_session_generation_tasks.resource_group_id AS resource_group_id,
                        COALESCE(
                            image_session_generation_tasks.finished_at,
                            image_session_generation_tasks.progress_updated_at,
                            image_session_generation_tasks.started_at,
                            image_session_generation_tasks.created_at
                        ) AS event_at,
                        1 AS event_order,
                        image_session_generation_tasks.id AS event_id
                    FROM image_session_generation_tasks
                    WHERE image_session_generation_tasks.session_id = image_sessions.id
                      AND image_session_generation_tasks.resource_group_id IS NOT NULL
                ) AS current_events
                ORDER BY current_events.event_at DESC,
                         current_events.event_order DESC,
                         current_events.event_id DESC
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1
                FROM image_session_rounds
                WHERE image_session_rounds.session_id = image_sessions.id
                  AND image_session_rounds.resource_group_id IS NOT NULL
            )
            OR EXISTS (
                SELECT 1
                FROM image_session_generation_tasks
                WHERE image_session_generation_tasks.session_id = image_sessions.id
                  AND image_session_generation_tasks.resource_group_id IS NOT NULL
            )
            """
        )
    )


def downgrade() -> None:
    # The previous assignment cannot be reconstructed after newer calls overwrite the session-level group.
    return
