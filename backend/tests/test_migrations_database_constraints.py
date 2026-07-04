from __future__ import annotations

import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.config import Config

from alembic import command
from inspiration_one_backend.config import get_settings
from inspiration_one_backend.domain.enums import (
    CopyStatus,
    EnhanceSourceKind,
    EnhanceStrategy,
    ImageSessionAssetKind,
    ImageToCodeDeliveryMode,
    ImageToCodeSourceKind,
    JobStatus,
    PosterKind,
    ResourceLibraryAssetKind,
    ResourceLibrarySourceType,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
    WorkflowRunStatus,
)
from inspiration_one_backend.infrastructure.db.models import (
    AuthUser,
    CanvasTemplate,
    CanvasTemplateCategory,
    CopySet,
    EnhanceJob,
    EnhanceJobInput,
    GalleryTag,
    GenerationConfigResourceGroup,
    ImageGalleryEntry,
    ImageGalleryEntryTag,
    ImageSessionAsset,
    ImageSessionGenerationTask,
    ImageToCodeJob,
    InspirationWorkflow,
    PosterVariant,
    ResourceLibraryAsset,
    ResourceLibraryAssetGroup,
    ResourceLibraryGroup,
    SourceAsset,
    UserCanvasTemplate,
    UserUiPreference,
    WorkflowNode,
    WorkflowNodeRun,
    WorkflowRun,
    new_id,
    utcnow,
)

MODEL_LEGACY_COPY_COLUMNS = [
    "model_" + suffix for suffix in ("title", "selling" + "_points", "poster" + "_headline", "c" + "ta")
]
LEGACY_COPY_COLUMNS = ["title", "selling" + "_points", "poster" + "_headline", "c" + "ta"]


def test_sqlalchemy_enum_columns_use_application_values_without_database_constraints() -> None:
    enum_columns = (
        (SourceAsset.__table__.c.kind, SourceAssetKind),
        (ImageSessionAsset.__table__.c.kind, ImageSessionAssetKind),
        (ResourceLibraryAsset.__table__.c.kind, ResourceLibraryAssetKind),
        (ResourceLibraryAsset.__table__.c.source_type, ResourceLibrarySourceType),
        (EnhanceJob.__table__.c.source_kind, EnhanceSourceKind),
        (EnhanceJob.__table__.c.strategy, EnhanceStrategy),
        (EnhanceJob.__table__.c.status, JobStatus),
        (ImageToCodeJob.__table__.c.source_kind, ImageToCodeSourceKind),
        (ImageToCodeJob.__table__.c.delivery_mode, ImageToCodeDeliveryMode),
        (ImageToCodeJob.__table__.c.status, JobStatus),
        (CopySet.__table__.c.status, CopyStatus),
        (PosterVariant.__table__.c.kind, PosterKind),
        (ImageSessionGenerationTask.__table__.c.status, JobStatus),
        (WorkflowNode.__table__.c.node_type, WorkflowNodeType),
        (WorkflowNode.__table__.c.status, WorkflowNodeStatus),
        (WorkflowNodeRun.__table__.c.status, WorkflowNodeStatus),
        (WorkflowRun.__table__.c.status, WorkflowRunStatus),
    )
    for column, enum_cls in enum_columns:
        assert column.type.enums == [member.value for member in enum_cls]
        assert column.type.native_enum is False
        assert column.type.create_constraint is False


def test_sqlalchemy_metadata_has_no_foreign_keys_or_check_constraints() -> None:
    tables = SourceAsset.metadata.tables.values()
    assert not [foreign_key for table in tables for foreign_key in table.foreign_keys]
    assert not [
        constraint
        for table in SourceAsset.metadata.tables.values()
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint)
    ]


def test_workflow_run_model_has_retryability_and_progress_metadata() -> None:
    table = WorkflowRun.__table__
    assert "is_retryable" in table.c
    assert not table.c.is_retryable.nullable
    assert table.c.is_retryable.default is not None
    assert "progress_metadata" in table.c
    assert table.c.progress_metadata.nullable


def test_user_ui_preferences_model_matches_layout_scheme_contract() -> None:
    table = UserUiPreference.__table__
    assert table.c.user_id.type.length == 36
    assert not table.c.user_id.nullable
    assert table.c.ui_layout_scheme.type.length == 32
    assert not table.c.ui_layout_scheme.nullable
    assert table.c.ui_layout_scheme.default is not None
    assert table.c.ui_layout_scheme.default.arg == "classic"
    assert not table.c.mask_sensitive_images_in_inspirations.nullable
    assert not table.c.mask_sensitive_images_in_image_chat.nullable
    assert not table.foreign_keys
    assert not [constraint for constraint in table.constraints if isinstance(constraint, sa.CheckConstraint)]


def test_auth_user_model_matches_session_watermark_indexes() -> None:
    table = AuthUser.__table__
    assert table.c.session_revoked_after.nullable
    assert table.c.last_login_at.nullable
    assert table.c.last_seen_at.nullable
    assert {
        "ix_auth_users_session_revoked_after",
        "ix_auth_users_last_seen_at",
    }.issubset({index.name for index in table.indexes})


def test_generation_config_resource_group_model_matches_migration_contract() -> None:
    table = GenerationConfigResourceGroup.__table__
    assert table.c.generation_config_id.type.length == 36
    assert table.c.resource_group_id.type.length == 36
    assert not table.c.generation_config_id.nullable
    assert not table.c.resource_group_id.nullable
    assert not table.c.created_at.nullable
    assert table.c.created_at.default is not None
    assert table.c.created_at.default.arg.__name__ == utcnow.__name__
    assert {index.name for index in table.indexes} == {"ix_generation_config_resource_groups_group"}
    assert not table.foreign_keys
    assert not [constraint for constraint in table.constraints if isinstance(constraint, sa.CheckConstraint)]


