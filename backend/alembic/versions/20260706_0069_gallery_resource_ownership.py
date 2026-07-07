"""gallery and resource ownership storage

Revision ID: 20260706_0069
Revises: 20260703_0068
Create Date: 2026-07-06
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260706_0069"
down_revision = "20260703_0068"
branch_labels = None
depends_on = None


def _table_names() -> set[str]:
    bind = op.get_bind()
    return set(sa.inspect(bind).get_table_names())


def _column_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_names(table_name: str) -> set[str]:
    bind = op.get_bind()
    return {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    table_names = _table_names()
    if "image_sessions" in table_names:
        _upgrade_image_sessions()
    if "image_gallery_entries" in table_names:
        _upgrade_gallery_entries()


def downgrade() -> None:
    table_names = _table_names()
    if "image_gallery_entries" in table_names:
        _downgrade_gallery_entries()
    if "image_sessions" in table_names:
        _downgrade_image_sessions()


def _upgrade_image_sessions() -> None:
    columns = _column_names("image_sessions")
    indexes = _index_names("image_sessions")
    if "is_temporary_test" not in columns:
        with op.batch_alter_table("image_sessions") as batch_op:
            batch_op.add_column(
                sa.Column("is_temporary_test", sa.Boolean(), nullable=False, server_default=sa.false())
            )
    if "ix_image_sessions_temporary_test" not in indexes:
        op.create_index("ix_image_sessions_temporary_test", "image_sessions", ["is_temporary_test"])
    if "is_temporary_test" not in columns:
        with op.batch_alter_table("image_sessions") as batch_op:
            batch_op.alter_column(
                "is_temporary_test",
                existing_type=sa.Boolean(),
                nullable=False,
                server_default=None,
            )


def _downgrade_image_sessions() -> None:
    columns = _column_names("image_sessions")
    indexes = _index_names("image_sessions")
    if "ix_image_sessions_temporary_test" in indexes:
        op.drop_index("ix_image_sessions_temporary_test", table_name="image_sessions")
    if "is_temporary_test" in columns:
        with op.batch_alter_table("image_sessions") as batch_op:
            batch_op.drop_column("is_temporary_test")


def _upgrade_gallery_entries() -> None:
    columns = _column_names("image_gallery_entries")
    indexes = _index_names("image_gallery_entries")
    if "uq_image_gallery_entries_asset_id" in indexes:
        op.drop_index("uq_image_gallery_entries_asset_id", table_name="image_gallery_entries")

    with op.batch_alter_table("image_gallery_entries") as batch_op:
        if "original_filename" not in columns:
            batch_op.add_column(sa.Column("original_filename", sa.String(length=255), nullable=True))
        if "mime_type" not in columns:
            batch_op.add_column(sa.Column("mime_type", sa.String(length=100), nullable=True))
        if "storage_path" not in columns:
            batch_op.add_column(sa.Column("storage_path", sa.String(length=500), nullable=True))
        if "storage_backend" not in columns:
            batch_op.add_column(sa.Column("storage_backend", sa.String(length=50), nullable=True))
        if "storage_bucket" not in columns:
            batch_op.add_column(sa.Column("storage_bucket", sa.String(length=255), nullable=True))
        if "storage_object_key" not in columns:
            batch_op.add_column(sa.Column("storage_object_key", sa.String(length=500), nullable=True))
        if "prompt" not in columns:
            batch_op.add_column(sa.Column("prompt", sa.Text(), nullable=True))
        if "size" not in columns:
            batch_op.add_column(sa.Column("size", sa.String(length=32), nullable=True))
        if "actual_size" not in columns:
            batch_op.add_column(sa.Column("actual_size", sa.String(length=32), nullable=True))
        if "aspect_ratio" not in columns:
            batch_op.add_column(sa.Column("aspect_ratio", sa.String(length=32), nullable=True))
        if "model_name" not in columns:
            batch_op.add_column(sa.Column("model_name", sa.String(length=100), nullable=True))
        if "provider_name" not in columns:
            batch_op.add_column(sa.Column("provider_name", sa.String(length=50), nullable=True))
        if "prompt_version" not in columns:
            batch_op.add_column(sa.Column("prompt_version", sa.String(length=32), nullable=True))
        if "provider_response_id" not in columns:
            batch_op.add_column(sa.Column("provider_response_id", sa.String(length=128), nullable=True))
        if "image_generation_call_id" not in columns:
            batch_op.add_column(sa.Column("image_generation_call_id", sa.String(length=128), nullable=True))
        if "generation_config_id" not in columns:
            batch_op.add_column(sa.Column("generation_config_id", sa.String(length=36), nullable=True))
        if "generation_group_id" not in columns:
            batch_op.add_column(sa.Column("generation_group_id", sa.String(length=36), nullable=True))
        if "candidate_index" not in columns:
            batch_op.add_column(sa.Column("candidate_index", sa.Integer(), nullable=True))
        if "candidate_count" not in columns:
            batch_op.add_column(sa.Column("candidate_count", sa.Integer(), nullable=True))
        if "provider_notes_json" not in columns:
            batch_op.add_column(sa.Column("provider_notes_json", sa.JSON(), nullable=True))
        if "reference_images_json" not in columns:
            batch_op.add_column(sa.Column("reference_images_json", sa.JSON(), nullable=True))
        if "source_type" not in columns:
            batch_op.add_column(sa.Column("source_type", sa.String(length=50), nullable=True))
        if "source_resource_id" not in columns:
            batch_op.add_column(sa.Column("source_resource_id", sa.String(length=36), nullable=True))

    _backfill_gallery_entry_snapshots()

    with op.batch_alter_table("image_gallery_entries") as batch_op:
        batch_op.alter_column("image_session_asset_id", existing_type=sa.String(length=36), nullable=True)
        batch_op.alter_column("original_filename", existing_type=sa.String(length=255), nullable=False)
        batch_op.alter_column("mime_type", existing_type=sa.String(length=100), nullable=False)
        batch_op.alter_column("storage_path", existing_type=sa.String(length=500), nullable=False)

    indexes = _index_names("image_gallery_entries")
    if "uq_image_gallery_entries_asset_id" not in indexes:
        op.create_index(
            "uq_image_gallery_entries_asset_id",
            "image_gallery_entries",
            ["image_session_asset_id"],
            unique=True,
            sqlite_where=sa.text("image_session_asset_id IS NOT NULL"),
            postgresql_where=sa.text("image_session_asset_id IS NOT NULL"),
        )
    if "ix_image_gallery_entries_source" not in indexes:
        op.create_index(
            "ix_image_gallery_entries_source",
            "image_gallery_entries",
            ["source_type", "source_resource_id"],
        )


def _downgrade_gallery_entries() -> None:
    indexes = _index_names("image_gallery_entries")
    if "ix_image_gallery_entries_source" in indexes:
        op.drop_index("ix_image_gallery_entries_source", table_name="image_gallery_entries")
    if "uq_image_gallery_entries_asset_id" in indexes:
        op.drop_index("uq_image_gallery_entries_asset_id", table_name="image_gallery_entries")

    with op.batch_alter_table("image_gallery_entries") as batch_op:
        batch_op.alter_column("image_session_asset_id", existing_type=sa.String(length=36), nullable=False)
        for column_name in (
            "source_resource_id",
            "source_type",
            "reference_images_json",
            "provider_notes_json",
            "candidate_count",
            "candidate_index",
            "generation_group_id",
            "generation_config_id",
            "image_generation_call_id",
            "provider_response_id",
            "prompt_version",
            "provider_name",
            "model_name",
            "aspect_ratio",
            "actual_size",
            "size",
            "prompt",
            "storage_object_key",
            "storage_bucket",
            "storage_backend",
            "storage_path",
            "mime_type",
            "original_filename",
        ):
            if column_name in _column_names("image_gallery_entries"):
                batch_op.drop_column(column_name)

    op.create_index(
        "uq_image_gallery_entries_asset_id",
        "image_gallery_entries",
        ["image_session_asset_id"],
        unique=True,
    )


def _backfill_gallery_entry_snapshots() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE image_gallery_entries
            SET
                original_filename = COALESCE(
                    original_filename,
                    (SELECT original_filename FROM image_session_assets
                     WHERE image_session_assets.id = image_gallery_entries.image_session_asset_id),
                    'gallery-image'
                ),
                mime_type = COALESCE(
                    mime_type,
                    (SELECT mime_type FROM image_session_assets
                     WHERE image_session_assets.id = image_gallery_entries.image_session_asset_id),
                    'application/octet-stream'
                ),
                storage_path = COALESCE(
                    storage_path,
                    (SELECT storage_path FROM image_session_assets
                     WHERE image_session_assets.id = image_gallery_entries.image_session_asset_id),
                    'missing'
                ),
                storage_backend = COALESCE(
                    storage_backend,
                    (SELECT storage_backend FROM image_session_assets
                     WHERE image_session_assets.id = image_gallery_entries.image_session_asset_id)
                ),
                storage_bucket = COALESCE(
                    storage_bucket,
                    (SELECT storage_bucket FROM image_session_assets
                     WHERE image_session_assets.id = image_gallery_entries.image_session_asset_id)
                ),
                storage_object_key = COALESCE(
                    storage_object_key,
                    (SELECT storage_object_key FROM image_session_assets
                     WHERE image_session_assets.id = image_gallery_entries.image_session_asset_id)
                ),
                source_type = COALESCE(source_type, 'image_session_asset'),
                source_resource_id = COALESCE(source_resource_id, image_session_asset_id)
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE image_gallery_entries
            SET
                prompt = COALESCE(
                    prompt,
                    (SELECT prompt FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                size = COALESCE(
                    size,
                    (SELECT size FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                model_name = COALESCE(
                    model_name,
                    (SELECT model_name FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                provider_name = COALESCE(
                    provider_name,
                    (SELECT provider_name FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                prompt_version = COALESCE(
                    prompt_version,
                    (SELECT prompt_version FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                provider_response_id = COALESCE(
                    provider_response_id,
                    (SELECT provider_response_id FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                image_generation_call_id = COALESCE(
                    image_generation_call_id,
                    (SELECT image_generation_call_id FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                generation_config_id = COALESCE(
                    generation_config_id,
                    (SELECT generation_config_id FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                generation_group_id = COALESCE(
                    generation_group_id,
                    (SELECT generation_group_id FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                resource_group_id = COALESCE(
                    resource_group_id,
                    (SELECT resource_group_id FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                candidate_index = COALESCE(
                    candidate_index,
                    (SELECT candidate_index FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                ),
                candidate_count = COALESCE(
                    candidate_count,
                    (SELECT candidate_count FROM image_session_rounds
                     WHERE image_session_rounds.id = image_gallery_entries.image_session_round_id)
                )
            """
        )
    )
