from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.admission import generation_running_capacity_available
from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.generation_config_runtime import (
    GenerationConfigSelection,
    GenerationConfigWaitError,
    claim_runtime_generation_config,
    generation_failure_is_throttled,
    generation_failure_is_timeout,
    generation_failure_reason,
    release_runtime_generation_config,
)
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner
from inspiration_one_backend.application.queue_submission import enqueue_or_mark_failed
from inspiration_one_backend.application.resource_library import (
    ResourceLibrarySaveResult,
    save_resource_library_asset_from_source,
)
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import (
    EnhanceSourceKind,
    EnhanceStrategy,
    ImageSessionAssetKind,
    JobStatus,
    ResourceLibraryAssetKind,
    ResourceLibrarySourceType,
    SourceAssetKind,
)
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    EnhanceJob,
    EnhanceJobInput,
    GenerationConfig,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
    ResourceLibraryAsset,
    SourceAsset,
    new_id,
    utcnow,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.image.base import image_dimensions_from_bytes, infer_extension
from inspiration_one_backend.infrastructure.image.chat_service import ImageChatService
from inspiration_one_backend.infrastructure.provider_config import IMAGE_PURPOSE, generation_config_resource_group_ids
from inspiration_one_backend.infrastructure.storage import LocalStorage

from .strategy import (
    DirectParams,
    EnhanceCancelledError,
    EnhanceContext,
    EnhanceResult,
    TiledParams,
    run_direct_strategy,
    run_tiled_strategy,
)

logger = logging.getLogger(__name__)

ENHANCE_INPUT_TTL = timedelta(days=7)
ENHANCE_CAPACITY_RETRY_DELAY_MS = 2000
ENHANCE_FINAL_MAX_PIXELS = 120_000_000
ENHANCE_FINAL_MAX_EDGE = 16_384
ENHANCE_FINAL_MAX_UPLOAD_BYTES = 256 * 1024 * 1024
ENHANCE_CANCELLED_REASON = "已取消"

SOURCE_ASSET_IMAGE_KINDS = frozenset(
    {
        SourceAssetKind.ORIGINAL_IMAGE,
        SourceAssetKind.REFERENCE_IMAGE,
        SourceAssetKind.PROCESSED_INSPIRATION_IMAGE,
        SourceAssetKind.CONTEXT_IMAGE,
    }
)


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


@dataclass(frozen=True, slots=True)
class LoadedEnhanceSource:
    content: bytes
    mime_type: str
    width: int
    height: int
    owner_user_id: str


@dataclass(frozen=True, slots=True)
class EnhanceJobClaimResult:
    claimed: bool
    should_requeue: bool = False


def list_enhance_jobs(
    session: Session,
    *,
    actor_user_id: str,
    limit: int = 50,
    offset: int = 0,
    status_filter: JobStatus | None = None,
) -> list[EnhanceJob]:
    conditions = [EnhanceJob.owner_user_id == actor_user_id]
    if status_filter is not None:
        conditions.append(EnhanceJob.status == status_filter)
    return list(
        session.scalars(
            select(EnhanceJob)
            .where(*conditions)
            .order_by(EnhanceJob.created_at.desc(), EnhanceJob.id.desc())
            .offset(max(0, offset))
            .limit(max(1, min(limit, 100)))
        ).all()
    )


def count_enhance_jobs(
    session: Session,
    *,
    actor_user_id: str,
    status_filter: JobStatus | None = None,
) -> int:
    conditions = [EnhanceJob.owner_user_id == actor_user_id]
    if status_filter is not None:
        conditions.append(EnhanceJob.status == status_filter)
    return int(session.scalar(select(func.count()).select_from(EnhanceJob).where(*conditions)) or 0)