def test_enhance_job_models_match_migration_contract() -> None:
    job_table = EnhanceJob.__table__
    assert job_table.c.id.type.length == 36
    assert not job_table.c.id.nullable
    assert job_table.c.id.default is not None
    assert job_table.c.id.default.arg.__name__ == new_id.__name__
    assert job_table.c.owner_user_id.type.length == 36
    assert job_table.c.source_kind.type.enums == [member.value for member in EnhanceSourceKind]
    assert job_table.c.source_ref.type.length == 36
    assert job_table.c.source_mime_type.type.length == 100
    assert job_table.c.strategy.type.enums == [member.value for member in EnhanceStrategy]
    assert job_table.c.status.type.enums == [member.value for member in JobStatus]
    assert not job_table.c.params_json.nullable
    assert not job_table.c.progress_completed.nullable
    assert not job_table.c.progress_total.nullable
    assert job_table.c.progress_updated_at.nullable
    assert job_table.c.result_manifest_json.nullable
    assert job_table.c.last_error.nullable
    assert job_table.c.generation_config_mode.type.length == 20
    assert job_table.c.requested_generation_config_id.nullable
    assert job_table.c.used_generation_config_id.nullable
    assert job_table.c.resource_group_id.nullable
    assert job_table.c.started_at.nullable
    assert job_table.c.finished_at.nullable
    assert not job_table.c.attempts.nullable
    assert {index.name for index in job_table.indexes} == {
        "ix_enhance_jobs_owner_status_created",
        "ix_enhance_jobs_resource_group_id",
        "ix_enhance_jobs_source",
    }
    assert not job_table.foreign_keys
    assert not [constraint for constraint in job_table.constraints if isinstance(constraint, sa.CheckConstraint)]

    input_table = EnhanceJobInput.__table__
    assert input_table.c.id.type.length == 36
    assert input_table.c.owner_user_id.type.length == 36
    assert input_table.c.storage_path.type.length == 500
    assert input_table.c.storage_backend.nullable
    assert input_table.c.storage_bucket.nullable
    assert input_table.c.storage_object_key.nullable
    assert input_table.c.mime_type.type.length == 100
    assert not input_table.c.width.nullable
    assert not input_table.c.height.nullable
    assert not input_table.c.created_at.nullable
    assert {index.name for index in input_table.indexes} == {"ix_enhance_job_inputs_owner_created"}
    assert not input_table.foreign_keys
    assert not [constraint for constraint in input_table.constraints if isinstance(constraint, sa.CheckConstraint)]


def test_enhance_job_migration_schema_and_downgrade_support_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "enhance-migration.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    table_names = set(inspector.get_table_names())
    assert {"enhance_jobs", "enhance_job_inputs"} <= table_names
    assert {
        "ix_enhance_jobs_owner_status_created",
        "ix_enhance_jobs_resource_group_id",
        "ix_enhance_jobs_source",
    } <= {index["name"] for index in inspector.get_indexes("enhance_jobs")}
    assert "ix_enhance_job_inputs_owner_created" in {
        index["name"] for index in inspector.get_indexes("enhance_job_inputs")
    }
    engine.dispose()

    command.downgrade(config, "20260625_0065")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    table_names = set(inspector.get_table_names())
    assert "enhance_jobs" not in table_names
    assert "enhance_job_inputs" not in table_names
    engine.dispose()
    get_settings.cache_clear()


def test_image_to_code_job_model_matches_migration_contract() -> None:
    table = ImageToCodeJob.__table__
    assert table.c.id.type.length == 36
    assert not table.c.id.nullable
    assert table.c.id.default is not None
    assert table.c.id.default.arg.__name__ == new_id.__name__
    assert table.c.owner_user_id.type.length == 36
    assert table.c.source_kind.type.enums == [member.value for member in ImageToCodeSourceKind]
    assert table.c.source_ref.type.length == 36
    assert table.c.source_mime_type.type.length == 100
    assert table.c.delivery_mode.type.enums == [member.value for member in ImageToCodeDeliveryMode]
    assert not table.c.job_params_json.nullable
    assert table.c.status.type.enums == [member.value for member in JobStatus]
    assert table.c.progress_phase.type.length == 64
    assert table.c.progress_phase.nullable
    assert not table.c.progress_completed.nullable
    assert not table.c.progress_total.nullable
    assert table.c.progress_updated_at.nullable
    assert table.c.result_manifest_json.nullable
    assert table.c.last_error.nullable
    assert table.c.started_at.nullable
    assert table.c.finished_at.nullable
    assert not table.c.attempts.nullable
    assert {index.name for index in table.indexes} == {
        "ix_image_to_code_jobs_owner_status_created",
        "ix_image_to_code_jobs_source",
    }
    assert not table.foreign_keys
    assert not [constraint for constraint in table.constraints if isinstance(constraint, sa.CheckConstraint)]


def test_image_to_code_job_migration_schema_and_downgrade_support_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "image-to-code-migration.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    table_names = set(inspector.get_table_names())
    assert "image_to_code_jobs" in table_names
    assert {
        "ix_image_to_code_jobs_owner_status_created",
        "ix_image_to_code_jobs_source",
    } <= {index["name"] for index in inspector.get_indexes("image_to_code_jobs")}
    engine.dispose()

    command.downgrade(config, "20260701_0067")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    table_names = set(inspector.get_table_names())
    assert "image_to_code_jobs" not in table_names
    engine.dispose()
    get_settings.cache_clear()


def test_gallery_entry_model_matches_migration_contract() -> None:
    table = ImageGalleryEntry.__table__
    assert table.c.id.type.length == 36
    assert not table.c.id.nullable
    assert table.c.id.default is not None
    assert table.c.id.default.arg.__name__ == new_id.__name__
    assert table.c.image_session_asset_id.type.length == 36
    assert not table.c.image_session_asset_id.nullable
    assert table.c.image_session_round_id.nullable
    assert not table.c.enabled.nullable
    assert table.c.disabled_at.nullable
    assert table.c.disabled_by_user_id.nullable
    assert table.c.disabled_reason.nullable
    assert not table.c.created_at.nullable
    assert table.c.created_at.default is not None
    assert table.c.created_at.default.arg.__name__ == utcnow.__name__
    assert {index.name for index in table.indexes} == {
        "uq_image_gallery_entries_asset_id",
        "ix_image_gallery_entries_round_id",
        "ix_image_gallery_entries_created_at",
        "ix_image_gallery_entries_enabled_created",
        "ix_image_gallery_entries_group_enabled_created",
    }
    assert not table.foreign_keys


