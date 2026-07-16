from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import BytesIO

import pytest
from PIL import Image

from inspiration_one_backend.application.enhance.jobs import (
    attach_enhance_job_to_image_session,
    cleanup_expired_enhance_inputs,
    create_enhance_input_blob,
    create_enhance_job,
    execute_enhance_job,
    recover_unfinished_enhance_jobs,
    save_enhance_job_to_library,
    upload_enhance_final,
)
from inspiration_one_backend.application.enhance.strategy import EnhanceCancelledError, EnhanceResult, EnhanceTile
from inspiration_one_backend.application.resource_library import ensure_default_resource_library_group
from inspiration_one_backend.application.use_cases import create_inspiration
from inspiration_one_backend.domain.enums import (
    EnhanceSourceKind,
    EnhanceStrategy,
    ImageSessionAssetKind,
    JobStatus,
    ResourceLibrarySourceType,
)
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import (
    ADMIN_USER_ID,
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    AppSetting,
    EnhanceJob,
    GenerationConfigDailyStat,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
    utcnow,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.provider_config import ensure_provider_config_bootstrapped
from inspiration_one_backend.infrastructure.storage import LocalStorage


def test_direct_enhance_job_lifecycle_succeeds(db_session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    source_id = _create_source_asset(db_session, width=160, height=120)

    job = create_enhance_job(
        db_session,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref=source_id,
        strategy=EnhanceStrategy.DIRECT,
        params={"target_width": 512, "target_height": 512},
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )

    execute_enhance_job(job.id)

    db_session.expire_all()
    saved = db_session.get(EnhanceJob, job.id)
    assert saved is not None
    assert saved.status == JobStatus.SUCCEEDED
    assert saved.progress_completed == 1
    assert saved.progress_total == 1
    assert saved.used_generation_config_id is not None
    assert saved.result_manifest_json is not None
    assert saved.result_manifest_json["final_image_ref"] == f"enhance/{job.id}/final.png"
    assert saved.result_manifest_json["final_status"] == "ready"
    assert LocalStorage().stat(saved.result_manifest_json["final_image_ref"]).content_length > 0
    group = ensure_default_resource_library_group(db_session, owner_user_id=ADMIN_USER_ID)
    result = save_enhance_job_to_library(
        db_session,
        saved.id,
        group_ids=[group.id],
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    assert result.asset.source_type == ResourceLibrarySourceType.ENHANCE_JOB_RESULT


def test_tiled_final_can_exceed_generation_max_dimension_and_save_to_library(db_session) -> None:
    db_session.add(AppSetting(key="image_generation_max_dimension", value="512"))
    db_session.commit()
    ensure_provider_config_bootstrapped(db_session)
    source_id = _create_source_asset(db_session, width=200, height=200)

    job = create_enhance_job(
        db_session,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref=source_id,
        strategy=EnhanceStrategy.TILED,
        params={"scale": 4, "tile_base_size": 512},
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )

    execute_enhance_job(job.id)

    db_session.expire_all()
    saved = db_session.get(EnhanceJob, job.id)
    assert saved is not None
    assert saved.status == JobStatus.SUCCEEDED
    assert saved.result_manifest_json is not None
    assert saved.result_manifest_json["final_width"] == 800
    assert saved.result_manifest_json["final_height"] == 800
    assert saved.result_manifest_json["final_image_ref"] is None
    assert saved.result_manifest_json["final_status"] == "pending_upload"
    assert len(saved.result_manifest_json["tiles"]) == 4

    with pytest.raises(BusinessValidationError, match="拼接结果尚未上传"):
        save_enhance_job_to_library(
            db_session,
            saved.id,
            group_ids=[],
            actor_user_id=ADMIN_USER_ID,
            actor_is_admin=True,
        )

    upload_enhance_final(
        db_session,
        saved.id,
        content=_image_bytes(800, 800),
        mime_type="image/png",
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    db_session.refresh(saved)
    final_ref = saved.result_manifest_json["final_image_ref"]
    upload_enhance_final(
        db_session,
        saved.id,
        content=_image_bytes(1, 1),
        mime_type="image/png",
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    db_session.refresh(saved)
    assert saved.result_manifest_json["final_image_ref"] == final_ref
    assert saved.result_manifest_json["final_status"] == "ready"
    group = ensure_default_resource_library_group(db_session, owner_user_id=ADMIN_USER_ID)
    result = save_enhance_job_to_library(
        db_session,
        saved.id,
        group_ids=[group.id],
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )

    assert result.asset.source_type == ResourceLibrarySourceType.ENHANCE_JOB_RESULT
    assert result.asset.source_resource_id == saved.id
    second = save_enhance_job_to_library(
        db_session,
        saved.id,
        group_ids=[group.id],
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    assert second.created is False
    assert second.asset.id == result.asset.id

    stat = db_session.query(GenerationConfigDailyStat).filter_by(
        generation_config_id=saved.used_generation_config_id,
    ).one()
    assert stat.generated_unit_count == 4


def test_tiled_params_reject_non_default_overlap(db_session) -> None:
    ensure_provider_config_bootstrapped(db_session)
    source_id = _create_source_asset(db_session, width=200, height=200)

    with pytest.raises(BusinessValidationError, match="分块重叠比例固定为 10"):
        create_enhance_job(
            db_session,
            source_kind=EnhanceSourceKind.SOURCE_ASSET,
            source_ref=source_id,
            strategy=EnhanceStrategy.TILED,
            params={"scale": 2, "tile_base_size": 512, "overlap_pct": 20},
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            actor_user_id=ADMIN_USER_ID,
            actor_is_admin=True,
        )


def test_attach_enhance_job_to_image_session_creates_round_idempotently(db_session) -> None:
    source_asset = _create_image_session_asset(db_session, kind=ImageSessionAssetKind.REFERENCE_UPLOAD)
    job = _add_ready_image_session_enhance_job(db_session, source_asset)

    image_session = attach_enhance_job_to_image_session(
        db_session,
        job.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )

    assert image_session.id == source_asset.session_id
    generated_assets = [asset for asset in image_session.assets if asset.kind == ImageSessionAssetKind.GENERATED_IMAGE]
    assert len(generated_assets) == 1
    assert generated_assets[0].id != source_asset.id
    assert len(image_session.rounds) == 1
    round_item = image_session.rounds[0]
    assert round_item.generated_asset_id == generated_assets[0].id
    assert round_item.base_asset_ids == [source_asset.id]
    assert round_item.base_asset_id == source_asset.id
    assert round_item.provider_response_id == job.id
    assert round_item.provider_output_json["_inspiration_one"]["enhance_job_id"] == job.id

    second = attach_enhance_job_to_image_session(
        db_session,
        job.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )

    second_generated_assets = [
        asset for asset in second.assets if asset.kind == ImageSessionAssetKind.GENERATED_IMAGE
    ]
    assert [asset.id for asset in second_generated_assets] == [generated_assets[0].id]
    assert [item.id for item in second.rounds] == [round_item.id]
    assert db_session.query(ImageSessionRound).filter_by(session_id=source_asset.session_id).count() == 1


def test_attach_enhance_job_to_image_session_requires_session_source_and_final(db_session) -> None:
    source_id = _create_source_asset(db_session, width=120, height=80)
    non_session_job = EnhanceJob(
        owner_user_id=ADMIN_USER_ID,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref=source_id,
        source_width=120,
        source_height=80,
        source_mime_type="image/png",
        strategy=EnhanceStrategy.DIRECT,
        params_json={"target_width": 512, "target_height": 512},
        status=JobStatus.SUCCEEDED,
        progress_completed=1,
        progress_total=1,
        result_manifest_json={"final_image_ref": "enhance/missing/final.png"},
    )
    db_session.add(non_session_job)
    db_session.commit()

    with pytest.raises(BusinessValidationError, match="只有会话图片增强任务可以回填"):
        attach_enhance_job_to_image_session(
            db_session,
            non_session_job.id,
            actor_user_id=ADMIN_USER_ID,
            actor_is_admin=True,
        )

    source_asset = _create_image_session_asset(db_session, kind=ImageSessionAssetKind.GENERATED_IMAGE)
    pending_job = _add_ready_image_session_enhance_job(db_session, source_asset, final_ready=False)

    with pytest.raises(BusinessValidationError, match="拼接结果尚未上传"):
        attach_enhance_job_to_image_session(
            db_session,
            pending_job.id,
            actor_user_id=ADMIN_USER_ID,
            actor_is_admin=True,
        )


def test_cleanup_expired_enhance_inputs_keeps_referenced_snapshots(db_session) -> None:
    old_unreferenced = create_enhance_input_blob(
        db_session,
        content=_image_bytes(32, 32),
        mime_type="image/png",
        owner_user_id=ADMIN_USER_ID,
    )
    old_referenced = create_enhance_input_blob(
        db_session,
        content=_image_bytes(32, 32),
        mime_type="image/png",
        owner_user_id=ADMIN_USER_ID,
    )
    old_unreferenced_path = old_unreferenced.storage_path
    old_referenced_path = old_referenced.storage_path
    old_time = utcnow() - timedelta(days=8)
    old_unreferenced.created_at = old_time
    old_referenced.created_at = old_time
    db_session.add(
        EnhanceJob(
            owner_user_id=ADMIN_USER_ID,
            source_kind=EnhanceSourceKind.ENHANCE_INPUT_BLOB,
            source_ref=old_referenced.id,
            source_width=32,
            source_height=32,
            source_mime_type="image/png",
            strategy=EnhanceStrategy.DIRECT,
            params_json={"target_width": 512, "target_height": 512},
            status=JobStatus.QUEUED,
            progress_completed=0,
            progress_total=1,
        )
    )
    db_session.commit()

    deleted = cleanup_expired_enhance_inputs(db_session, owner_user_id=ADMIN_USER_ID)

    assert deleted == 1
    assert db_session.get(type(old_unreferenced), old_unreferenced.id) is None
    assert db_session.get(type(old_referenced), old_referenced.id) is not None
    assert LocalStorage().stat(old_unreferenced_path).content_length > 0
    assert LocalStorage().stat(old_referenced_path).content_length > 0


def test_enhance_job_requeues_when_image_capacity_is_full(db_session, monkeypatch: pytest.MonkeyPatch) -> None:
    job = EnhanceJob(
        owner_user_id=ADMIN_USER_ID,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref="source-1",
        source_width=100,
        source_height=100,
        source_mime_type="image/png",
        strategy=EnhanceStrategy.DIRECT,
        params_json={"target_width": 512, "target_height": 512},
        status=JobStatus.QUEUED,
        progress_completed=0,
        progress_total=1,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(job)
    db_session.commit()
    sent: list[tuple[str, int]] = []
    monkeypatch.setattr(
        "inspiration_one_backend.application.enhance.jobs.generation_running_capacity_available",
        lambda *_args, **_kwargs: False,
    )
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.queue.enqueue_enhance_job_later",
        lambda job_id, *, delay_ms: sent.append((job_id, delay_ms)),
    )

    execute_enhance_job(job.id)

    db_session.expire_all()
    saved = db_session.get(EnhanceJob, job.id)
    assert saved is not None
    assert saved.status == JobStatus.QUEUED
    assert sent == [(job.id, 2000)]


def test_enhance_job_cancel_keeps_partial_artifacts_for_lifecycle_cleanup(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ensure_provider_config_bootstrapped(db_session)
    source_id = _create_source_asset(db_session, width=160, height=120)
    job = create_enhance_job(
        db_session,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref=source_id,
        strategy=EnhanceStrategy.DIRECT,
        params={"target_width": 512, "target_height": 512},
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    artifact_key = f"enhance/{job.id}/tile-0-0.png"

    def cancel_after_artifact(job_arg, ctx):
        ctx.storage.save_enhance_tile(
            f"enhance/{job_arg.id}",
            0,
            0,
            _image_bytes(32, 32),
            content_type="image/png",
        )
        raise EnhanceCancelledError("cancelled")

    monkeypatch.setattr("inspiration_one_backend.application.enhance.jobs._run_strategy", cancel_after_artifact)

    execute_enhance_job(job.id)

    db_session.expire_all()
    saved = db_session.get(EnhanceJob, job.id)
    assert saved is not None
    assert saved.status == JobStatus.CANCELLED
    assert LocalStorage().stat(artifact_key).content_length > 0


def test_enhance_job_cancel_check_observes_cross_session_status(db_session, monkeypatch: pytest.MonkeyPatch) -> None:
    ensure_provider_config_bootstrapped(db_session)
    source_id = _create_source_asset(db_session, width=160, height=120)
    job = create_enhance_job(
        db_session,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref=source_id,
        strategy=EnhanceStrategy.DIRECT,
        params={"target_width": 512, "target_height": 512},
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    artifact_key = f"enhance/{job.id}/tile-0-0.png"

    def cancel_from_other_session(job_arg, ctx):
        ctx.storage.save_enhance_tile(
            f"enhance/{job_arg.id}",
            0,
            0,
            _image_bytes(32, 32),
            content_type="image/png",
        )
        with get_session_factory()() as other_session:
            other_job = other_session.get(EnhanceJob, job_arg.id)
            assert other_job is not None
            other_job.status = JobStatus.CANCELLED
            other_session.commit()
        if ctx.cancel_check is not None and ctx.cancel_check():
            raise EnhanceCancelledError("cancelled")
        raise AssertionError("cancel_check did not observe cross-session cancellation")

    monkeypatch.setattr("inspiration_one_backend.application.enhance.jobs._run_strategy", cancel_from_other_session)

    execute_enhance_job(job.id)

    db_session.expire_all()
    saved = db_session.get(EnhanceJob, job.id)
    assert saved is not None
    assert saved.status == JobStatus.CANCELLED
    assert LocalStorage().stat(artifact_key).content_length > 0


def test_enhance_job_cancel_after_strategy_return_keeps_unreferenced_artifacts(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ensure_provider_config_bootstrapped(db_session)
    source_id = _create_source_asset(db_session, width=160, height=120)
    job = create_enhance_job(
        db_session,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref=source_id,
        strategy=EnhanceStrategy.DIRECT,
        params={"target_width": 512, "target_height": 512},
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    final_key = f"enhance/{job.id}/final.png"

    def cancel_after_result(job_arg, ctx):
        storage_key = ctx.storage.save_enhance_final(
            f"enhance/{job_arg.id}",
            _image_bytes(512, 512),
            content_type="image/png",
        )
        with get_session_factory()() as other_session:
            other_job = other_session.get(EnhanceJob, job_arg.id)
            assert other_job is not None
            other_job.status = JobStatus.CANCELLED
            other_session.commit()
        return EnhanceResult(
            tiles=[
                EnhanceTile(
                    row=0,
                    col=0,
                    rows=1,
                    cols=1,
                    storage_key=storage_key,
                    target_x=0,
                    target_y=0,
                    target_width=512,
                    target_height=512,
                    blend_edges=(),
                    width=512,
                    height=512,
                    source_x=0,
                    source_y=0,
                    source_width=160,
                    source_height=120,
                )
            ],
            final_width=512,
            final_height=512,
            rows=1,
            cols=1,
            final_image_ref=storage_key,
            completed_call_count=1,
        )

    monkeypatch.setattr("inspiration_one_backend.application.enhance.jobs._run_strategy", cancel_after_result)

    execute_enhance_job(job.id)

    db_session.expire_all()
    saved = db_session.get(EnhanceJob, job.id)
    assert saved is not None
    assert saved.status == JobStatus.CANCELLED
    assert LocalStorage().stat(final_key).content_length > 0


def test_recover_unfinished_enhance_jobs_requeues_queued_jobs(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = _add_enhance_job(db_session, status=JobStatus.QUEUED)
    sent: list[str] = []
    monkeypatch.setattr("inspiration_one_backend.infrastructure.queue.enqueue_enhance_job", sent.append)

    recovered = recover_unfinished_enhance_jobs()

    assert recovered == 1
    assert sent == [job.id]


def test_recover_unfinished_enhance_jobs_resets_stale_running_jobs(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old_time = datetime.now(UTC) - timedelta(hours=2)
    job = _add_enhance_job(
        db_session,
        status=JobStatus.RUNNING,
        started_at=old_time,
        progress_updated_at=old_time,
        last_error="worker lost",
    )
    sent: list[str] = []
    monkeypatch.setattr("inspiration_one_backend.infrastructure.queue.enqueue_enhance_job", sent.append)

    recovered = recover_unfinished_enhance_jobs(
        reset_stale_running=True,
        stale_running_after=timedelta(minutes=30),
    )
    db_session.refresh(job)

    assert recovered == 1
    assert sent == [job.id]
    assert job.status == JobStatus.QUEUED
    assert job.started_at is None
    assert job.last_error is None


def test_recover_unfinished_enhance_jobs_keeps_fresh_running_jobs(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = _add_enhance_job(
        db_session,
        status=JobStatus.RUNNING,
        started_at=datetime.now(UTC) - timedelta(hours=2),
        progress_updated_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    sent: list[str] = []
    monkeypatch.setattr("inspiration_one_backend.infrastructure.queue.enqueue_enhance_job", sent.append)

    recovered = recover_unfinished_enhance_jobs(
        reset_stale_running=True,
        stale_running_after=timedelta(minutes=30),
    )
    db_session.refresh(job)

    assert recovered == 0
    assert sent == []
    assert job.status == JobStatus.RUNNING


def _create_source_asset(db_session, *, width: int, height: int) -> str:
    inspiration = create_inspiration(
        db_session,
        name=f"增强输入 {width}x{height}",
        category=None,
        price=None,
        source_note=None,
        image_bytes=_image_bytes(width, height),
        filename="source.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_is_admin=True,
    )
    assert inspiration.source_assets
    return inspiration.source_assets[0].id


def _create_image_session_asset(
    db_session,
    *,
    kind: ImageSessionAssetKind,
    width: int = 160,
    height: int = 120,
) -> ImageSessionAsset:
    image_session = ImageSession(
        owner_user_id=ADMIN_USER_ID,
        title="增强会话",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(image_session)
    db_session.flush()
    storage = LocalStorage()
    content = _image_bytes(width, height)
    storage_key = (
        storage.save_image_session_reference(image_session.id, content, content_type="image/png")
        if kind == ImageSessionAssetKind.REFERENCE_UPLOAD
        else storage.save_image_session_generated(image_session.id, content, content_type="image/png")
    )
    asset = ImageSessionAsset(
        owner_user_id=ADMIN_USER_ID,
        session_id=image_session.id,
        kind=kind,
        original_filename="source.png",
        mime_type="image/png",
        **storage.metadata_for(storage_key).as_model_kwargs(),
    )
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    return asset


def _add_ready_image_session_enhance_job(
    db_session,
    source_asset: ImageSessionAsset,
    *,
    final_ready: bool = True,
) -> EnhanceJob:
    job = EnhanceJob(
        owner_user_id=ADMIN_USER_ID,
        source_kind=EnhanceSourceKind.IMAGE_SESSION_ASSET,
        source_ref=source_asset.id,
        source_width=160,
        source_height=120,
        source_mime_type="image/png",
        strategy=EnhanceStrategy.DIRECT,
        params_json={"target_width": 320, "target_height": 240},
        status=JobStatus.SUCCEEDED,
        progress_completed=1,
        progress_total=1,
        used_generation_config_id=None,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(job)
    db_session.flush()
    final_ref = None
    if final_ready:
        final_ref = LocalStorage().save_enhance_final(
            f"enhance/{job.id}",
            _image_bytes(320, 240),
            content_type="image/png",
        )
    job.result_manifest_json = {
        "strategy": "direct",
        "final_width": 320,
        "final_height": 240,
        "rows": 1,
        "cols": 1,
        "final_image_ref": final_ref,
        "final_status": "ready" if final_ref else "pending_upload",
        "tiles": [],
    }
    db_session.commit()
    db_session.refresh(job)
    return job


def _add_enhance_job(
    db_session,
    *,
    status: JobStatus,
    started_at: datetime | None = None,
    progress_updated_at: datetime | None = None,
    last_error: str | None = None,
) -> EnhanceJob:
    job = EnhanceJob(
        owner_user_id=ADMIN_USER_ID,
        source_kind=EnhanceSourceKind.SOURCE_ASSET,
        source_ref="source-1",
        source_width=100,
        source_height=100,
        source_mime_type="image/png",
        strategy=EnhanceStrategy.DIRECT,
        params_json={"target_width": 512, "target_height": 512},
        status=status,
        progress_completed=0,
        progress_total=1,
        progress_updated_at=progress_updated_at,
        started_at=started_at,
        last_error=last_error,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(job)
    db_session.commit()
    return job


def _image_bytes(width: int, height: int) -> bytes:
    image = Image.new("RGB", (width, height), (128, 160, 192))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()
