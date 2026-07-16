from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import dramatiq

from inspiration_one_backend.application.deck_generation_core import execute_deck_slide_generation_task
from inspiration_one_backend.application.enhance.jobs import cleanup_expired_enhance_inputs, execute_enhance_job
from inspiration_one_backend.application.image_sessions import execute_image_session_generation_task
from inspiration_one_backend.application.image_to_code.jobs import execute_image_to_code_job
from inspiration_one_backend.application.inspiration_workflows import (
    execute_inspiration_workflow_node_run,
    execute_inspiration_workflow_run,
)
from inspiration_one_backend.application.storage_variants import (
    STORAGE_VARIANT_MAX_RETRIES,
    STORAGE_VARIANT_RETRY_MAX_BACKOFF_MS,
    STORAGE_VARIANT_RETRY_MIN_BACKOFF_MS,
    STORAGE_VARIANT_WORKER_TIME_LIMIT_MS,
    execute_storage_image_variants,
)
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.durable_generation_tasks import (
    IMAGE_SESSION_GENERATION_TASK_CONTRACT,
    WORKFLOW_RUN_GENERATION_TASK_CONTRACT,
    assert_actor_uses_durable_generation_contract,
)
from inspiration_one_backend.infrastructure.logging import (
    cleanup_old_logs,
    configure_logging,
    reset_image_session_generation_task_id,
    reset_workflow_node_run_id,
    reset_workflow_run_id,
    set_image_session_generation_task_id,
    set_workflow_node_run_id,
    set_workflow_run_id,
)
from inspiration_one_backend.infrastructure.queue import (
    get_broker,
    recover_unfinished_deck_slides,
    recover_unfinished_enhance_jobs,
    recover_unfinished_image_session_generation_tasks,
    recover_unfinished_image_to_code_jobs,
    recover_unfinished_workflow_runs,
)
from inspiration_one_backend.infrastructure.storage import (
    InvalidStorageObjectKey,
    StorageObjectNotFound,
    StorageObjectTooLarge,
    StorageUnavailable,
)

configure_logging()
get_broker()

logger = logging.getLogger(__name__)


def get_image_session_worker_failsafe_time_limit_ms() -> int:
    return int(get_runtime_settings().image_session_worker_failsafe_time_limit_minutes) * 60 * 1000


def get_inspiration_workflow_worker_failsafe_time_limit_ms() -> int:
    return get_image_session_worker_failsafe_time_limit_ms()


IMAGE_SESSION_WORKER_FAILSAFE_TIME_LIMIT_MS = get_image_session_worker_failsafe_time_limit_ms()
INSPIRATION_WORKFLOW_WORKER_FAILSAFE_TIME_LIMIT_MS = get_inspiration_workflow_worker_failsafe_time_limit_ms()


@dramatiq.actor(max_retries=0, time_limit=INSPIRATION_WORKFLOW_WORKER_FAILSAFE_TIME_LIMIT_MS)
def run_inspiration_workflow_run(workflow_run_id: str) -> None:
    """灵感产物工作流 scheduler：发现 ready 节点并派发独立节点任务。"""
    token = set_workflow_run_id(workflow_run_id)
    try:
        execute_inspiration_workflow_run(workflow_run_id)
    finally:
        reset_workflow_run_id(token)


@dramatiq.actor(max_retries=0, time_limit=INSPIRATION_WORKFLOW_WORKER_FAILSAFE_TIME_LIMIT_MS)
def run_inspiration_workflow_node_run(workflow_node_run_id: str) -> None:
    """灵感产物工作流节点 worker：执行单个 WorkflowNodeRun，完成后唤醒 scheduler。"""
    token = set_workflow_node_run_id(workflow_node_run_id)
    try:
        execute_inspiration_workflow_node_run(workflow_node_run_id)
    finally:
        reset_workflow_node_run_id(token)


@dramatiq.actor(max_retries=0, time_limit=IMAGE_SESSION_WORKER_FAILSAFE_TIME_LIMIT_MS)
def run_image_session_generation_task(task_id: str) -> None:
    """连续生图 worker：执行失败落库为通用安全错误。"""
    token = set_image_session_generation_task_id(task_id)
    try:
        execute_image_session_generation_task(task_id)
    finally:
        reset_image_session_generation_task_id(token)