def test_gallery_tag_models_match_migration_contract() -> None:
    tag_table = GalleryTag.__table__
    assert tag_table.c.id.type.length == 36
    assert not tag_table.c.id.nullable
    assert tag_table.c.id.default is not None
    assert tag_table.c.id.default.arg.__name__ == new_id.__name__
    assert tag_table.c.name.type.length == 120
    assert not tag_table.c.name.nullable
    assert tag_table.c.description.nullable
    assert not tag_table.c.priority.nullable
    assert not tag_table.c.enabled.nullable
    assert tag_table.c.deleted_at.nullable
    assert not tag_table.c.created_at.nullable
    assert not tag_table.c.updated_at.nullable
    assert {index.name for index in tag_table.indexes} == {
        "uq_gallery_tags_name_active",
        "ix_gallery_tags_deleted_enabled_priority_name",
    }
    assert not tag_table.foreign_keys
    assert not [constraint for constraint in tag_table.constraints if isinstance(constraint, sa.CheckConstraint)]

    link_table = ImageGalleryEntryTag.__table__
    assert link_table.c.id.type.length == 36
    assert not link_table.c.id.nullable
    assert link_table.c.id.default is not None
    assert link_table.c.id.default.arg.__name__ == new_id.__name__
    assert link_table.c.gallery_entry_id.type.length == 36
    assert link_table.c.tag_id.type.length == 36
    assert not link_table.c.gallery_entry_id.nullable
    assert not link_table.c.tag_id.nullable
    assert link_table.c.deleted_at.nullable
    assert not link_table.c.created_at.nullable
    assert not link_table.c.updated_at.nullable
    assert {index.name for index in link_table.indexes} == {
        "uq_image_gallery_entry_tags_active",
        "ix_image_gallery_entry_tags_entry_deleted",
        "ix_image_gallery_entry_tags_tag_deleted",
    }
    assert not link_table.foreign_keys
    assert not [constraint for constraint in link_table.constraints if isinstance(constraint, sa.CheckConstraint)]


def test_resource_library_models_match_migration_contract() -> None:
    group_table = ResourceLibraryGroup.__table__
    assert group_table.c.id.type.length == 36
    assert not group_table.c.id.nullable
    assert group_table.c.id.default is not None
    assert group_table.c.id.default.arg.__name__ == new_id.__name__
    assert group_table.c.owner_user_id.type.length == 36
    assert not group_table.c.owner_user_id.nullable
    assert group_table.c.name.type.length == 120
    assert not group_table.c.name.nullable
    assert not group_table.c.sort_order.nullable
    assert group_table.c.archived_at.nullable
    assert not group_table.c.created_at.nullable
    assert not group_table.c.updated_at.nullable
    assert {index.name for index in group_table.indexes} == {
        "ix_resource_library_groups_owner_archived",
        "ix_resource_library_groups_owner_user_id",
        "uq_resource_library_groups_owner_name_active",
    }
    assert not group_table.foreign_keys
    assert not [constraint for constraint in group_table.constraints if isinstance(constraint, sa.CheckConstraint)]

    asset_table = ResourceLibraryAsset.__table__
    assert asset_table.c.id.type.length == 36
    assert not asset_table.c.id.nullable
    assert asset_table.c.owner_user_id.type.length == 36
    assert not asset_table.c.owner_user_id.nullable
    assert asset_table.c.kind.type.enums == [member.value for member in ResourceLibraryAssetKind]
    assert asset_table.c.source_type.type.enums == [member.value for member in ResourceLibrarySourceType]
    assert asset_table.c.original_filename.type.length == 255
    assert asset_table.c.mime_type.type.length == 100
    assert asset_table.c.storage_path.type.length == 500
    assert asset_table.c.source_resource_id.nullable
    assert not asset_table.c.enabled.nullable
    assert asset_table.c.disabled_at.nullable
    assert asset_table.c.disabled_by_user_id.nullable
    assert asset_table.c.disabled_reason.nullable
    assert asset_table.c.archived_at.nullable
    assert {index.name for index in asset_table.indexes} == {
        "ix_resource_library_assets_kind",
        "ix_resource_library_assets_owner_archived",
        "ix_resource_library_assets_owner_user_id",
        "uq_resource_library_assets_owner_source",
    }
    assert not asset_table.foreign_keys
    assert not [constraint for constraint in asset_table.constraints if isinstance(constraint, sa.CheckConstraint)]

    link_table = ResourceLibraryAssetGroup.__table__
    assert link_table.c.asset_id.type.length == 36
    assert link_table.c.group_id.type.length == 36
    assert not link_table.c.asset_id.nullable
    assert not link_table.c.group_id.nullable
    assert not link_table.c.created_at.nullable
    assert link_table.c.created_at.default is not None
    assert link_table.c.created_at.default.arg.__name__ == utcnow.__name__
    assert {column.name for column in link_table.primary_key.columns} == {"asset_id", "group_id"}
    assert {index.name for index in link_table.indexes} == {"ix_resource_library_asset_groups_group"}
    assert not link_table.foreign_keys
    assert not [constraint for constraint in link_table.constraints if isinstance(constraint, sa.CheckConstraint)]


def test_user_canvas_template_model_matches_migration_contract() -> None:
    table = UserCanvasTemplate.__table__
    assert table.c.id.type.length == 36
    assert not table.c.id.nullable
    assert table.c.id.default is not None
    assert table.c.id.default.arg.__name__ == new_id.__name__
    assert table.c.key.type.length == 80
    assert not table.c.key.nullable
    assert table.c.title.type.length == 255
    assert not table.c.title.nullable
    assert table.c.description.nullable
    assert table.c.kind.type.length == 40
    assert not table.c.kind.nullable
    assert not table.c.schema_version.nullable
    assert not table.c.template_json.nullable
    assert table.c.archived_at.nullable
    assert not table.c.created_at.nullable
    assert not table.c.updated_at.nullable
    assert {constraint.name for constraint in table.constraints if isinstance(constraint, sa.UniqueConstraint)} == {
        None
    }
    assert {index.name for index in table.indexes} == {"ix_user_canvas_templates_archived_at"}


