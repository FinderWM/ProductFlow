from __future__ import annotations

from enum import StrEnum


class SourceAssetKind(StrEnum):
    """灵感产物素材类型：原始主图 / 参考图 / 处理后灵感产物图。"""

    ORIGINAL_IMAGE = "original_image"
    REFERENCE_IMAGE = "reference_image"
    PROCESSED_INSPIRATION_IMAGE = "processed_inspiration_image"
    CONTEXT_IMAGE = "context_image"
    CONTEXT_DOCUMENT = "context_document"


class ImageSessionAssetKind(StrEnum):
    """生图会话附件：用户上传参考图 / AI 生成图。"""

    REFERENCE_UPLOAD = "reference_upload"
    GENERATED_IMAGE = "generated_image"


class ResourceLibraryAssetKind(StrEnum):
    """个人资源库文件类型。本期只允许图片，保留扩展到文档/其它文件的契约。"""

    IMAGE = "image"
    DOCUMENT = "document"
    OTHER = "other"


class ResourceLibrarySourceType(StrEnum):
    """个人资源库资源来源。"""

    SOURCE_ASSET = "source_asset"
    POSTER_VARIANT = "poster_variant"
    IMAGE_SESSION_ASSET = "image_session_asset"
    DECK_SLIDE = "deck_slide"
    ENHANCE_JOB_RESULT = "enhance_job_result"
    UPLOAD = "upload"


class EnhanceStrategy(StrEnum):
    """图片增强策略：直接增强 / 分块增强。"""

    DIRECT = "direct"
    TILED = "tiled"


class EnhanceSourceKind(StrEnum):
    """图片增强输入来源。"""

    RESOURCE_LIBRARY_ASSET = "resource_library_asset"
    SOURCE_ASSET = "source_asset"
    IMAGE_SESSION_ASSET = "image_session_asset"
    ENHANCE_INPUT_BLOB = "enhance_input_blob"


class JobStatus(StrEnum):
    """连续生图任务状态：排队 -> 运行中 -> 成功/失败/取消。"""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CopyStatus(StrEnum):
    """文案状态：草稿(可编辑) / 已确认(锁定用于海报)。"""

    DRAFT = "draft"
    CONFIRMED = "confirmed"


class PosterKind(StrEnum):
    """海报品种：灵感产物主图 / 促销海报。"""

    MAIN_IMAGE = "main_image"
    PROMO_POSTER = "promo_poster"


class InspirationWorkflowState(StrEnum):
    """灵感产物流程推导状态：素材/文案/海报/失败。"""

    DRAFT = "draft"
    COPY_READY = "copy_ready"
    POSTER_READY = "poster_ready"
    FAILED = "failed"


class WorkflowNodeType(StrEnum):
    """灵感产物工作流节点类型。"""

    INSPIRATION_CONTEXT = "inspiration_context"
    REFERENCE_IMAGE = "reference_image"
    COPY_GENERATION = "copy_generation"
    IMAGE_GENERATION = "image_generation"
    TAIL_SPLITTER = "tail_splitter"
    DECK_GENERATION = "deck_generation"


class WorkflowNodeStatus(StrEnum):
    """工作流节点运行状态。"""

    IDLE = "idle"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class WorkflowRunStatus(StrEnum):
    """工作流运行记录状态。"""

    RUNNING = "running"
    WAITING_CONFIRMATION = "waiting_confirmation"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class DeckStatus(StrEnum):
    """演示文稿(deck)状态：草稿 -> 大纲确认 -> 风格确认 -> 生成中 -> 完成/失败。"""

    DRAFT = "draft"
    OUTLINE_CONFIRMED = "outline_confirmed"
    STYLE_CONFIRMED = "style_confirmed"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class DeckSlideStatus(StrEnum):
    """单页幻灯片生成状态：待生成 -> 排队 -> 运行中 -> 完成/失败。"""

    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class DeckMaterialSource(StrEnum):
    """单页配图来源：资源库 / 上传 / 灵感源图 / 编辑增强生成结果。"""

    RESOURCE_LIBRARY = "resource_library"
    UPLOAD = "upload"
    SOURCE_ASSET = "source_asset"
    ENHANCED = "enhanced"