@dramatiq.actor(max_retries=0, time_limit=IMAGE_SESSION_WORKER_FAILSAFE_TIME_LIMIT_MS)
def run_deck_slide_generation_task(slide_id: str) -> None:
    """演示文稿单页 worker：执行失败落库为该页 FAILED + 错误原因。"""
    execute_deck_slide_generation_task(slide_id)


@dramatiq.actor(max_retries=0, time_limit=IMAGE_SESSION_WORKER_FAILSAFE_TIME_LIMIT_MS)
def run_enhance_job(job_id: str) -> None:
    """图片增强 worker：执行 Direct/Tiled 增强任务并回写 durable 状态。"""
    execute_enhance_job(job_id)


@dramatiq.actor(max_retries=0, time_limit=IMAGE_SESSION_WORKER_FAILSAFE_TIME_LIMIT_MS)
def run_image_to_code_job(job_id: str) -> None:
    """图片转代码 worker：执行分析、静态网页产出和 Figma 导出。"""
    execute_image_to_code_job(job_id)


@dramatiq.actor(
    max_retries=STORAGE_VARIANT_MAX_RETRIES,
    min_backoff=STORAGE_VARIANT_RETRY_MIN_BACKOFF_MS,
    max_backoff=STORAGE_VARIANT_RETRY_MAX_BACKOFF_MS,
    time_limit=STORAGE_VARIANT_WORKER_TIME_LIMIT_MS,
)
def run_storage_image_variants(object_key: str) -> None:
    """为已持久化原图幂等生成 preview/thumbnail。"""
    try:
        execute_storage_image_variants(object_key)
    except StorageObjectNotFound:
        logger.info("图片变体原图不存在，停止重试: object_key=%s", object_key)
    except InvalidStorageObjectKey:
        logger.warning("图片变体对象 key 无效，停止重试: object_key=%s", object_key)
    except StorageObjectTooLarge:
        logger.warning("图片变体原图超过读取上限，停止重试: object_key=%s", object_key)
    except ValueError:
        logger.warning("图片变体原图不可解码，停止重试: object_key=%s", object_key)
    except StorageUnavailable:
        logger.warning("图片变体存储暂不可用，交由有限重试: object_key=%s", object_key)
        raise


assert_actor_uses_durable_generation_contract(WORKFLOW_RUN_GENERATION_TASK_CONTRACT, run_inspiration_workflow_run)
assert_actor_uses_durable_generation_contract(
    IMAGE_SESSION_GENERATION_TASK_CONTRACT,
    run_image_session_generation_task,
)


def _running_under_dramatiq_cli() -> bool:
    return any(Path(arg).name == "dramatiq" for arg in sys.argv)


if _running_under_dramatiq_cli():
    cleanup_old_logs()
    workflow_recovery = recover_unfinished_workflow_runs(reset_stale_running=True)
    image_session_recovery = recover_unfinished_image_session_generation_tasks(reset_stale_running=True)
    deck_recovery = recover_unfinished_deck_slides(reset_stale_running=True)
    enhance_recovered = recover_unfinished_enhance_jobs(reset_stale_running=True)
    image_to_code_recovered = recover_unfinished_image_to_code_jobs(reset_stale_running=True)
    cleanup_expired_enhance_inputs()
    logger.info(
        "Dramatiq worker启动完成: pid=%s image_session_actor=%s workflow_actor=%s "
        "workflow_recovery_enqueued=%s image_session_recovery_enqueued=%s deck_recovery_enqueued=%s "
        "enhance_recovery_enqueued=%s image_to_code_recovery_enqueued=%s",
        os.getpid(),
        run_image_session_generation_task.actor_name,
        run_inspiration_workflow_run.actor_name,
        workflow_recovery.enqueued_runs,
        image_session_recovery.enqueued_tasks,
        deck_recovery.enqueued_slides,
        enhance_recovered,
        image_to_code_recovered,
    )