def test_canvas_template_models_match_migration_contract() -> None:
    category_table = CanvasTemplateCategory.__table__
    assert category_table.c.id.type.length == 36
    assert category_table.c.scope.type.length == 20
    assert category_table.c.owner_user_id.nullable
    assert category_table.c.name.type.length == 120
    assert not category_table.c.name.nullable
    assert not category_table.c.enabled.nullable
    assert category_table.c.archived_at.nullable
    assert category_table.c.disabled_at.nullable
    assert category_table.c.disabled_by_user_id.nullable
    assert category_table.c.disabled_reason.nullable
    assert {index.name for index in category_table.indexes} == {
        "ix_canvas_template_categories_scope",
        "uq_canvas_template_categories_global_name",
        "uq_canvas_template_categories_user_owner_name",
    }
    assert not [constraint for constraint in category_table.constraints if isinstance(constraint, sa.CheckConstraint)]

    template_table = CanvasTemplate.__table__
    assert template_table.c.id.type.length == 36
    assert template_table.c.key.type.length == 120
    assert not template_table.c.key.nullable
    assert template_table.c.scope.type.length == 20
    assert template_table.c.owner_user_id.nullable
    assert template_table.c.category_id.nullable
    assert template_table.c.kind.type.length == 40
    assert template_table.c.entry_mode.type.length == 20
    assert not template_table.c.entry_mode.nullable
    assert not template_table.c.sort_order.nullable
    assert not template_table.c.template_json.nullable
    assert not template_table.c.enabled.nullable
    assert template_table.c.archived_at.nullable
    assert template_table.c.disabled_at.nullable
    assert template_table.c.disabled_by_user_id.nullable
    assert template_table.c.disabled_reason.nullable
    assert template_table.c.review_status.type.length == 20
    assert not template_table.c.review_status.nullable
    assert template_table.c.review_note.nullable
    assert template_table.c.review_submitted_at.nullable
    assert template_table.c.reviewed_at.nullable
    assert template_table.c.reviewed_by_user_id.nullable
    assert {index.name for index in template_table.indexes} == {
        "ix_canvas_templates_archived_at",
        "ix_canvas_templates_category_id",
        "ix_canvas_templates_entry_mode",
        "ix_canvas_templates_review_status",
        "ix_canvas_templates_scope",
        "ix_canvas_templates_scope_owner_entry_category_sort",
        "ix_canvas_templates_sort_order",
        "uq_canvas_templates_key",
    }
    assert not [constraint for constraint in template_table.constraints if isinstance(constraint, sa.CheckConstraint)]

    workflow_table = InspirationWorkflow.__table__
    assert workflow_table.c.initial_entry_mode.type.length == 20
    assert not workflow_table.c.initial_entry_mode.nullable
    assert "ix_inspiration_workflows_initial_entry_mode" in {index.name for index in workflow_table.indexes}
    assert not [constraint for constraint in workflow_table.constraints if isinstance(constraint, sa.CheckConstraint)]


def test_alembic_upgrade_head_supports_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "alembic.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

    assert database_path.exists()
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert not [
        foreign_key
        for table_name in inspector.get_table_names()
        for foreign_key in inspector.get_foreign_keys(table_name)
    ]
    assert not [
        check_constraint
        for table_name in inspector.get_table_names()
        for check_constraint in inspector.get_check_constraints(table_name)
    ]
    engine.dispose()
    get_settings.cache_clear()


def test_repair_migration_adds_missing_0033_columns_after_stamp(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "repair-0033-drift.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260529_0032")
    command.stamp(config, "20260530_0033")
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    canvas_template_columns = {column["name"] for column in inspector.get_columns("canvas_templates")}
    assert {
        "review_status",
        "review_note",
        "review_submitted_at",
        "reviewed_at",
        "reviewed_by_user_id",
    } <= canvas_template_columns
    assert "ix_canvas_templates_review_status" in {index["name"] for index in inspector.get_indexes("canvas_templates")}
    assert not inspector.get_foreign_keys("canvas_templates")

    for table_name, index_name in (
        ("inspirations", "ix_inspirations_deleted_at"),
        ("image_sessions", "ix_image_sessions_deleted_at"),
    ):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        assert {"deleted_at", "deleted_by_user_id"} <= columns
        assert index_name in {index["name"] for index in inspector.get_indexes(table_name)}
        assert not inspector.get_foreign_keys(table_name)
    get_settings.cache_clear()


def test_legacy_copy_fields_migrate_to_structured_payload_and_drop_columns(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_path = tmp_path / "drop-legacy-copy-fields.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260509_0023")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    with engine.begin() as connection:
        now = "2026-05-10 00:00:00"
        connection.execute(
            sa.text(
                """
                INSERT INTO inspirations (
                    id, name, category, price, source_note, current_confirmed_copy_set_id, created_at, updated_at
                )
                VALUES (:id, :name, NULL, NULL, NULL, NULL, :now, :now)
                """
            ),
            {"id": "inspiration-1", "name": "迁移灵感产物", "now": now},
        )
        connection.execute(
            sa.text(
                """
                INSERT INTO copy_sets (
                    id, inspiration_id, creative_brief_id, status,
                    __LEGACY_COPY_COLUMNS__,
                    structured_payload,
                    __MODEL_LEGACY_COLUMNS__,
                    model_structured_payload,
                    provider_name, model_name, prompt_version,
                    edited_at, confirmed_at, created_at, updated_at
                )
                VALUES (
                    :id, :inspiration_id, NULL, :status,
                    :text_value, :points_value, :headline_value, :action_value,
                    NULL,
                    :model_text_value, :model_points_value, :model_headline_value, :model_action_value,
                    NULL,
                    :provider_name, :model_name, :prompt_version,
                    NULL, NULL, :now, :now
                )
                """.replace("__LEGACY_COPY_COLUMNS__", ", ".join(LEGACY_COPY_COLUMNS)).replace(
                    "__MODEL_LEGACY_COLUMNS__", ", ".join(MODEL_LEGACY_COPY_COLUMNS)
                )
            ),
            {
                "id": "copy-set-1",
                "inspiration_id": "inspiration-1",
                "status": "draft",
                "text_value": "旧标题",
                "points_value": '["卖点一", "卖点二"]',
                "headline_value": "旧海报标题",
                "action_value": "立即购买",
                "model_text_value": "模型旧标题",
                "model_points_value": '["模型卖点"]',
                "model_headline_value": "模型海报标题",
                "model_action_value": "模型 CTA",
                "provider_name": "test",
                "model_name": "test",
                "prompt_version": "test",
                "now": now,
            },
        )

    engine.dispose()
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    copy_set_columns = {column["name"] for column in inspector.get_columns("copy_sets")}
    assert (
        not {
            *LEGACY_COPY_COLUMNS,
            *MODEL_LEGACY_COPY_COLUMNS,
        }
        & copy_set_columns
    )
    assert {"structured_payload", "model_structured_payload"} <= copy_set_columns
    with engine.connect() as connection:
        row = (
            connection.execute(
                sa.text("SELECT structured_payload, model_structured_payload FROM copy_sets WHERE id = :id"),
                {"id": "copy-set-1"},
            )
            .mappings()
            .one()
        )
    structured_payload = json.loads(row["structured_payload"])
    model_structured_payload = json.loads(row["model_structured_payload"])
    assert structured_payload["version"] == 2
    assert structured_payload["summary"] == "旧海报标题"
    assert structured_payload["content"]["kind"] == "blocks"
    assert [block["text"] for block in structured_payload["content"]["blocks"][:3]] == [
        "旧标题",
        "卖点一",
        "卖点二",
    ]
    assert model_structured_payload["summary"] == "模型海报标题"
    engine.dispose()

    command.downgrade(config, "20260509_0023")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    downgraded_columns = {column["name"] for column in inspector.get_columns("copy_sets")}
    assert {*LEGACY_COPY_COLUMNS, *MODEL_LEGACY_COPY_COLUMNS} <= downgraded_columns
    with engine.connect() as connection:
        row = (
            connection.execute(
                sa.text(
                    """
                SELECT __LEGACY_COPY_COLUMNS__, __MODEL_LEGACY_COLUMNS__
                FROM copy_sets
                WHERE id = :id
                """.replace("__LEGACY_COPY_COLUMNS__", ", ".join(LEGACY_COPY_COLUMNS)).replace(
                        "__MODEL_LEGACY_COLUMNS__", ", ".join(MODEL_LEGACY_COPY_COLUMNS)
                    )
                ),
                {"id": "copy-set-1"},
            )
            .mappings()
            .one()
        )
    assert row[LEGACY_COPY_COLUMNS[0]] == "旧标题"
    assert json.loads(row[LEGACY_COPY_COLUMNS[1]]) == ["卖点一", "卖点二"]
    assert row[LEGACY_COPY_COLUMNS[2]] == "旧海报标题"
    assert row[LEGACY_COPY_COLUMNS[3]] == "立即购买"
    assert row[MODEL_LEGACY_COPY_COLUMNS[0]] == "模型旧标题"
    assert json.loads(row[MODEL_LEGACY_COPY_COLUMNS[1]]) == ["模型卖点"]
    assert row[MODEL_LEGACY_COPY_COLUMNS[2]] == "模型海报标题"
    assert row[MODEL_LEGACY_COPY_COLUMNS[3]] == "模型 CTA"
    engine.dispose()
    get_settings.cache_clear()