def get_enhance_job(
    session: Session,
    job_id: str,
    *,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> EnhanceJob:
    job = session.get(EnhanceJob, job_id)
    if job is None:
        raise NotFoundError("图片增强任务不存在")
    ensure_actor_can_mutate_owner(
        owner_user_id=job.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="图片增强任务不存在",
    )
    return job


def create_enhance_job(
    session: Session,
    *,
    source_kind: EnhanceSourceKind,
    source_ref: str,
    strategy: EnhanceStrategy,
    params: dict[str, Any],
    resource_group_id: str | None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> EnhanceJob:
    storage = storage or LocalStorage()
    cleanup_expired_enhance_inputs(session, owner_user_id=actor_user_id, storage=storage)
    source = load_enhance_source(
        session,
        source_kind=source_kind,
        source_ref=source_ref,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        storage=storage,
    )
    normalized_params = validate_enhance_params(strategy=strategy, params=params, source=source)
    selection = _authorized_image_generation_config_selection(
        session,
        resource_group_id=resource_group_id or DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        generation_config_mode=generation_config_mode,
        generation_config_id=generation_config_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    job = EnhanceJob(
        owner_user_id=source.owner_user_id,
        source_kind=source_kind,
        source_ref=source_ref,
        source_width=source.width,
        source_height=source.height,
        source_mime_type=source.mime_type,
        strategy=strategy,
        params_json=normalized_params,
        status=JobStatus.QUEUED,
        progress_completed=0,
        progress_total=_expected_progress_total(strategy=strategy, params=normalized_params, source=source),
        generation_config_mode=selection.mode,
        requested_generation_config_id=selection.generation_config_id,
        resource_group_id=selection.resource_group_id,
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def submit_enhance_job(
    session: Session,
    *,
    source_kind: EnhanceSourceKind,
    source_ref: str,
    strategy: EnhanceStrategy,
    params: dict[str, Any],
    resource_group_id: str | None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> EnhanceJob:
    job = create_enhance_job(
        session,
        source_kind=source_kind,
        source_ref=source_ref,
        strategy=strategy,
        params=params,
        resource_group_id=resource_group_id,
        generation_config_mode=generation_config_mode,
        generation_config_id=generation_config_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        storage=storage,
    )
    from inspiration_one_backend.infrastructure.queue import enqueue_enhance_job

    enqueue_or_mark_failed(job.id, enqueue=enqueue_enhance_job, mark_failed=mark_enhance_job_enqueue_failed)
    session.expire_all()
    return session.get(EnhanceJob, job.id) or job


def mark_enhance_job_enqueue_failed(job_id: str, reason: str) -> None:
    session = get_session_factory()()
    try:
        job = session.get(EnhanceJob, job_id)
        if job is not None and job.status == JobStatus.QUEUED:
            job.status = JobStatus.FAILED
            job.last_error = reason
            job.finished_at = now_utc()
            session.commit()
    finally:
        session.close()


def cancel_enhance_job(
    session: Session,
    job_id: str,
    *,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> EnhanceJob:
    job = get_enhance_job(session, job_id, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if job.status not in {JobStatus.QUEUED, JobStatus.RUNNING}:
        raise BusinessValidationError("已结束的图片增强任务不能取消")
    job.status = JobStatus.CANCELLED
    job.last_error = ENHANCE_CANCELLED_REASON
    if job.finished_at is None:
        job.finished_at = now_utc()
    session.commit()
    session.refresh(job)
    return job


def execute_enhance_job(job_id: str) -> None:
    session = get_session_factory()()
    storage = LocalStorage()
    claim = None
    completed_call_count = 0
    job: EnhanceJob | None = None
    try:
        job = session.get(EnhanceJob, job_id)
        if job is None or job.status in {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}:
            return
        claim_result = _mark_enhance_job_running(session, job)
        if not claim_result.claimed:
            if claim_result.should_requeue:
                _requeue_enhance_job_after_capacity_wait(job_id)
            return
        source = load_enhance_source_for_job(session, job, storage=storage)
        try:
            claim = claim_runtime_generation_config(
                purpose="image",
                selection=_job_generation_config_selection(job),
            )
            job.used_generation_config_id = claim.generation_config_id
            job.resource_group_id = claim.resource_group_id
            session.commit()
            service = ImageChatService(generation_config_id=claim.generation_config_id)

            def progress_callback(completed: int, total: int) -> None:
                nonlocal completed_call_count
                completed_call_count = completed
                _update_job_progress(
                    session,
                    job_id=job.id,
                    completed=completed,
                    total=total,
                )

            ctx = EnhanceContext(
                session=session,
                storage=storage,
                service=service,
                source_image_bytes=source.content,
                source_mime=source.mime_type,
                source_width=source.width,
                source_height=source.height,
                output_prefix=f"enhance/{job.id}",
                reference_limit=2,
                progress_callback=progress_callback,
                cancel_check=lambda: _job_cancelled(session, job_id),
            )
            result = _run_strategy(job, ctx)
            completed_call_count = result.completed_call_count
            if _job_cancelled(session, job.id):
                raise EnhanceCancelledError("图片增强已取消")
            _mark_enhance_job_succeeded(session, job_id=job.id, result=result)
            release_runtime_generation_config(
                claim,
                success=True,
                user_id=job.owner_user_id,
                generated_unit_count=completed_call_count or 1,
            )
            claim = None
        except GenerationConfigWaitError:
            session.rollback()
            _reset_running_job_to_queued(session, job_id)
            _requeue_enhance_job_after_capacity_wait(job_id)
        except EnhanceCancelledError:
            session.rollback()
            storage.delete_enhance_artifacts(job_id)
            _mark_enhance_job_cancelled(session, job_id)
            if claim is not None:
                release_runtime_generation_config(
                    claim,
                    success=False,
                    user_id=job.owner_user_id,
                    generated_unit_count=max(0, completed_call_count),
                    failure_reason=ENHANCE_CANCELLED_REASON,
                )
                claim = None
        except Exception as exc:
            session.rollback()
            storage.delete_enhance_artifacts(job_id)
            _mark_enhance_job_failed(session, job_id, generation_failure_reason(exc))
            if claim is not None and job is not None:
                release_runtime_generation_config(
                    claim,
                    success=False,
                    user_id=job.owner_user_id,
                    generated_unit_count=max(0, completed_call_count),
                    failure_reason=generation_failure_reason(exc),
                    timeout=generation_failure_is_timeout(exc),
                    throttled=generation_failure_is_throttled(exc),
                )
                claim = None
    finally:
        session.close()


def upload_enhance_final(
    session: Session,
    job_id: str,
    *,
    content: bytes,
    mime_type: str,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> EnhanceJob:
    storage = storage or LocalStorage()
    job = get_enhance_job(session, job_id, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if job.strategy != EnhanceStrategy.TILED:
        raise BusinessValidationError("只有分块增强任务需要上传拼接结果")
    if job.status != JobStatus.SUCCEEDED:
        raise BusinessValidationError("图片增强任务尚未完成")
    manifest = _manifest(job)
    final_ref = manifest.get("final_image_ref")
    if isinstance(final_ref, str) and final_ref:
        return job
    expected = _final_dimensions_for_job(job)
    actual = image_dimensions_from_bytes(content)
    if actual != expected:
        raise BusinessValidationError("拼接结果尺寸不匹配")
    _validate_final_resource_bounds(width=expected[0], height=expected[1], byte_count=len(content))
    storage_key = storage.save_enhance_final(f"enhance/{job.id}", content, suffix=infer_extension(mime_type))
    manifest["final_image_ref"] = storage_key
    manifest["final_status"] = "ready"
    manifest["final_mime_type"] = mime_type
    manifest["final_width"] = expected[0]
    manifest["final_height"] = expected[1]
    job.result_manifest_json = manifest
    job.updated_at = now_utc()
    session.commit()
    session.refresh(job)
    return job


def save_enhance_job_to_library(
    session: Session,
    job_id: str,
    *,
    group_ids: list[str] | None,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> ResourceLibrarySaveResult:
    job = get_enhance_job(session, job_id, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if job.status != JobStatus.SUCCEEDED:
        raise BusinessValidationError("图片增强任务尚未完成")
    if not _manifest(job).get("final_image_ref"):
        raise BusinessValidationError("拼接结果尚未上传")
    return save_resource_library_asset_from_source(
        session,
        source_type=ResourceLibrarySourceType.ENHANCE_JOB_RESULT,
        source_id=job.id,
        group_ids=group_ids,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def attach_enhance_job_to_image_session(
    session: Session,
    job_id: str,
    *,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageSession:
    storage = storage or LocalStorage()
    job = get_enhance_job(session, job_id, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if job.source_kind != EnhanceSourceKind.IMAGE_SESSION_ASSET:
        raise BusinessValidationError("只有会话图片增强任务可以回填到连续生图")
    if job.status != JobStatus.SUCCEEDED:
        raise BusinessValidationError("图片增强任务尚未完成")
    manifest = _manifest(job)
    final_ref = manifest.get("final_image_ref")
    if not isinstance(final_ref, str) or not final_ref:
        raise BusinessValidationError("拼接结果尚未上传")

    source_asset = session.scalar(
        select(ImageSessionAsset)
        .options(selectinload(ImageSessionAsset.session))
        .where(ImageSessionAsset.id == job.source_ref)
    )
    if source_asset is None or source_asset.session is None:
        raise NotFoundError("会话图片不存在")
    ensure_actor_can_mutate_owner(
        owner_user_id=source_asset.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="会话图片不存在",
    )
    if source_asset.session.owner_user_id != source_asset.owner_user_id:
        raise BusinessValidationError("会话图片归属异常")
    if source_asset.kind not in {ImageSessionAssetKind.GENERATED_IMAGE, ImageSessionAssetKind.REFERENCE_UPLOAD}:
        raise BusinessValidationError("只能回填会话图片增强结果")
    ensure_resource_usable(source_asset.session)
    ensure_resource_usable(source_asset)

    existing_round = _attached_image_session_round(session, image_session_id=source_asset.session_id, job_id=job.id)
    if existing_round is not None:
        from inspiration_one_backend.application.image_sessions import get_image_session_detail

        return get_image_session_detail(
            session,
            source_asset.session_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
        )

    try:
        final_bytes = storage.resolve(final_ref).read_bytes()
    except (OSError, ValueError) as exc:
        raise BusinessValidationError("增强结果文件不存在") from exc

    dimensions = image_dimensions_from_bytes(final_bytes)
    if dimensions is None:
        raise BusinessValidationError("增强结果不是可解码图片")
    final_width = _manifest_int(manifest, "final_width") or dimensions[0]
    final_height = _manifest_int(manifest, "final_height") or dimensions[1]
    mime_type = str(manifest.get("final_mime_type") or job.source_mime_type or "image/png")
    saved_path = storage.save_image_session_generated(
        source_asset.session_id,
        final_bytes,
        suffix=infer_extension(mime_type),
    )
    generated_asset = ImageSessionAsset(
        owner_user_id=source_asset.owner_user_id,
        session_id=source_asset.session_id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename=f"enhance-{job.id}{infer_extension(mime_type)}",
        mime_type=mime_type,
        **storage.metadata_for(saved_path).as_model_kwargs(),
    )
    session.add(generated_asset)
    session.flush()

    model_name, provider_name = _enhance_generation_config_display(session, job.used_generation_config_id)
    requested_size = f"{final_width}x{final_height}"
    provider_output_json = {
        "_inspiration_one": {
            "source": "enhance_job",
            "enhance_job_id": job.id,
            "source_asset_id": source_asset.id,
            "source_session_id": source_asset.session_id,
            "source_kind": job.source_kind.value,
            "strategy": job.strategy.value,
            "actual_image_size": f"{dimensions[0]}x{dimensions[1]}",
        }
    }
    if dimensions != (final_width, final_height):
        provider_output_json["_inspiration_one"]["notes"] = [
            {
                "kind": "actual_size_mismatch",
                "message": f"增强结果实际尺寸 {dimensions[0]}x{dimensions[1]}，任务尺寸为 {requested_size}。",
                "requested_size": requested_size,
                "actual_size": f"{dimensions[0]}x{dimensions[1]}",
            }
        ]
    round_item = ImageSessionRound(
        session_id=source_asset.session_id,
        prompt="图片增强",
        assistant_message="图片增强已完成，可作为下一轮基图继续。",
        size=requested_size,
        model_name=model_name,
        provider_name=provider_name,
        prompt_version="enhance-v1",
        provider_response_id=job.id,
        previous_response_id=None,
        image_generation_call_id=None,
        provider_request_json={
            "_inspiration_one": {
                "source": "enhance_job",
                "enhance_job_id": job.id,
                "source_asset_id": source_asset.id,
            },
            "strategy": job.strategy.value,
            "params": dict(job.params_json or {}),
            "source": {
                "kind": job.source_kind.value,
                "ref": job.source_ref,
                "width": job.source_width,
                "height": job.source_height,
                "mime_type": job.source_mime_type,
            },
        },
        provider_output_json=provider_output_json,
        generation_config_id=job.used_generation_config_id,
        resource_group_id=job.resource_group_id,
        generation_group_id=new_id(),
        candidate_index=1,
        candidate_count=1,
        base_asset_ids=[source_asset.id],
        base_asset_id=source_asset.id,
        selected_reference_asset_ids=[],
        generated_asset_id=generated_asset.id,
    )
    session.add(round_item)
    source_asset.session.updated_at = now_utc()
    session.commit()
    session.expire_all()

    from inspiration_one_backend.application.image_sessions import get_image_session_detail

    return get_image_session_detail(
        session,
        source_asset.session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def create_enhance_input_blob(
    session: Session,
    *,
    content: bytes,
    mime_type: str,
    owner_user_id: str,
    storage: LocalStorage | None = None,
) -> EnhanceJobInput:
    dimensions = image_dimensions_from_bytes(content)
    if dimensions is None:
        raise BusinessValidationError("增强输入不是可解码图片")
    storage = storage or LocalStorage()
    blob_id = new_id()
    storage_key = storage.save_enhance_input_blob(blob_id, content, suffix=infer_extension(mime_type))
    metadata = storage.metadata_for(storage_key)
    blob = EnhanceJobInput(
        id=blob_id,
        owner_user_id=owner_user_id,
        mime_type=mime_type or "image/png",
        width=dimensions[0],
        height=dimensions[1],
        **metadata.as_model_kwargs(),
    )
    session.add(blob)
    session.commit()
    session.refresh(blob)
    return blob


def load_enhance_source_for_job(session: Session, job: EnhanceJob, *, storage: LocalStorage) -> LoadedEnhanceSource:
    return load_enhance_source(
        session,
        source_kind=job.source_kind,
        source_ref=job.source_ref,
        actor_user_id=job.owner_user_id,
        actor_is_admin=False,
        storage=storage,
    )


def load_enhance_source(
    session: Session,
    *,
    source_kind: EnhanceSourceKind,
    source_ref: str,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> LoadedEnhanceSource:
    storage = storage or LocalStorage()
    if source_kind == EnhanceSourceKind.RESOURCE_LIBRARY_ASSET:
        asset = session.scalar(
            select(ResourceLibraryAsset).where(
                ResourceLibraryAsset.id == source_ref,
                ResourceLibraryAsset.archived_at.is_(None),
            )
        )
        if asset is None:
            raise NotFoundError("资源不存在")
        ensure_actor_can_mutate_owner(
            owner_user_id=asset.owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="资源不存在",
        )
        if asset.kind != ResourceLibraryAssetKind.IMAGE:
            raise BusinessValidationError("只能增强图片资源")
        ensure_resource_usable(asset)
        return _loaded_source_from_storage(storage, asset, owner_user_id=asset.owner_user_id, mime_type=asset.mime_type)

    if source_kind == EnhanceSourceKind.SOURCE_ASSET:
        asset = session.scalar(
            select(SourceAsset)
            .options(selectinload(SourceAsset.inspiration))
            .where(SourceAsset.id == source_ref)
        )
        if asset is None or asset.inspiration is None:
            raise NotFoundError("源图不存在")
        ensure_actor_can_mutate_owner(
            owner_user_id=asset.inspiration.owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="源图不存在",
        )
        if asset.kind not in SOURCE_ASSET_IMAGE_KINDS:
            raise BusinessValidationError("只能增强图片素材")
        ensure_resource_usable(asset)
        return _loaded_source_from_storage(
            storage,
            asset,
            owner_user_id=asset.inspiration.owner_user_id,
            mime_type=asset.mime_type,
        )

    if source_kind == EnhanceSourceKind.IMAGE_SESSION_ASSET:
        asset = session.scalar(
            select(ImageSessionAsset)
            .options(selectinload(ImageSessionAsset.session))
            .where(ImageSessionAsset.id == source_ref)
        )
        if asset is None:
            raise NotFoundError("会话图片不存在")
        ensure_actor_can_mutate_owner(
            owner_user_id=asset.owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="会话图片不存在",
        )
        if asset.kind not in {ImageSessionAssetKind.GENERATED_IMAGE, ImageSessionAssetKind.REFERENCE_UPLOAD}:
            raise BusinessValidationError("只能增强会话图片")
        if asset.session is not None:
            ensure_resource_usable(asset.session)
        ensure_resource_usable(asset)
        return _loaded_source_from_storage(storage, asset, owner_user_id=asset.owner_user_id, mime_type=asset.mime_type)

    if source_kind == EnhanceSourceKind.ENHANCE_INPUT_BLOB:
        blob = session.get(EnhanceJobInput, source_ref)
        if blob is None:
            raise NotFoundError("增强输入不存在")
        ensure_actor_can_mutate_owner(
            owner_user_id=blob.owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="增强输入不存在",
        )
        return _loaded_source_from_storage(storage, blob, owner_user_id=blob.owner_user_id, mime_type=blob.mime_type)

    raise BusinessValidationError("暂不支持该增强来源")


def validate_enhance_params(
    *,
    strategy: EnhanceStrategy,
    params: dict[str, Any],
    source: LoadedEnhanceSource,
) -> dict[str, Any]:
    settings = get_runtime_settings()
    if strategy == EnhanceStrategy.DIRECT:
        target_width = _positive_int(params.get("target_width"), "目标宽度")
        target_height = _positive_int(params.get("target_height"), "目标高度")
        max_dim = int(settings.image_generation_max_dimension)
        if target_width > max_dim or target_height > max_dim:
            raise BusinessValidationError(f"目标尺寸不能超过生图最大单边 {max_dim}")
        return {"target_width": target_width, "target_height": target_height}

    if strategy == EnhanceStrategy.TILED:
        scale = _positive_int(params.get("scale"), "增强倍数")
        if scale not in {2, 3, 4}:
            raise BusinessValidationError("分块增强倍数只能是 2、3 或 4")
        tile_base_size = _positive_int(params.get("tile_base_size", 1024), "分块尺寸")
        overlap_pct = _non_negative_int(params.get("overlap_pct", 10), "重叠比例")
        if overlap_pct != 10:
            raise BusinessValidationError("分块重叠比例固定为 10")
        max_dim = int(settings.image_generation_max_dimension)
        if tile_base_size > max_dim:
            raise BusinessValidationError(f"单块尺寸不能超过生图最大单边 {max_dim}")
        final_width = source.width * scale
        final_height = source.height * scale
        _validate_final_resource_bounds(width=final_width, height=final_height, byte_count=0)
        return {"scale": scale, "tile_base_size": tile_base_size, "overlap_pct": overlap_pct}

    raise BusinessValidationError("暂不支持该增强策略")


def cleanup_expired_enhance_inputs(
    session: Session | None = None,
    *,
    owner_user_id: str | None = None,
    older_than: timedelta = ENHANCE_INPUT_TTL,
    storage: LocalStorage | None = None,
) -> int:
    owns_session = session is None
    working_session = session or get_session_factory()()
    storage = storage or LocalStorage()
    cutoff = utcnow() - older_than
    deleted = 0
    try:
        stmt = select(EnhanceJobInput).where(EnhanceJobInput.created_at < cutoff)
        if owner_user_id is not None:
            stmt = stmt.where(EnhanceJobInput.owner_user_id == owner_user_id)
        for item in list(working_session.scalars(stmt).all()):
            referenced = working_session.scalar(
                select(EnhanceJob.id).where(
                    EnhanceJob.source_kind == EnhanceSourceKind.ENHANCE_INPUT_BLOB,
                    EnhanceJob.source_ref == item.id,
                )
            )
            if referenced is not None:
                continue
            with _suppress_storage_errors():
                storage.delete_image_with_variants(storage.object_key_for(item))
            working_session.delete(item)
            deleted += 1
        if deleted:
            working_session.commit()
        elif owns_session:
            working_session.rollback()
        return deleted
    except Exception:
        if owns_session:
            working_session.rollback()
        raise
    finally:
        if owns_session:
            working_session.close()


def recover_unfinished_enhance_jobs(
    *,
    reset_stale_running: bool = False,
    stale_running_after: timedelta = timedelta(minutes=30),
) -> int:
    session = get_session_factory()()
    job_ids: list[str] = []
    cutoff = utcnow() - stale_running_after
    try:
        jobs = list(
            session.scalars(
                select(EnhanceJob).where(EnhanceJob.status.in_((JobStatus.QUEUED, JobStatus.RUNNING)))
            ).all()
        )
        for job in jobs:
            if job.status == JobStatus.RUNNING:
                if not reset_stale_running:
                    continue
                updated_at = job.progress_updated_at or job.updated_at or job.started_at
                if updated_at is not None and _as_aware_utc(updated_at) > cutoff:
                    continue
                job.status = JobStatus.QUEUED
                job.started_at = None
                job.last_error = None
            job_ids.append(job.id)
        session.commit()
    except Exception:
        session.rollback()
        logger.exception("恢复滞留图片增强任务失败")
        return 0
    finally:
        session.close()

    enqueued = 0
    from inspiration_one_backend.infrastructure.queue import enqueue_enhance_job

    for job_id in job_ids:
        try:
            enqueue_enhance_job(job_id)
            enqueued += 1
        except Exception:
            logger.exception("恢复图片增强任务入队失败: job_id=%s", job_id)
    return enqueued


def _run_strategy(job: EnhanceJob, ctx: EnhanceContext) -> EnhanceResult:
    if job.strategy == EnhanceStrategy.DIRECT:
        return run_direct_strategy(
            ctx,
            DirectParams(
                target_width=int(job.params_json["target_width"]),
                target_height=int(job.params_json["target_height"]),
            ),
        )
    if job.strategy == EnhanceStrategy.TILED:
        return run_tiled_strategy(
            ctx,
            TiledParams(
                scale=int(job.params_json["scale"]),
                tile_base_size=int(job.params_json["tile_base_size"]),
                overlap_pct=int(job.params_json["overlap_pct"]),
            ),
        )
    raise BusinessValidationError("暂不支持该增强策略")


def _mark_enhance_job_running(session: Session, job: EnhanceJob) -> EnhanceJobClaimResult:
    if job.status != JobStatus.QUEUED:
        return EnhanceJobClaimResult(claimed=False)
    now = now_utc()
    if not generation_running_capacity_available(session, pool="image"):
        job.progress_updated_at = now
        session.commit()
        return EnhanceJobClaimResult(claimed=False, should_requeue=True)
    result = session.execute(
        update(EnhanceJob)
        .where(EnhanceJob.id == job.id, EnhanceJob.status == JobStatus.QUEUED)
        .values(
            status=JobStatus.RUNNING,
            started_at=now,
            finished_at=None,
            last_error=None,
            progress_updated_at=now,
            attempts=EnhanceJob.attempts + 1,
        )
    )
    if not isinstance(result, CursorResult) or result.rowcount != 1:
        session.rollback()
        return EnhanceJobClaimResult(claimed=False)
    session.commit()
    session.refresh(job)
    return EnhanceJobClaimResult(claimed=True)


def _update_job_progress(session: Session, *, job_id: str, completed: int, total: int) -> None:
    job = session.get(EnhanceJob, job_id)
    if job is None:
        return
    job.progress_completed = completed
    job.progress_total = total
    job.progress_updated_at = now_utc()
    session.commit()


def _job_cancelled(session: Session, job_id: str) -> bool:
    job = session.get(EnhanceJob, job_id)
    if job is None:
        return True
    session.refresh(job)
    return job.status == JobStatus.CANCELLED


def _mark_enhance_job_succeeded(session: Session, *, job_id: str, result: EnhanceResult) -> None:
    job = session.get(EnhanceJob, job_id)
    if job is None or job.status == JobStatus.CANCELLED:
        return
    job.status = JobStatus.SUCCEEDED
    job.progress_completed = result.completed_call_count
    job.progress_total = result.completed_call_count
    job.progress_updated_at = now_utc()
    job.result_manifest_json = _result_manifest(job, result)
    job.last_error = None
    job.finished_at = now_utc()
    session.commit()


def _mark_enhance_job_failed(session: Session, job_id: str, reason: str) -> None:
    job = session.get(EnhanceJob, job_id)
    if job is None or job.status == JobStatus.CANCELLED:
        return
    job.status = JobStatus.FAILED
    job.last_error = reason[:1000]
    job.finished_at = now_utc()
    job.progress_updated_at = job.finished_at
    session.commit()


def _mark_enhance_job_cancelled(session: Session, job_id: str) -> None:
    job = session.get(EnhanceJob, job_id)
    if job is None:
        return
    job.status = JobStatus.CANCELLED
    job.last_error = ENHANCE_CANCELLED_REASON
    job.finished_at = now_utc()
    job.progress_updated_at = job.finished_at
    session.commit()


def _reset_running_job_to_queued(session: Session, job_id: str) -> None:
    job = session.get(EnhanceJob, job_id)
    if job is not None and job.status == JobStatus.RUNNING:
        job.status = JobStatus.QUEUED
        job.started_at = None
        job.progress_updated_at = now_utc()
        session.commit()


def _requeue_enhance_job_after_capacity_wait(job_id: str) -> None:
    from inspiration_one_backend.infrastructure.queue import enqueue_enhance_job_later

    try:
        enqueue_enhance_job_later(job_id, delay_ms=ENHANCE_CAPACITY_RETRY_DELAY_MS)
    except Exception:
        logger.exception("图片增强等待容量后重新入队失败: job_id=%s", job_id)


def _result_manifest(job: EnhanceJob, result: EnhanceResult) -> dict[str, Any]:
    final_image_ref = result.final_image_ref
    return {
        "strategy": job.strategy.value,
        "source": {
            "kind": job.source_kind.value,
            "ref": job.source_ref,
            "width": job.source_width,
            "height": job.source_height,
            "mime_type": job.source_mime_type,
        },
        "final_width": result.final_width,
        "final_height": result.final_height,
        "rows": result.rows,
        "cols": result.cols,
        "final_image_ref": final_image_ref,
        "final_status": "ready" if final_image_ref else "pending_upload",
        "tiles": [
            {
                "row": tile.row,
                "col": tile.col,
                "rows": tile.rows,
                "cols": tile.cols,
                "storage_key": tile.storage_key,
                "target_x": tile.target_x,
                "target_y": tile.target_y,
                "target_width": tile.target_width,
                "target_height": tile.target_height,
                "blend_edges": list(tile.blend_edges),
                "width": tile.width,
                "height": tile.height,
                "source_x": tile.source_x,
                "source_y": tile.source_y,
                "source_width": tile.source_width,
                "source_height": tile.source_height,
            }
            for tile in result.tiles
        ],
    }


def _manifest(job: EnhanceJob) -> dict[str, Any]:
    return dict(job.result_manifest_json or {})


def _manifest_int(manifest: dict[str, Any], key: str) -> int | None:
    value = manifest.get(key)
    if isinstance(value, int) and value > 0:
        return value
    return None


def _attached_image_session_round(
    session: Session,
    *,
    image_session_id: str,
    job_id: str,
) -> ImageSessionRound | None:
    rounds = session.scalars(
        select(ImageSessionRound)
        .options(selectinload(ImageSessionRound.generated_asset), selectinload(ImageSessionRound.resource_group))
        .where(ImageSessionRound.session_id == image_session_id)
        .order_by(ImageSessionRound.created_at.desc(), ImageSessionRound.id.desc())
    ).all()
    for round_item in rounds:
        output = round_item.provider_output_json
        metadata = output.get("_inspiration_one") if isinstance(output, dict) else None
        if isinstance(metadata, dict) and metadata.get("enhance_job_id") == job_id:
            return round_item
        request = round_item.provider_request_json
        request_metadata = request.get("_inspiration_one") if isinstance(request, dict) else None
        if isinstance(request_metadata, dict) and request_metadata.get("enhance_job_id") == job_id:
            return round_item
    return None


def _enhance_generation_config_display(session: Session, generation_config_id: str | None) -> tuple[str, str]:
    if generation_config_id:
        config = session.get(GenerationConfig, generation_config_id)
        if config is not None:
            model_settings = config.model_settings_json if isinstance(config.model_settings_json, dict) else {}
            model = model_settings.get("model")
            model_name = str(model).strip() if isinstance(model, str) and model.strip() else config.name
            return model_name, config.provider_kind
    return "enhance", "enhance"


def _final_dimensions_for_job(job: EnhanceJob) -> tuple[int, int]:
    if job.strategy == EnhanceStrategy.DIRECT:
        return int(job.params_json["target_width"]), int(job.params_json["target_height"])
    if job.strategy == EnhanceStrategy.TILED:
        return job.source_width * int(job.params_json["scale"]), job.source_height * int(job.params_json["scale"])
    raise BusinessValidationError("暂不支持该增强策略")


def _expected_progress_total(
    *,
    strategy: EnhanceStrategy,
    params: dict[str, Any],
    source: LoadedEnhanceSource,
) -> int:
    if strategy == EnhanceStrategy.DIRECT:
        return 1
    scale = int(params["scale"])
    tile_base_size = int(params["tile_base_size"])
    final_width = source.width * scale
    final_height = source.height * scale
    return ((final_width + tile_base_size - 1) // tile_base_size) * (
        (final_height + tile_base_size - 1) // tile_base_size
    )


def _authorized_image_generation_config_selection(
    session: Session,
    *,
    resource_group_id: str | None,
    generation_config_mode: str,
    generation_config_id: str | None,
    actor_user_id: str,
    actor_is_admin: bool,
) -> GenerationConfigSelection:
    normalized_mode = (generation_config_mode or "auto").strip().lower()
    if normalized_mode not in {"auto", "manual"}:
        raise BusinessValidationError("生成配置选择模式无效")
    group = require_generation_resource_group_for_user(
        session,
        user_id=actor_user_id,
        is_admin=actor_is_admin,
        resource_group_id=resource_group_id,
    )
    normalized_id = (generation_config_id or "").strip() or None
    selection = GenerationConfigSelection(
        mode="manual" if normalized_mode == "manual" else "auto",
        generation_config_id=normalized_id if normalized_mode == "manual" else None,
        resource_group_id=group.id,
    )
    if selection.mode == "manual":
        if selection.generation_config_id is None:
            raise BusinessValidationError("手动指定生成配置时必须选择配置")
        generation_config = session.scalar(
            select(GenerationConfig).where(
                GenerationConfig.id == selection.generation_config_id,
                GenerationConfig.archived_at.is_(None),
            )
        )
        if generation_config is None:
            raise BusinessValidationError("生成配置不存在")
        if generation_config.purpose != IMAGE_PURPOSE:
            raise BusinessValidationError("图片增强只能使用图片生成配置")
        if group.id not in generation_config_resource_group_ids(generation_config):
            raise BusinessValidationError("手动指定的生成配置不属于当前供应商生成分组")
    return selection


def _job_generation_config_selection(job: EnhanceJob) -> GenerationConfigSelection:
    return GenerationConfigSelection(
        mode="manual" if job.generation_config_mode == "manual" else "auto",
        generation_config_id=job.requested_generation_config_id if job.generation_config_mode == "manual" else None,
        resource_group_id=job.resource_group_id,
    )


def _loaded_source_from_storage(
    storage: LocalStorage,
    stored_object: object,
    *,
    owner_user_id: str,
    mime_type: str,
) -> LoadedEnhanceSource:
    try:
        content = storage.resolve(storage.object_key_for(stored_object)).read_bytes()
    except (OSError, ValueError) as exc:
        raise BusinessValidationError("资源文件不存在") from exc
    dimensions = image_dimensions_from_bytes(content)
    if dimensions is None:
        raise BusinessValidationError("资源文件不是可解码图片")
    return LoadedEnhanceSource(
        content=content,
        mime_type=mime_type or "image/png",
        width=dimensions[0],
        height=dimensions[1],
        owner_user_id=owner_user_id,
    )


def _positive_int(value: Any, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise BusinessValidationError(f"{label}必须是整数") from exc
    if parsed <= 0:
        raise BusinessValidationError(f"{label}必须大于 0")
    return parsed


def _non_negative_int(value: Any, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise BusinessValidationError(f"{label}必须是整数") from exc
    if parsed < 0:
        raise BusinessValidationError(f"{label}不能小于 0")
    return parsed


def _validate_final_resource_bounds(*, width: int, height: int, byte_count: int) -> None:
    if width <= 0 or height <= 0:
        raise BusinessValidationError("图片尺寸无效")
    if width > ENHANCE_FINAL_MAX_EDGE or height > ENHANCE_FINAL_MAX_EDGE:
        raise BusinessValidationError(f"拼接结果单边不能超过 {ENHANCE_FINAL_MAX_EDGE}")
    if width * height > ENHANCE_FINAL_MAX_PIXELS:
        raise BusinessValidationError(f"拼接结果像素不能超过 {ENHANCE_FINAL_MAX_PIXELS}")
    if byte_count > 0 and byte_count > ENHANCE_FINAL_MAX_UPLOAD_BYTES:
        raise BusinessValidationError("拼接结果文件过大")


def _suppress_storage_errors():
    class _Suppress:
        def __enter__(self) -> None:
            return None

        def __exit__(self, exc_type, exc, traceback) -> bool:
            if exc is not None:
                logger.warning("清理图片增强输入文件失败: %s", exc)
            return True

    return _Suppress()


def enhance_job_final_storage_object(job: EnhanceJob) -> SimpleNamespace:
    final_ref = _manifest(job).get("final_image_ref")
    if not isinstance(final_ref, str) or not final_ref:
        raise BusinessValidationError("拼接结果尚未上传")
    storage = LocalStorage()
    metadata = storage.metadata_for(final_ref)
    return SimpleNamespace(**metadata.as_model_kwargs())