def test_workflow_run_retryability_migration_supports_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "workflow-run-retryability.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260510_0024")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    now = "2026-05-12 00:00:00"
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO inspirations (id, name, created_at, updated_at) "
                "VALUES ('inspiration-1', '重试迁移灵感产物', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO inspiration_workflows (id, inspiration_id, title, active, created_at, updated_at) "
                "VALUES ('workflow-1', 'inspiration-1', '迁移工作流', 1, :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_runs (id, workflow_id, status, started_at) "
                "VALUES ('run-1', 'workflow-1', 'failed', :now)"
            ),
            {"now": now},
        )

    engine.dispose()
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("workflow_runs")}
    assert columns["is_retryable"]["nullable"] is False
    with engine.connect() as connection:
        retryable = connection.execute(
            sa.text("SELECT is_retryable FROM workflow_runs WHERE id = 'run-1'")
        ).scalar_one()
    assert bool(retryable) is True

    engine.dispose()
    command.downgrade(config, "20260510_0024")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("workflow_runs")}
    assert "is_retryable" not in columns

    engine.dispose()
    get_settings.cache_clear()


def test_workflow_run_progress_metadata_migration_supports_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "workflow-run-progress-metadata.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260512_0025")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    now = "2026-05-13 00:00:00"
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO inspirations (id, name, created_at, updated_at) "
                "VALUES ('inspiration-1', '进度迁移灵感产物', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO inspiration_workflows (id, inspiration_id, title, active, created_at, updated_at) "
                "VALUES ('workflow-1', 'inspiration-1', '迁移工作流', 1, :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_runs (id, workflow_id, status, started_at, is_retryable) "
                "VALUES ('run-1', 'workflow-1', 'running', :now, 1)"
            ),
            {"now": now},
        )

    engine.dispose()
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("workflow_runs")}
    assert columns["progress_metadata"]["nullable"] is True
    with engine.begin() as connection:
        connection.execute(
            sa.text("UPDATE workflow_runs SET progress_metadata = :metadata WHERE id = 'run-1'"),
            {"metadata": json.dumps({"last_failure_reason": "上次失败"})},
        )
        metadata = connection.execute(
            sa.text("SELECT progress_metadata FROM workflow_runs WHERE id = 'run-1'")
        ).scalar_one()
    assert json.loads(metadata)["last_failure_reason"] == "上次失败"

    engine.dispose()
    command.downgrade(config, "20260512_0025")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("workflow_runs")}
    assert "progress_metadata" not in columns

    engine.dispose()
    get_settings.cache_clear()


def test_user_canvas_template_migration_schema_and_downgrade_support_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "user-canvas-template-migration.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert "user_canvas_templates" in inspector.get_table_names()
    columns = {column["name"]: column for column in inspector.get_columns("user_canvas_templates")}
    assert columns["id"]["nullable"] is False
    assert columns["key"]["nullable"] is False
    assert columns["title"]["nullable"] is False
    assert columns["description"]["nullable"] is True
    assert columns["kind"]["nullable"] is False
    assert columns["schema_version"]["nullable"] is False
    assert columns["template_json"]["nullable"] is False
    assert columns["archived_at"]["nullable"] is True
    assert columns["created_at"]["nullable"] is False
    assert columns["updated_at"]["nullable"] is False
    assert {constraint["name"] for constraint in inspector.get_unique_constraints("user_canvas_templates")} == {None}
    indexes = {index["name"]: index for index in inspector.get_indexes("user_canvas_templates")}
    assert indexes["ix_user_canvas_templates_archived_at"]["column_names"] == ["archived_at"]

    engine.dispose()
    command.downgrade(config, "20260507_0021")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert "user_canvas_templates" not in inspector.get_table_names()
    engine.dispose()
    get_settings.cache_clear()


def test_global_canvas_template_migration_normalizes_node_types_and_supports_downgrade_sqlite(
    tmp_path: Path,
    monkeypatch,
) -> None:
    from inspiration_one_backend.application.canvas_templates import list_builtin_canvas_templates

    database_path = tmp_path / "canvas-template-node-type-migration.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260610_0054")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    builtin_templates = list_builtin_canvas_templates()
    assert len(builtin_templates) == 17
    with engine.begin() as connection:
        for index, template in enumerate(builtin_templates, start=1):
            template_json = template.model_dump(mode="json")
            for node in template_json["nodes"]:
                if node["node_type"] == "inspiration_context":
                    node["node_type"] = "product_context"
            connection.execute(
                sa.text(
                    """
                    INSERT INTO canvas_templates (
                        id,
                        key,
                        scope,
                        owner_user_id,
                        category_id,
                        title,
                        description,
                        kind,
                        entry_mode,
                        sort_order,
                        schema_version,
                        template_json,
                        enabled,
                        archived_at,
                        disabled_at,
                        disabled_by_user_id,
                        disabled_reason,
                        review_status,
                        review_note,
                        review_submitted_at,
                        reviewed_at,
                        reviewed_by_user_id,
                        created_at,
                        updated_at
                    ) VALUES (
                        :id,
                        :key,
                        :scope,
                        :owner_user_id,
                        :category_id,
                        :title,
                        :description,
                        :kind,
                        :entry_mode,
                        :sort_order,
                        :schema_version,
                        :template_json,
                        :enabled,
                        NULL,
                        NULL,
                        NULL,
                        NULL,
                        'none',
                        NULL,
                        NULL,
                        NULL,
                        NULL,
                        CURRENT_TIMESTAMP,
                        CURRENT_TIMESTAMP
                    )
                    """
                ),
                {
                    "id": f"template-{index}",
                    "key": template.key,
                    "scope": "global",
                    "owner_user_id": None,
                    "category_id": None,
                    "title": template.title,
                    "description": template.description,
                    "kind": template.kind,
                    "entry_mode": template.entry_mode,
                    "sort_order": template.sort_order,
                    "schema_version": template.version,
                    "template_json": json.dumps(template_json),
                    "enabled": 1,
                },
            )

    with engine.connect() as connection:
        rows = connection.execute(
            sa.text("SELECT key, template_json FROM canvas_templates ORDER BY key")
        ).mappings().all()
    assert len(rows) == 17
    for row in rows:
        template_json = row["template_json"]
        nodes = template_json["nodes"] if isinstance(template_json, dict) else json.loads(template_json)["nodes"]
        assert any(node["node_type"] == "product_context" for node in nodes)

    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    with engine.connect() as connection:
        rows = connection.execute(
            sa.text("SELECT key, template_json FROM canvas_templates ORDER BY key")
        ).mappings().all()
    assert len(rows) == 17
    for row in rows:
        template_json = row["template_json"]
        if isinstance(template_json, str):
            template_json = json.loads(template_json)
        nodes = template_json["nodes"]
        assert not any(node["node_type"] == "product_context" for node in nodes)
        assert any(node["node_type"] == "inspiration_context" for node in nodes)

    engine.dispose()

    command.downgrade(config, "20260610_0054")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    with engine.connect() as connection:
        rows = connection.execute(
            sa.text("SELECT key, template_json FROM canvas_templates ORDER BY key")
        ).mappings().all()
    assert len(rows) == 17
    for row in rows:
        template_json = row["template_json"]
        if isinstance(template_json, str):
            template_json = json.loads(template_json)
        nodes = template_json["nodes"]
        assert any(node["node_type"] == "product_context" for node in nodes)

    engine.dispose()
    get_settings.cache_clear()


def test_gallery_migration_schema_and_downgrade_support_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "gallery-migration.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert "image_gallery_entries" in inspector.get_table_names()
    columns = {column["name"]: column for column in inspector.get_columns("image_gallery_entries")}
    assert columns["id"]["nullable"] is False
    assert columns["image_session_asset_id"]["nullable"] is False
    assert columns["image_session_round_id"]["nullable"] is True
    assert columns["created_at"]["nullable"] is False
    indexes = {index["name"]: index for index in inspector.get_indexes("image_gallery_entries")}
    assert bool(indexes["uq_image_gallery_entries_asset_id"]["unique"])
    assert indexes["uq_image_gallery_entries_asset_id"]["column_names"] == ["image_session_asset_id"]
    assert indexes["ix_image_gallery_entries_round_id"]["column_names"] == ["image_session_round_id"]
    assert indexes["ix_image_gallery_entries_created_at"]["column_names"] == ["created_at"]
    assert indexes["ix_image_gallery_entries_enabled_created"]["column_names"] == ["enabled", "created_at"]
    assert indexes["ix_image_gallery_entries_group_enabled_created"]["column_names"] == [
        "resource_group_id",
        "enabled",
        "created_at",
    ]
    assert not inspector.get_foreign_keys("image_gallery_entries")

    engine.dispose()
    command.downgrade(config, "20260427_0015")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert "image_gallery_entries" not in inspector.get_table_names()
    engine.dispose()
    get_settings.cache_clear()


def test_ui_layout_scheme_migration_schema_and_downgrade_support_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "ui-layout-scheme-migration.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("user_ui_preferences")}
    assert columns["ui_layout_scheme"]["nullable"] is False
    assert columns["ui_layout_scheme"]["type"].length == 32

    with engine.begin() as connection:
        connection.execute(
            sa.text(
                """
                INSERT INTO user_ui_preferences (
                    user_id,
                    mask_sensitive_images_in_inspirations,
                    mask_sensitive_images_in_image_chat,
                    created_at,
                    updated_at
                )
                VALUES ('user-1', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """,
            ),
        )
        stored = connection.execute(
            sa.text("SELECT ui_layout_scheme FROM user_ui_preferences WHERE user_id = 'user-1'"),
        ).scalar_one()
    assert stored == "classic"

    engine.dispose()
    command.downgrade(config, "20260609_0051")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("user_ui_preferences")}
    assert "ui_layout_scheme" not in columns
    engine.dispose()
    get_settings.cache_clear()


def test_resource_library_migration_schema_and_downgrade_support_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "resource-library-migration.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert {
        "resource_library_groups",
        "resource_library_assets",
        "resource_library_asset_groups",
    } <= set(inspector.get_table_names())

    group_columns = {column["name"]: column for column in inspector.get_columns("resource_library_groups")}
    assert group_columns["id"]["nullable"] is False
    assert group_columns["owner_user_id"]["nullable"] is False
    assert group_columns["name"]["nullable"] is False
    assert group_columns["sort_order"]["nullable"] is False
    assert group_columns["archived_at"]["nullable"] is True
    group_indexes = {index["name"]: index for index in inspector.get_indexes("resource_library_groups")}
    assert bool(group_indexes["uq_resource_library_groups_owner_name_active"]["unique"])
    assert group_indexes["uq_resource_library_groups_owner_name_active"]["column_names"] == ["owner_user_id", "name"]
    assert group_indexes["ix_resource_library_groups_owner_archived"]["column_names"] == [
        "owner_user_id",
        "archived_at",
    ]

    asset_columns = {column["name"]: column for column in inspector.get_columns("resource_library_assets")}
    assert asset_columns["id"]["nullable"] is False
    assert asset_columns["owner_user_id"]["nullable"] is False
    assert asset_columns["kind"]["nullable"] is False
    assert asset_columns["source_type"]["nullable"] is False
    assert asset_columns["source_resource_id"]["nullable"] is True
    assert asset_columns["enabled"]["nullable"] is False
    assert asset_columns["archived_at"]["nullable"] is True
    asset_indexes = {index["name"]: index for index in inspector.get_indexes("resource_library_assets")}
    assert bool(asset_indexes["uq_resource_library_assets_owner_source"]["unique"])
    assert asset_indexes["uq_resource_library_assets_owner_source"]["column_names"] == [
        "owner_user_id",
        "source_type",
        "source_resource_id",
    ]
    assert asset_indexes["ix_resource_library_assets_owner_archived"]["column_names"] == [
        "owner_user_id",
        "archived_at",
    ]
    assert asset_indexes["ix_resource_library_assets_kind"]["column_names"] == ["kind"]

    link_columns = {column["name"]: column for column in inspector.get_columns("resource_library_asset_groups")}
    assert link_columns["asset_id"]["nullable"] is False
    assert link_columns["group_id"]["nullable"] is False
    assert link_columns["created_at"]["nullable"] is False
    assert set(inspector.get_pk_constraint("resource_library_asset_groups")["constrained_columns"]) == {
        "asset_id",
        "group_id",
    }
    link_indexes = {index["name"]: index for index in inspector.get_indexes("resource_library_asset_groups")}
    assert link_indexes["ix_resource_library_asset_groups_group"]["column_names"] == ["group_id"]
    assert not [
        foreign_key
        for table_name in (
            "resource_library_groups",
            "resource_library_assets",
            "resource_library_asset_groups",
        )
        for foreign_key in inspector.get_foreign_keys(table_name)
    ]

    engine.dispose()
    command.downgrade(config, "20260609_0050")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert not {
        "resource_library_groups",
        "resource_library_assets",
        "resource_library_asset_groups",
    } & set(inspector.get_table_names())
    engine.dispose()
    get_settings.cache_clear()


def test_job_runs_drop_migration_and_downgrade_support_sqlite(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "job-runs-drop.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260428_0016")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert "job_runs" in inspector.get_table_names()
    assert "uq_job_runs_one_active_per_inspiration_kind" in {
        index["name"] for index in inspector.get_indexes("job_runs")
    }

    engine.dispose()
    command.upgrade(config, "head")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert "job_runs" not in inspector.get_table_names()

    engine.dispose()
    command.downgrade(config, "20260428_0016")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    assert "job_runs" in inspector.get_table_names()
    columns = {column["name"]: column for column in inspector.get_columns("job_runs")}
    assert columns["inspiration_id"]["nullable"] is False
    assert columns["kind"]["nullable"] is False
    assert columns["status"]["nullable"] is False
    assert "uq_job_runs_one_active_per_inspiration_kind" in {
        index["name"] for index in inspector.get_indexes("job_runs")
    }

    engine.dispose()
    get_settings.cache_clear()


def test_image_session_generation_progress_migration_and_downgrade_support_sqlite(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_path = tmp_path / "image-session-progress.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260428_0017")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    now = "2026-04-28 00:00:00"
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO image_sessions (id, title, created_at, updated_at) "
                "VALUES ('session-1', '迁移会话', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO image_session_generation_tasks "
                "(id, session_id, status, prompt, size, generation_count, created_at, attempts, is_retryable) "
                "VALUES ('task-1', 'session-1', 'running', '旧任务', '1024x1024', 2, :now, 1, 1)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO image_session_generation_tasks "
                "(id, session_id, status, prompt, size, generation_count, created_at, attempts, is_retryable) "
                "VALUES ('failed-task-1', 'session-1', 'failed', '旧失败任务', '1024x1024', 4, :now, 1, 0)"
            ),
            {"now": now},
        )

    engine.dispose()
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"]: column for column in inspector.get_columns("image_session_generation_tasks")}
    assert columns["completed_candidates"]["nullable"] is False
    assert columns["completed_candidates"]["default"] is None
    assert columns["active_candidate_index"]["nullable"] is True
    assert columns["progress_phase"]["nullable"] is True
    assert columns["progress_updated_at"]["nullable"] is True
    assert columns["provider_response_id"]["nullable"] is True
    assert columns["provider_response_status"]["nullable"] is True
    assert columns["progress_metadata"]["nullable"] is True
    with engine.connect() as connection:
        completed_candidates = connection.execute(
            sa.text("SELECT completed_candidates FROM image_session_generation_tasks WHERE id = 'task-1'")
        ).scalar_one()
        failed_task_retryable = connection.execute(
            sa.text("SELECT is_retryable FROM image_session_generation_tasks WHERE id = 'failed-task-1'")
        ).scalar_one()
    assert completed_candidates == 0
    assert bool(failed_task_retryable) is True

    engine.dispose()
    command.downgrade(config, "20260428_0017")
    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("image_session_generation_tasks")}
    assert "completed_candidates" not in columns
    assert "progress_metadata" not in columns

    engine.dispose()
    get_settings.cache_clear()


def test_alembic_upgrade_removes_legacy_workflow_nodes(tmp_path: Path, monkeypatch) -> None:
    database_path = tmp_path / "legacy-workflow.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260424_0009")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    now = "2026-04-24 00:00:00"
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO inspirations (id, name, created_at, updated_at) "
                "VALUES ('inspiration-1', '旧工作流灵感产物', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO inspiration_workflows (id, inspiration_id, title, active, created_at, updated_at) "
                "VALUES ('workflow-1', 'inspiration-1', '旧工作流', 1, :now, :now)"
            ),
            {"now": now},
        )
        for node_id, node_type in (
            ("context-1", "inspiration_context"),
            ("copy-1", "copy_generation"),
            ("legacy-text-1", "legacy_text"),
            ("image-1", "image_generation"),
            ("legacy-result-1", "legacy_result"),
            ("slot-1", "image_upload"),
        ):
            connection.execute(
                sa.text(
                    "INSERT INTO workflow_nodes "
                    "(id, workflow_id, node_type, title, position_x, position_y, config_json, status, "
                    "created_at, updated_at) "
                    "VALUES (:id, 'workflow-1', :node_type, :id, 0, 0, '{}', 'idle', :now, :now)"
                ),
                {"id": node_id, "node_type": node_type, "now": now},
            )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_edges "
                "(id, workflow_id, source_node_id, target_node_id, source_handle, target_handle, created_at) "
                "VALUES "
                "('edge-old-target', 'workflow-1', 'copy-1', 'legacy-text-1', 'output', 'input', :now), "
                "('edge-old-source', 'workflow-1', 'legacy-result-1', 'image-1', 'output', 'input', :now), "
                "('edge-supported', 'workflow-1', 'context-1', 'copy-1', 'output', 'input', :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_runs (id, workflow_id, status, started_at) "
                "VALUES ('run-1', 'workflow-1', 'running', :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_node_runs (id, workflow_run_id, node_id, status, started_at) "
                "VALUES "
                "('node-run-old', 'run-1', 'legacy-text-1', 'succeeded', :now), "
                "('node-run-supported', 'run-1', 'copy-1', 'succeeded', :now)"
            ),
            {"now": now},
        )

    command.upgrade(config, "head")

    with engine.connect() as connection:
        node_types = connection.execute(sa.text("SELECT node_type FROM workflow_nodes ORDER BY id")).scalars().all()
        edge_ids = connection.execute(sa.text("SELECT id FROM workflow_edges ORDER BY id")).scalars().all()
        node_run_ids = connection.execute(sa.text("SELECT id FROM workflow_node_runs ORDER BY id")).scalars().all()

    assert node_types == ["inspiration_context", "copy_generation", "image_generation", "reference_image"]
    assert edge_ids == ["edge-supported"]
    assert node_run_ids == ["node-run-supported"]
    get_settings.cache_clear()


def test_disjoint_workflow_node_run_migration_constraints_support_sqlite(
    tmp_path: Path,
    monkeypatch,
) -> None:
    database_path = tmp_path / "workflow-node-run-constraints.db"
    storage_root = tmp_path / "storage"
    monkeypatch.setenv("ADMIN_ACCESS_KEY", "super-secret-admin-key")
    monkeypatch.setenv("SESSION_SECRET", "super-secret-session-key-123")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/9")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    get_settings.cache_clear()

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    command.upgrade(config, "20260507_0020")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    now = "2026-05-07 00:21:00"
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO inspirations (id, name, created_at, updated_at) "
                "VALUES ('inspiration-1', '节点并行迁移灵感产物', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO inspiration_workflows (id, inspiration_id, title, active, created_at, updated_at) "
                "VALUES ('workflow-1', 'inspiration-1', '节点并行迁移工作流', 1, :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_nodes "
                "(id, workflow_id, node_type, title, position_x, position_y, "
                "config_json, status, created_at, updated_at) "
                "VALUES "
                "('node-1', 'workflow-1', 'copy_generation', '文案', 0, 0, '{}', 'queued', :now, :now), "
                "('node-2', 'workflow-1', 'image_generation', '生图', 100, 0, '{}', 'queued', :now, :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_runs (id, workflow_id, status, started_at) "
                "VALUES ('run-1', 'workflow-1', 'running', :now)"
            ),
            {"now": now},
        )

    engine.dispose()
    command.upgrade(config, "head")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    indexes = {index["name"]: index for index in inspector.get_indexes("workflow_node_runs")}
    assert "uq_workflow_node_runs_one_active_per_node" in indexes
    assert bool(indexes["uq_workflow_node_runs_one_active_per_node"]["unique"])
    assert indexes["uq_workflow_node_runs_one_active_per_node"]["column_names"] == ["node_id"]
    workflow_run_indexes = {index["name"] for index in inspector.get_indexes("workflow_runs")}
    assert "uq_workflow_runs_one_running_per_workflow" not in workflow_run_indexes

    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO workflow_runs (id, workflow_id, status, started_at) "
                "VALUES ('run-2', 'workflow-1', 'running', :now)"
            ),
            {"now": now},
        )
        connection.execute(
            sa.text(
                "INSERT INTO workflow_node_runs (id, workflow_run_id, node_id, status, started_at) "
                "VALUES "
                "('node-run-1', 'run-1', 'node-1', 'queued', :now), "
                "('node-run-2', 'run-2', 'node-2', 'running', :now)"
            ),
            {"now": now},
        )

    with pytest.raises(sa.exc.IntegrityError):
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO workflow_node_runs (id, workflow_run_id, node_id, status, started_at) "
                    "VALUES ('node-run-duplicate', 'run-2', 'node-1', 'running', :now)"
                ),
                {"now": now},
            )

    engine.dispose()
    command.downgrade(config, "20260507_0020")

    engine = sa.create_engine(f"sqlite:///{database_path}")
    inspector = sa.inspect(engine)
    indexes = {index["name"]: index for index in inspector.get_indexes("workflow_runs")}
    assert "uq_workflow_runs_one_running_per_workflow" in indexes
    node_run_indexes = {index["name"] for index in inspector.get_indexes("workflow_node_runs")}
    assert "uq_workflow_node_runs_one_active_per_node" not in node_run_indexes
    with engine.connect() as connection:
        active_run_count = connection.execute(
            sa.text("SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = 'workflow-1' AND status = 'running'")
        ).scalar_one()
        failed_run_count = connection.execute(
            sa.text("SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = 'workflow-1' AND status = 'failed'")
        ).scalar_one()
        duplicate_run_active_node_runs = connection.execute(
            sa.text(
                "SELECT COUNT(*) FROM workflow_node_runs "
                "WHERE workflow_run_id = 'run-1' AND status IN ('queued', 'running')"
            )
        ).scalar_one()
    assert active_run_count == 1
    assert failed_run_count == 1
    assert duplicate_run_active_node_runs == 0
    engine.dispose()
    get_settings.cache_clear()
