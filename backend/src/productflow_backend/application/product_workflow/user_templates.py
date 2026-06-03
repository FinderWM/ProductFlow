from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import inspect, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from productflow_backend.application.canvas_templates import (
    CanvasTemplate,
    CanvasTemplateEdgeSpec,
    CanvasTemplateEntryMode,
    CanvasTemplateNodeSpec,
    CanvasTemplateScenario,
    CanvasTemplateScenarioMetadata,
    TemplateKind,
    list_builtin_canvas_templates,
)
from productflow_backend.application.copy_payloads import normalize_copy_node_config
from productflow_backend.application.image_generation_core import normalize_image_generation_tool_options
from productflow_backend.application.moderation import (
    ensure_resource_usable,
    moderation_state_for_resource,
)
from productflow_backend.application.ownership import (
    ensure_actor_can_mutate_owner,
    require_active_user_id,
    resolve_owner_user_id,
)
from productflow_backend.application.product_workflow import graph as product_workflow_graph
from productflow_backend.application.product_workflow.context import (
    image_size_from_config,
    normalize_product_context_config,
)
from productflow_backend.application.time import now_utc
from productflow_backend.domain.enums import WorkflowNodeType
from productflow_backend.domain.errors import BusinessValidationError, NotFoundError
from productflow_backend.infrastructure.db.models import (
    CanvasTemplate as DbCanvasTemplate,
)
from productflow_backend.infrastructure.db.models import (
    CanvasTemplateCategory,
    UserCanvasTemplate,
    WorkflowEdge,
    WorkflowNode,
    new_id,
)
from productflow_backend.infrastructure.db.session import get_engine, get_session_factory

USER_TEMPLATE_KEY_PREFIX = "user:"
USER_TEMPLATE_SCHEMA_VERSION = 1
USER_TEMPLATE_SCENARIO = CanvasTemplateScenario.MAIN_IMAGE
LEGACY_BUILTIN_TEMPLATE_CATEGORY_NAME = "电商场景"
BUILTIN_TEMPLATE_CATEGORIES_BY_STAGE: dict[str, tuple[str, str, int]] = {
    "listing": ("00000000-0000-0000-0000-000000000021", "平台首图", 10),
    "detail": ("00000000-0000-0000-0000-000000000022", "详情说服", 20),
    "gallery": ("00000000-0000-0000-0000-000000000023", "场景图册", 30),
    "content": ("00000000-0000-0000-0000-000000000024", "内容种草", 40),
    "campaign": ("00000000-0000-0000-0000-000000000025", "活动投放", 50),
}
TemplateScope = Literal["global", "user"]
InitialWorkflowEntry = Literal["image", "copy", "tail", "blank"]
TemplateReviewStatus = Literal["none", "pending", "approved", "rejected"]

ARTIFACT_SPECIFIC_CONFIG_KEYS = frozenset(
    {
        "copy_set_id",
        "creative_brief_id",
        "download_url",
        "filled_reference_node_ids",
        "filled_source_asset_ids",
        "generated_poster_variant_ids",
        "image_session_asset_id",
        "image_session_asset_ids",
        "node_id",
        "poster_variant_id",
        "poster_variant_ids",
        "preview_url",
        "product_id",
        "source_asset_id",
        "source_asset_ids",
        "source_poster_variant_id",
        "storage_path",
        "thumbnail_url",
        "workflow_id",
    }
)
SYSTEM_TEMPLATE_CONFIG_KEYS = frozenset({"_canvas_template"})
REUSABLE_SUFFIX_CONFIG_KEYS = frozenset({"generation_config_id"})

ARTIFACT_SPECIFIC_KEY_SUFFIXES = ("_id", "_ids", "_url", "_path")
PROMPT_TEXT_CONFIG_KEYS = frozenset({"instruction", "prompt", "source_note"})
PRODUCT_CONTEXT_TEMPLATE_ASSET_CONFIG_KEYS = frozenset(
    {
        "document_source_asset_id",
        "image_source_asset_id",
        "source_asset_id",
        "source_asset_ids",
    }
)
PRODUCT_CONTEXT_TEMPLATE_RUNTIME_CONFIG_KEYS = frozenset({"owner_id", "entry_type", "category", "price"})


class UserCanvasTemplateNodePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    node_type: WorkflowNodeType
    title: str
    position_x: int = 0
    position_y: int = 0
    config_json: dict[str, Any] = Field(default_factory=dict)

    @field_validator("config_json")
    @classmethod
    def validate_config_json(cls, value: dict[str, Any]) -> dict[str, Any]:
        return dict(value)


class UserCanvasTemplateEdgePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    source_node_key: str
    target_node_key: str
    source_handle: str | None = "output"
    target_handle: str | None = "input"


class UserCanvasTemplatePayload(BaseModel):
    model_config = ConfigDict(frozen=True)

    version: int = USER_TEMPLATE_SCHEMA_VERSION
    kind: str = "node_group"
    nodes: tuple[UserCanvasTemplateNodePayload, ...]
    edges: tuple[UserCanvasTemplateEdgePayload, ...] = ()


def canvas_template_tables_available() -> bool:
    inspector = inspect(get_engine())
    return all(
        inspector.has_table(table_name)
        for table_name in ("canvas_templates", "canvas_template_categories")
    )


def ensure_canvas_templates_bootstrapped(session: Session | None = None) -> None:
    if session is None:
        factory = get_session_factory()
        with factory() as owned_session:
            ensure_canvas_templates_bootstrapped(owned_session)
        return

    _seed_builtin_canvas_templates(session)
    _migrate_legacy_user_canvas_templates(session)
    session.commit()


def canvas_template_row_to_canvas_template(row: DbCanvasTemplate) -> CanvasTemplate:
    template = _parse_db_template_payload(row)
    category = row.category
    owner = row.owner
    state = moderation_state_for_resource(row)
    return CanvasTemplate(
        key=row.key,
        template_id=row.id,
        version=row.schema_version,
        kind=_template_kind(row.kind),
        entry_mode=_template_entry_mode(row.entry_mode),
        sort_order=row.sort_order,
        title=row.title,
        description=row.description or "",
        source="user" if row.scope == "user" else "builtin",
        user_template_id=row.id if row.scope == "user" else None,
        scope=_template_scope(row.scope),
        category_id=row.category_id,
        category_name=category.name if category is not None else None,
        owner_user_id=row.owner_user_id,
        owner_username=owner.username if owner is not None else None,
        enabled=row.enabled,
        effective_enabled=state.effective_enabled,
        disabled_reason=row.disabled_reason,
        review_status=_template_review_status(row.review_status),
        review_note=row.review_note,
        review_submitted_at=row.review_submitted_at.isoformat() if row.review_submitted_at is not None else None,
        reviewed_at=row.reviewed_at.isoformat() if row.reviewed_at is not None else None,
        reviewed_by_user_id=row.reviewed_by_user_id,
        reviewed_by_username=row.reviewed_by.username if row.reviewed_by is not None else None,
        scenario=template.scenario,
        nodes=template.nodes,
        edges=template.edges,
        prompt_seeds=template.prompt_seeds,
        instruction_seeds=template.instruction_seeds,
        output_slots=template.output_slots,
        reference_input_hints=template.reference_input_hints,
        suggested_connections=template.suggested_connections,
        default_external_connections=template.default_external_connections,
    )


def user_canvas_template_to_canvas_template(row: UserCanvasTemplate) -> CanvasTemplate:
    return _legacy_user_canvas_template_to_canvas_template(row)


def list_canvas_templates(
    session: Session,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = True,
    search: str | None = None,
    category_id: str | None = None,
    scope: str | None = None,
    initial_workflow_entry: str | None = None,
) -> list[CanvasTemplate]:
    return _list_canvas_templates(
        session,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        search=search,
        category_id=category_id,
        scope=scope,
        initial_workflow_entry=initial_workflow_entry,
        management=False,
    )


def list_canvas_templates_for_management(
    session: Session,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = True,
    search: str | None = None,
    category_id: str | None = None,
    scope: str | None = None,
    initial_workflow_entry: str | None = None,
) -> list[CanvasTemplate]:
    return _list_canvas_templates(
        session,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        search=search,
        category_id=category_id,
        scope=scope,
        initial_workflow_entry=initial_workflow_entry,
        management=True,
    )


def _list_canvas_templates(
    session: Session,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
    search: str | None,
    category_id: str | None,
    scope: str | None,
    initial_workflow_entry: str | None,
    management: bool,
) -> list[CanvasTemplate]:
    ensure_canvas_templates_bootstrapped(session)
    normalized_scope = _normalize_optional_scope(scope)
    normalized_entry = _normalize_optional_initial_workflow_entry(initial_workflow_entry)
    stmt = _canvas_template_query().where(DbCanvasTemplate.archived_at.is_(None))
    if normalized_scope is not None:
        stmt = stmt.where(DbCanvasTemplate.scope == normalized_scope)
    if normalized_entry == "blank":
        stmt = stmt.where(DbCanvasTemplate.entry_mode.in_(("image", "copy", "tail")))
    elif normalized_entry is not None:
        stmt = stmt.where(DbCanvasTemplate.entry_mode == normalized_entry)
    if category_id:
        stmt = stmt.where(DbCanvasTemplate.category_id == category_id)
    normalized_search = _normalize_search(search)
    if normalized_search:
        pattern = f"%{normalized_search.lower()}%"
        stmt = stmt.where(
            or_(
                DbCanvasTemplate.key.ilike(pattern),
                DbCanvasTemplate.title.ilike(pattern),
                DbCanvasTemplate.description.ilike(pattern),
            )
        )
    if not actor_is_admin or not management:
        stmt = stmt.where(
            or_(
                DbCanvasTemplate.scope == "global",
                DbCanvasTemplate.owner_user_id == actor_user_id,
            )
        )
    rows = session.scalars(
        stmt.order_by(
            DbCanvasTemplate.entry_mode,
            DbCanvasTemplate.scope,
            DbCanvasTemplate.sort_order,
            DbCanvasTemplate.title,
            DbCanvasTemplate.created_at,
        )
    ).all()
    return [
        canvas_template_row_to_canvas_template(row)
        for row in rows
        if _template_visible_to_actor(
            row,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            management=management,
        )
    ]


def get_canvas_template(
    session: Session,
    template_key: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    require_usable: bool = True,
) -> CanvasTemplate:
    ensure_canvas_templates_bootstrapped(session)
    key = template_key.strip()
    row = session.scalar(
        _canvas_template_query().where(
            DbCanvasTemplate.key == key,
            DbCanvasTemplate.archived_at.is_(None),
        )
    )
    if row is None or not _template_visible_to_actor(
        row,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        management=not require_usable,
    ):
        raise BusinessValidationError("画布模板不存在")
    if require_usable:
        ensure_resource_usable(row)
    return canvas_template_row_to_canvas_template(row)


def list_canvas_template_categories(
    session: Session,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = True,
    search: str | None = None,
    scope: str | None = None,
) -> list[CanvasTemplateCategory]:
    return _list_canvas_template_categories(
        session,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        search=search,
        scope=scope,
        management=False,
    )


def list_canvas_template_categories_for_management(
    session: Session,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = True,
    search: str | None = None,
    scope: str | None = None,
) -> list[CanvasTemplateCategory]:
    return _list_canvas_template_categories(
        session,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        search=search,
        scope=scope,
        management=True,
    )


def _list_canvas_template_categories(
    session: Session,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
    search: str | None,
    scope: str | None,
    management: bool,
) -> list[CanvasTemplateCategory]:
    ensure_canvas_templates_bootstrapped(session)
    normalized_scope = _normalize_optional_scope(scope)
    stmt = _canvas_template_category_query().where(CanvasTemplateCategory.archived_at.is_(None))
    if normalized_scope is not None:
        stmt = stmt.where(CanvasTemplateCategory.scope == normalized_scope)
    normalized_search = _normalize_search(search)
    if normalized_search:
        stmt = stmt.where(CanvasTemplateCategory.name.ilike(f"%{normalized_search.lower()}%"))
    if not actor_is_admin or not management:
        stmt = stmt.where(
            or_(
                CanvasTemplateCategory.scope == "global",
                CanvasTemplateCategory.owner_user_id == actor_user_id,
            )
        )
    rows = session.scalars(
        stmt.order_by(CanvasTemplateCategory.scope, CanvasTemplateCategory.sort_order, CanvasTemplateCategory.name)
    ).all()
    return [
        row
        for row in rows
        if _category_visible_to_actor(
            row,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            management=management,
        )
    ]


def create_canvas_template_category(
    session: Session,
    *,
    scope: TemplateScope,
    name: str,
    sort_order: int = 100,
    actor_user_id: str | None,
) -> CanvasTemplateCategory:
    ensure_canvas_templates_bootstrapped(session)
    normalized_scope = _normalize_scope(scope)
    owner_user_id = (
        require_active_user_id(session, actor_user_id or "", missing_message="用户画布模板分类缺少 owner_user_id")
        if normalized_scope == "user"
        else None
    )
    category = CanvasTemplateCategory(
        id=new_id(),
        scope=normalized_scope,
        owner_user_id=owner_user_id,
        name=_normalize_category_name(name),
        sort_order=sort_order,
    )
    session.add(category)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise BusinessValidationError("画布模板分类已存在") from exc
    session.expire_all()
    return _get_canvas_template_category_or_raise(session, category.id)


def update_canvas_template_category(
    session: Session,
    *,
    category_id: str,
    actor_user_id: str | None,
    actor_is_admin: bool,
    expected_scope: TemplateScope | None = None,
    name: str | None = None,
    sort_order: int | None = None,
) -> CanvasTemplateCategory:
    category = _get_canvas_template_category_or_raise(session, category_id)
    _ensure_category_scope(category, expected_scope)
    _ensure_category_mutable(category, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if name is not None:
        category.name = _normalize_category_name(name)
    if sort_order is not None:
        category.sort_order = sort_order
    category.updated_at = now_utc()
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise BusinessValidationError("画布模板分类已存在") from exc
    session.expire_all()
    return _get_canvas_template_category_or_raise(session, category_id)


def archive_canvas_template_category(
    session: Session,
    *,
    category_id: str,
    actor_user_id: str | None,
    actor_is_admin: bool,
    expected_scope: TemplateScope | None = None,
) -> None:
    category = _get_canvas_template_category_or_raise(session, category_id)
    _ensure_category_scope(category, expected_scope)
    _ensure_category_mutable(category, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if category.archived_at is None:
        category.archived_at = now_utc()
        category.updated_at = category.archived_at
        session.commit()


def restore_canvas_template_category(
    session: Session,
    *,
    category_id: str,
    actor_user_id: str | None,
    actor_is_admin: bool,
    expected_scope: TemplateScope | None = None,
) -> CanvasTemplateCategory:
    category = _get_canvas_template_category_or_raise(session, category_id, include_archived=True)
    _ensure_category_scope(category, expected_scope)
    _ensure_category_mutable(category, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    category.archived_at = None
    category.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_canvas_template_category_or_raise(session, category_id)


def create_global_canvas_template(
    session: Session,
    *,
    key: str,
    title: str,
    description: str | None,
    kind: TemplateKind,
    entry_mode: CanvasTemplateEntryMode = "image",
    sort_order: int = 100,
    template_json: dict[str, Any],
    category_id: str | None = None,
    enabled: bool = True,
) -> DbCanvasTemplate:
    ensure_canvas_templates_bootstrapped(session)
    clean_key = _normalize_template_key(key)
    clean_title = _normalize_template_title(title)
    _validate_template_category(session, scope="global", owner_user_id=None, category_id=category_id)
    template = _global_template_contract(
        key=clean_key,
        title=clean_title,
        description=description,
        kind=kind,
        entry_mode=entry_mode,
        sort_order=sort_order,
        template_json=template_json,
    )
    row = DbCanvasTemplate(
        id=new_id(),
        key=clean_key,
        scope="global",
        owner_user_id=None,
        category_id=category_id,
        title=clean_title,
        description=(description or "").strip() or None,
        kind=kind,
        entry_mode=entry_mode,
        sort_order=sort_order,
        enabled=enabled,
        schema_version=template.version,
        template_json=template.model_dump(mode="json"),
    )
    session.add(row)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise BusinessValidationError("画布模板 key 已存在") from exc
    session.expire_all()
    return _get_global_canvas_template_or_raise(session, row.id)


def update_global_canvas_template(
    session: Session,
    *,
    template_id: str,
    title: str | None = None,
    description: str | None = None,
    kind: TemplateKind | None = None,
    entry_mode: CanvasTemplateEntryMode | None = None,
    sort_order: int | None = None,
    template_json: dict[str, Any] | None = None,
    category_id: str | None = None,
    enabled: bool | None = None,
    disabled_reason: str | None = None,
    actor_user_id: str | None = None,
) -> DbCanvasTemplate:
    row = _get_global_canvas_template_or_raise(session, template_id)
    next_title = _normalize_template_title(title) if title is not None else row.title
    next_description = (description or "").strip() if description is not None else row.description
    next_kind = kind or _template_kind(row.kind)
    next_entry_mode = entry_mode or _template_entry_mode(row.entry_mode)
    next_sort_order = sort_order if sort_order is not None else row.sort_order
    next_template_json = template_json if template_json is not None else dict(row.template_json or {})
    if category_id is not None:
        _validate_template_category(session, scope="global", owner_user_id=None, category_id=category_id)
        row.category_id = category_id
    template = _global_template_contract(
        key=row.key,
        title=next_title,
        description=next_description,
        kind=next_kind,
        entry_mode=next_entry_mode,
        sort_order=next_sort_order,
        template_json=next_template_json,
    )
    row.title = next_title
    row.description = next_description or None
    row.kind = next_kind
    row.entry_mode = next_entry_mode
    row.sort_order = next_sort_order
    if enabled is not None:
        _set_template_enabled(row, enabled=enabled, actor_user_id=actor_user_id, disabled_reason=disabled_reason)
    row.schema_version = template.version
    row.template_json = template.model_dump(mode="json")
    row.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_global_canvas_template_or_raise(session, template_id)


def archive_global_canvas_template(session: Session, *, template_id: str) -> None:
    row = _get_global_canvas_template_or_raise(session, template_id)
    if row.archived_at is None:
        row.archived_at = now_utc()
        row.updated_at = row.archived_at
        session.commit()


def restore_global_canvas_template(session: Session, *, template_id: str) -> DbCanvasTemplate:
    row = _get_global_canvas_template_or_raise(session, template_id, include_archived=True)
    row.archived_at = None
    row.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_global_canvas_template_or_raise(session, template_id)


def create_user_canvas_template_from_workflow_nodes(
    session: Session,
    *,
    product_id: str,
    owner_user_id: str,
    title: str,
    description: str | None,
    node_ids: list[str],
    category_id: str | None = None,
) -> DbCanvasTemplate:
    ensure_canvas_templates_bootstrapped(session)
    resolved_owner_user_id = require_active_user_id(session, owner_user_id, missing_message="用户模板归属账号不存在")
    clean_title = title.strip()
    if not clean_title:
        raise BusinessValidationError("模板名称不能为空")
    if not node_ids:
        raise BusinessValidationError("请选择要保存的节点")
    if len(set(node_ids)) != len(node_ids):
        raise BusinessValidationError("保存模板的节点不能重复")

    workflow = product_workflow_graph.get_active_workflow(session, product_id)
    if workflow is None:
        product_workflow_graph.get_product_or_raise(session, product_id)
        raise BusinessValidationError("需要先创建或打开画布后才能保存模板")

    workflow_nodes_by_id = {node.id: node for node in workflow.nodes}
    unknown_node_ids = [node_id for node_id in node_ids if node_id not in workflow_nodes_by_id]
    if unknown_node_ids:
        raise BusinessValidationError("保存模板包含不属于当前画布的节点")

    selected_nodes = [workflow_nodes_by_id[node_id] for node_id in node_ids]
    if any(node.node_type == WorkflowNodeType.PRODUCT_CONTEXT for node in selected_nodes):
        raise BusinessValidationError("节点组模板不能包含商品资料节点")
    _validate_template_category(
        session,
        scope="user",
        owner_user_id=resolved_owner_user_id,
        category_id=category_id,
    )

    min_x = min(node.position_x for node in selected_nodes)
    min_y = min(node.position_y for node in selected_nodes)
    node_keys_by_id = {node.id: f"node_{index + 1}" for index, node in enumerate(selected_nodes)}
    payload = UserCanvasTemplatePayload(
        nodes=tuple(
            UserCanvasTemplateNodePayload(
                key=node_keys_by_id[node.id],
                node_type=node.node_type,
                title=node.title,
                position_x=node.position_x - min_x,
                position_y=node.position_y - min_y,
                config_json=extract_reusable_node_config(node),
            )
            for node in selected_nodes
        ),
        edges=tuple(_selected_internal_edges(workflow.edges, node_keys_by_id)),
    )
    template_id = new_id()
    template_key = f"{USER_TEMPLATE_KEY_PREFIX}{template_id}"
    canvas_template = _user_payload_to_canvas_template(
        payload,
        template_id=template_id,
        key=template_key,
        title=clean_title,
        description=(description or "").strip() or None,
        owner_user_id=resolved_owner_user_id,
        entry_mode="image",
    )
    template = DbCanvasTemplate(
        id=template_id,
        key=template_key,
        scope="user",
        owner_user_id=resolved_owner_user_id,
        category_id=category_id,
        title=clean_title,
        description=(description or "").strip() or None,
        kind="node_group",
        entry_mode="image",
        schema_version=USER_TEMPLATE_SCHEMA_VERSION,
        template_json=canvas_template.model_dump(mode="json"),
    )
    session.add(template)
    _upsert_legacy_user_template_mirror(session, template, payload)
    session.flush()

    canvas_template_row_to_canvas_template(template)
    session.commit()
    session.expire_all()
    return _get_user_template_or_raise(session, template.id)


def create_user_canvas_template_from_active_workflow(
    session: Session,
    *,
    product_id: str,
    owner_user_id: str,
    title: str,
    description: str | None,
    category_id: str,
    retain_prompt_text: bool,
    sort_order: int = 100,
) -> DbCanvasTemplate:
    ensure_canvas_templates_bootstrapped(session)
    resolved_owner_user_id = require_active_user_id(session, owner_user_id, missing_message="用户模板归属账号不存在")
    clean_title = _normalize_template_title(title)
    _validate_template_category(
        session,
        scope="user",
        owner_user_id=resolved_owner_user_id,
        category_id=category_id,
    )
    workflow = product_workflow_graph.get_active_workflow(session, product_id)
    if workflow is None:
        product_workflow_graph.get_product_or_raise(session, product_id)
        raise BusinessValidationError("需要先创建或打开画布后才能保存模板")
    entry_mode = _workflow_template_entry_mode(workflow.initial_entry_mode)
    selected_nodes = _full_canvas_template_nodes(workflow)
    node_keys_by_id = {node.id: f"node_{index + 1}" for index, node in enumerate(selected_nodes)}
    payload = UserCanvasTemplatePayload(
        kind="full_canvas",
        nodes=tuple(
            UserCanvasTemplateNodePayload(
                key=node_keys_by_id[node.id],
                node_type=node.node_type,
                title=node.title,
                position_x=node.position_x,
                position_y=node.position_y,
                config_json=extract_reusable_node_config(node, retain_prompt_text=retain_prompt_text),
            )
            for node in selected_nodes
        ),
        edges=tuple(_selected_internal_edges(workflow.edges, node_keys_by_id)),
    )
    template_id = new_id()
    template_key = f"{USER_TEMPLATE_KEY_PREFIX}{template_id}"
    canvas_template = _user_payload_to_canvas_template(
        payload,
        template_id=template_id,
        key=template_key,
        title=clean_title,
        description=(description or "").strip() or None,
        owner_user_id=resolved_owner_user_id,
        entry_mode=entry_mode,
        sort_order=sort_order,
    )
    template = DbCanvasTemplate(
        id=template_id,
        key=template_key,
        scope="user",
        owner_user_id=resolved_owner_user_id,
        category_id=category_id,
        title=clean_title,
        description=(description or "").strip() or None,
        kind="full_canvas",
        entry_mode=entry_mode,
        sort_order=sort_order,
        schema_version=USER_TEMPLATE_SCHEMA_VERSION,
        template_json=canvas_template.model_dump(mode="json"),
    )
    session.add(template)
    session.flush()
    canvas_template_row_to_canvas_template(template)
    session.commit()
    session.expire_all()
    return _get_user_template_or_raise(session, template.id)


def copy_user_canvas_template_to_global(
    session: Session,
    *,
    template_id: str,
    category_id: str,
    title: str | None = None,
    description: str | None = None,
    sort_order: int | None = None,
) -> DbCanvasTemplate:
    ensure_canvas_templates_bootstrapped(session)
    _validate_template_category(session, scope="global", owner_user_id=None, category_id=category_id)
    source = _get_user_template_or_raise(session, template_id)
    source_template = canvas_template_row_to_canvas_template(source)
    next_title = _normalize_template_title(title) if title is not None else source.title
    next_description = (description or "").strip() if description is not None else source.description
    copied_id = new_id()
    copied_key = f"global:{copied_id}"
    global_template = source_template.model_copy(
        update={
            "key": copied_key,
            "template_id": copied_id,
            "title": next_title,
            "description": next_description or "",
            "source": "builtin",
            "user_template_id": None,
            "scope": "global",
            "category_id": category_id,
            "category_name": None,
            "owner_user_id": None,
            "owner_username": None,
            "sort_order": sort_order if sort_order is not None else source.sort_order,
            "enabled": True,
            "effective_enabled": True,
            "disabled_reason": None,
        }
    )
    row = DbCanvasTemplate(
        id=copied_id,
        key=copied_key,
        scope="global",
        owner_user_id=None,
        category_id=category_id,
        title=next_title,
        description=next_description or None,
        kind=source.kind,
        entry_mode=source.entry_mode,
        sort_order=sort_order if sort_order is not None else source.sort_order,
        schema_version=source.schema_version,
        template_json=global_template.model_dump(mode="json"),
    )
    session.add(row)
    session.commit()
    session.expire_all()
    return _get_global_canvas_template_or_raise(session, copied_id)


def rename_user_canvas_template(
    session: Session,
    *,
    template_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    title: str | None,
    description: str | None,
    category_id: str | None = None,
    sort_order: int | None = None,
    enabled: bool | None = None,
    disabled_reason: str | None = None,
    review_note: str | None = None,
) -> DbCanvasTemplate:
    template = _get_user_template_or_raise(session, template_id)
    if template.archived_at is not None:
        raise NotFoundError("用户模板不存在")
    _ensure_user_template_mutable(template, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if title is not None:
        clean_title = title.strip()
        if not clean_title:
            raise BusinessValidationError("模板名称不能为空")
        template.title = clean_title
    if description is not None:
        template.description = description.strip() or None
    if category_id is not None:
        _validate_template_category(
            session,
            scope="user",
            owner_user_id=template.owner_user_id,
            category_id=category_id,
        )
        template.category_id = category_id
    if sort_order is not None:
        template.sort_order = sort_order
    if enabled is not None and actor_is_admin:
        _set_template_enabled(template, enabled=enabled, actor_user_id=actor_user_id, disabled_reason=disabled_reason)
    elif enabled is not None and enabled != template.enabled:
        raise BusinessValidationError("用户不能直接修改模板可用状态")
    if _owner_edit_requires_review(template, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin):
        note = _normalize_review_note(review_note)
        if note is None:
            raise BusinessValidationError("模板被禁用后修改需要填写修改说明")
        template.review_status = "pending"
        template.review_note = note
        template.review_submitted_at = now_utc()
        template.reviewed_at = None
        template.reviewed_by_user_id = None
    template.template_json = _template_json_with_row_metadata(template)
    template.updated_at = now_utc()
    _sync_legacy_user_template_mirror(session, template)
    session.commit()
    session.expire_all()
    return _get_user_template_or_raise(session, template_id)


def review_user_canvas_template(
    session: Session,
    *,
    template_id: str,
    approved: bool,
    actor_user_id: str,
    disabled_reason: str | None = None,
) -> DbCanvasTemplate:
    template = _get_user_template_or_raise(session, template_id)
    if approved:
        _set_template_enabled(template, enabled=True, actor_user_id=actor_user_id, disabled_reason=None)
        template.review_status = "approved"
    else:
        _set_template_enabled(template, enabled=False, actor_user_id=actor_user_id, disabled_reason=disabled_reason)
        template.review_status = "rejected"
    template.reviewed_at = now_utc()
    template.reviewed_by_user_id = actor_user_id
    template.updated_at = template.reviewed_at
    template.template_json = _template_json_with_row_metadata(template)
    _sync_legacy_user_template_mirror(session, template)
    session.commit()
    session.expire_all()
    return _get_user_template_or_raise(session, template_id)


def archive_user_canvas_template(
    session: Session,
    *,
    template_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> None:
    template = _get_user_template_or_raise(session, template_id)
    _ensure_user_template_mutable(template, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if template.archived_at is None:
        template.archived_at = now_utc()
        template.updated_at = template.archived_at
        _sync_legacy_user_template_mirror(session, template)
        session.commit()


def restore_user_canvas_template(
    session: Session,
    *,
    template_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> DbCanvasTemplate:
    template = _get_user_template_or_raise(session, template_id, include_archived=True)
    _ensure_user_template_mutable(template, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    template.archived_at = None
    template.updated_at = now_utc()
    _sync_legacy_user_template_mirror(session, template)
    session.commit()
    session.expire_all()
    return _get_user_template_or_raise(session, template_id)


def _parse_legacy_template_payload(row: UserCanvasTemplate) -> UserCanvasTemplatePayload:
    if row.kind not in {"full_canvas", "node_group"} or row.schema_version != USER_TEMPLATE_SCHEMA_VERSION:
        raise BusinessValidationError("用户模板版本不支持")
    payload = UserCanvasTemplatePayload.model_validate(row.template_json)
    if payload.version != USER_TEMPLATE_SCHEMA_VERSION or payload.kind not in {"full_canvas", "node_group"}:
        raise BusinessValidationError("用户模板版本不支持")
    return payload


def _get_user_template_or_raise(
    session: Session,
    template_id: str,
    *,
    include_archived: bool = False,
) -> DbCanvasTemplate:
    stmt = _canvas_template_query().where(DbCanvasTemplate.id == template_id, DbCanvasTemplate.scope == "user")
    if not include_archived:
        stmt = stmt.where(DbCanvasTemplate.archived_at.is_(None))
    template = session.scalar(stmt)
    if template is None:
        raise NotFoundError("用户模板不存在")
    return template


def _legacy_user_canvas_template_to_canvas_template(row: UserCanvasTemplate) -> CanvasTemplate:
    return _user_payload_to_canvas_template(
        _parse_legacy_template_payload(row),
        template_id=row.id,
        key=row.key,
        title=row.title,
        description=row.description,
        owner_user_id=None,
    )


def _canvas_template_query():
    return select(DbCanvasTemplate).options(
        selectinload(DbCanvasTemplate.owner),
        selectinload(DbCanvasTemplate.category).selectinload(CanvasTemplateCategory.disabled_by),
        selectinload(DbCanvasTemplate.category).selectinload(CanvasTemplateCategory.owner),
        selectinload(DbCanvasTemplate.disabled_by),
        selectinload(DbCanvasTemplate.reviewed_by),
    )


def _canvas_template_category_query():
    return select(CanvasTemplateCategory).options(
        selectinload(CanvasTemplateCategory.owner),
        selectinload(CanvasTemplateCategory.disabled_by),
    )


def _seed_builtin_canvas_templates(session: Session) -> None:
    categories_by_stage = _ensure_builtin_template_categories(session)
    seeded_template_keys: set[str] = set()
    for template in list_builtin_canvas_templates():
        seeded_template_keys.add(template.key)
        category = _builtin_template_category_for_stage(categories_by_stage, template.scenario.ecommerce_stage)
        existing = session.scalar(
            select(DbCanvasTemplate).where(DbCanvasTemplate.key == template.key, DbCanvasTemplate.scope == "global")
        )
        if existing is not None:
            existing.category_id = category.id
            existing.template_json = _template_payload_with_category_metadata(existing.template_json, category)
            continue
        row = DbCanvasTemplate(
            id=new_id(),
            key=template.key,
            scope="global",
            owner_user_id=None,
            category_id=category.id,
            title=template.title,
            description=template.description,
            kind=template.kind,
            entry_mode=template.entry_mode,
            sort_order=template.sort_order,
            schema_version=template.version,
            template_json=_builtin_template_payload(template, category),
        )
        session.add(row)
    _archive_empty_legacy_builtin_category(session, seeded_template_keys)


def _ensure_builtin_template_categories(session: Session) -> dict[str, CanvasTemplateCategory]:
    categories_by_stage: dict[str, CanvasTemplateCategory] = {}
    for stage, (category_id, category_name, sort_order) in BUILTIN_TEMPLATE_CATEGORIES_BY_STAGE.items():
        category = session.scalar(
            select(CanvasTemplateCategory).where(
                CanvasTemplateCategory.scope == "global",
                CanvasTemplateCategory.name == category_name,
            )
        )
        if category is None:
            category = CanvasTemplateCategory(
                id=category_id,
                scope="global",
                owner_user_id=None,
                name=category_name,
                sort_order=sort_order,
            )
            session.add(category)
        else:
            category.sort_order = sort_order
        categories_by_stage[stage] = category
    session.flush()
    return categories_by_stage


def _builtin_template_category_for_stage(
    categories_by_stage: dict[str, CanvasTemplateCategory],
    stage: str,
) -> CanvasTemplateCategory:
    category = categories_by_stage.get(stage)
    if category is None:
        raise BusinessValidationError("画布模板分类未配置")
    return category


def _builtin_template_payload(template: CanvasTemplate, category: CanvasTemplateCategory) -> dict[str, Any]:
    payload = template.model_copy(
        update={
            "scope": "global",
            "category_id": category.id,
            "category_name": category.name,
            "enabled": True,
            "effective_enabled": True,
            "review_status": "none",
        }
    ).model_dump(mode="json")
    return _sanitize_template_payload_product_context_configs(payload)


def _template_payload_with_category_metadata(
    template_json: dict[str, Any] | None,
    category: CanvasTemplateCategory,
) -> dict[str, Any]:
    payload = dict(template_json or {})
    payload.update(
        {
            "scope": "global",
            "category_id": category.id,
            "category_name": category.name,
            "enabled": True,
            "effective_enabled": True,
            "review_status": "none",
        }
    )
    return _sanitize_template_payload_product_context_configs(payload)


def _archive_empty_legacy_builtin_category(session: Session, seeded_template_keys: set[str]) -> None:
    legacy_category = session.scalar(
        select(CanvasTemplateCategory).where(
            CanvasTemplateCategory.scope == "global",
            CanvasTemplateCategory.name == LEGACY_BUILTIN_TEMPLATE_CATEGORY_NAME,
            CanvasTemplateCategory.archived_at.is_(None),
        )
    )
    if legacy_category is None:
        return
    remaining_template_id = session.scalar(
        select(DbCanvasTemplate.id).where(
            DbCanvasTemplate.category_id == legacy_category.id,
            DbCanvasTemplate.archived_at.is_(None),
            DbCanvasTemplate.key.not_in(seeded_template_keys),
        )
    )
    if remaining_template_id is not None:
        return
    legacy_category.archived_at = now_utc()
    legacy_category.updated_at = legacy_category.archived_at


def _migrate_legacy_user_canvas_templates(session: Session) -> None:
    owner_user_id = resolve_owner_user_id(session, None)
    legacy_rows = session.scalars(select(UserCanvasTemplate)).all()
    for legacy in legacy_rows:
        exists = session.scalar(select(DbCanvasTemplate.id).where(DbCanvasTemplate.key == legacy.key))
        if exists is not None:
            continue
        template = _legacy_user_canvas_template_to_canvas_template(legacy).model_copy(
            update={
                "template_id": legacy.id,
                "scope": "user",
                "owner_user_id": owner_user_id,
            }
        )
        session.add(
            DbCanvasTemplate(
                id=legacy.id,
                key=legacy.key,
                scope="user",
                owner_user_id=owner_user_id,
                category_id=None,
                title=legacy.title,
                description=legacy.description,
                kind=legacy.kind,
                entry_mode="image",
                schema_version=legacy.schema_version,
                template_json=template.model_dump(mode="json"),
                archived_at=legacy.archived_at,
            )
        )


def _parse_db_template_payload(row: DbCanvasTemplate) -> CanvasTemplate:
    try:
        raw_payload = dict(row.template_json or {})
    except TypeError as exc:
        raise BusinessValidationError("画布模板版本不支持") from exc
    if "scenario" in raw_payload:
        raw_payload.update(
            {
                "key": row.key,
                "template_id": row.id,
                "version": row.schema_version,
                "kind": row.kind,
                "entry_mode": row.entry_mode,
                "sort_order": row.sort_order,
                "title": row.title,
                "description": row.description or "",
                "source": "user" if row.scope == "user" else "builtin",
                "user_template_id": row.id if row.scope == "user" else None,
            }
        )
        return CanvasTemplate.model_validate(raw_payload)
    if row.scope == "user":
        payload = UserCanvasTemplatePayload.model_validate(raw_payload)
        return _user_payload_to_canvas_template(
            payload,
            template_id=row.id,
            key=row.key,
            title=row.title,
            description=row.description,
            owner_user_id=row.owner_user_id,
            entry_mode=_template_entry_mode(row.entry_mode),
            sort_order=row.sort_order,
        )
    raise BusinessValidationError("画布模板版本不支持")


def _user_payload_to_canvas_template(
    payload: UserCanvasTemplatePayload,
    *,
    template_id: str,
    key: str,
    title: str,
    description: str | None,
    owner_user_id: str | None,
    entry_mode: CanvasTemplateEntryMode = "image",
    sort_order: int = 100,
) -> CanvasTemplate:
    if payload.version != USER_TEMPLATE_SCHEMA_VERSION or payload.kind not in {"full_canvas", "node_group"}:
        raise BusinessValidationError("用户模板版本不支持")
    return CanvasTemplate(
        key=key,
        template_id=template_id,
        version=payload.version,
        kind=_template_kind(payload.kind),
        entry_mode=entry_mode,
        sort_order=sort_order,
        title=title,
        description=description or "",
        source="user",
        user_template_id=template_id,
        scope="user",
        owner_user_id=owner_user_id,
        review_status="none",
        scenario=CanvasTemplateScenarioMetadata(
            scenario=USER_TEMPLATE_SCENARIO,
            title="用户模板",
            description="用户保存的画布模板",
            ecommerce_stage="自定义",
            tags=("用户模板",),
        ),
        nodes=tuple(
            CanvasTemplateNodeSpec(
                key=node.key,
                node_type=node.node_type,
                title=node.title,
                position_x=node.position_x,
                position_y=node.position_y,
                config_json=node.config_json,
                size=_node_size(node.node_type, node.config_json),
            )
            for node in payload.nodes
        ),
        edges=tuple(
            CanvasTemplateEdgeSpec(
                source_node_key=edge.source_node_key,
                target_node_key=edge.target_node_key,
                source_handle=edge.source_handle,
                target_handle=edge.target_handle,
            )
            for edge in payload.edges
        ),
    )


def _template_visible_to_actor(
    row: DbCanvasTemplate,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
    management: bool,
) -> bool:
    if row.archived_at is not None:
        return False
    if row.category is not None and row.category.archived_at is not None:
        return False
    if management and actor_is_admin:
        return True
    if row.scope == "user":
        return row.owner_user_id == actor_user_id and (
            management or moderation_state_for_resource(row).effective_enabled
        )
    return moderation_state_for_resource(row).effective_enabled


def _category_visible_to_actor(
    row: CanvasTemplateCategory,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
    management: bool,
) -> bool:
    if row.archived_at is not None:
        return False
    if management and actor_is_admin:
        return True
    if row.scope == "user":
        return row.owner_user_id == actor_user_id and (
            management or moderation_state_for_resource(row).effective_enabled
        )
    return moderation_state_for_resource(row).effective_enabled


def _template_json_with_row_metadata(row: DbCanvasTemplate) -> dict[str, Any]:
    template = canvas_template_row_to_canvas_template(row)
    return template.model_dump(mode="json")


def _set_template_enabled(
    row: DbCanvasTemplate,
    *,
    enabled: bool,
    actor_user_id: str | None,
    disabled_reason: str | None,
) -> None:
    if enabled:
        row.enabled = True
        row.disabled_at = None
        row.disabled_by_user_id = None
        row.disabled_reason = None
        if row.review_status == "pending":
            row.review_status = "approved"
            row.reviewed_at = now_utc()
            row.reviewed_by_user_id = actor_user_id
        return
    row.enabled = False
    row.disabled_at = now_utc()
    row.disabled_by_user_id = actor_user_id
    row.disabled_reason = _normalize_optional_long_text(disabled_reason)


def _owner_edit_requires_review(
    row: DbCanvasTemplate,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
) -> bool:
    return (
        row.scope == "user"
        and not actor_is_admin
        and row.owner_user_id == actor_user_id
        and not moderation_state_for_resource(row).effective_enabled
    )


def _normalize_review_note(value: str | None) -> str | None:
    normalized = _normalize_optional_long_text(value)
    if normalized is None:
        return None
    if len(normalized) > 1000:
        raise BusinessValidationError("修改说明不能超过 1000 个字符")
    return normalized


def _normalize_optional_long_text(value: str | None) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _template_review_status(value: str | None) -> TemplateReviewStatus:
    if value in {"none", "pending", "approved", "rejected"}:
        return value
    return "none"


def _upsert_legacy_user_template_mirror(
    session: Session,
    template: DbCanvasTemplate,
    payload: UserCanvasTemplatePayload,
) -> None:
    legacy = session.get(UserCanvasTemplate, template.id)
    if legacy is None:
        legacy = UserCanvasTemplate(id=template.id, key=template.key)
        session.add(legacy)
    legacy.title = template.title
    legacy.description = template.description
    legacy.kind = template.kind
    legacy.schema_version = template.schema_version
    legacy.template_json = payload.model_dump(mode="json")
    legacy.archived_at = template.archived_at


def _sync_legacy_user_template_mirror(session: Session, template: DbCanvasTemplate) -> None:
    if template.scope != "user":
        return
    legacy = session.get(UserCanvasTemplate, template.id)
    if legacy is None:
        payload = _legacy_payload_from_canvas_template(canvas_template_row_to_canvas_template(template))
        _upsert_legacy_user_template_mirror(session, template, payload)
        return
    legacy.title = template.title
    legacy.description = template.description
    legacy.kind = template.kind
    legacy.schema_version = template.schema_version
    legacy.archived_at = template.archived_at


def _legacy_payload_from_canvas_template(template: CanvasTemplate) -> UserCanvasTemplatePayload:
    return UserCanvasTemplatePayload(
        version=template.version,
        kind=template.kind,
        nodes=tuple(
            UserCanvasTemplateNodePayload(
                key=node.key,
                node_type=node.node_type,
                title=node.title,
                position_x=node.position_x,
                position_y=node.position_y,
                config_json=node.config_json,
            )
            for node in template.nodes
        ),
        edges=tuple(
            UserCanvasTemplateEdgePayload(
                source_node_key=edge.source_node_key,
                target_node_key=edge.target_node_key,
                source_handle=edge.source_handle,
                target_handle=edge.target_handle,
            )
            for edge in template.edges
        ),
    )


def _ensure_user_template_mutable(
    template: DbCanvasTemplate,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
) -> None:
    ensure_actor_can_mutate_owner(
        owner_user_id=template.owner_user_id or "",
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="用户模板不存在",
    )


def _ensure_category_mutable(
    category: CanvasTemplateCategory,
    *,
    actor_user_id: str | None,
    actor_is_admin: bool,
) -> None:
    if category.scope == "global":
        return
    ensure_actor_can_mutate_owner(
        owner_user_id=category.owner_user_id or "",
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="画布模板分类不存在",
    )


def _ensure_category_scope(category: CanvasTemplateCategory, expected_scope: TemplateScope | None) -> None:
    if expected_scope is not None and category.scope != _normalize_scope(expected_scope):
        raise NotFoundError("画布模板分类不存在")


def _validate_template_category(
    session: Session,
    *,
    scope: TemplateScope,
    owner_user_id: str | None,
    category_id: str | None,
) -> CanvasTemplateCategory | None:
    normalized_scope = _normalize_scope(scope)
    normalized_owner_user_id = None
    if normalized_scope == "user":
        normalized_owner_user_id = require_active_user_id(
            session,
            owner_user_id or "",
            missing_message="用户模板归属账号不存在",
        )
    if category_id is None:
        return None
    category = session.get(CanvasTemplateCategory, category_id)
    if category is None or category.archived_at is not None:
        raise BusinessValidationError("画布模板分类不存在")
    if category.scope != normalized_scope:
        raise BusinessValidationError("画布模板分类范围不匹配")
    if normalized_scope == "user" and category.owner_user_id != normalized_owner_user_id:
        raise BusinessValidationError("画布模板分类不存在")
    if normalized_scope == "global" and category.owner_user_id is not None:
        raise BusinessValidationError("画布模板分类范围不匹配")
    ensure_resource_usable(category)
    return category


def _get_canvas_template_category_or_raise(
    session: Session,
    category_id: str,
    *,
    include_archived: bool = False,
) -> CanvasTemplateCategory:
    stmt = _canvas_template_category_query().where(CanvasTemplateCategory.id == category_id)
    if not include_archived:
        stmt = stmt.where(CanvasTemplateCategory.archived_at.is_(None))
    category = session.scalar(stmt)
    if category is None:
        raise NotFoundError("画布模板分类不存在")
    return category


def _get_global_canvas_template_or_raise(
    session: Session,
    template_id: str,
    *,
    include_archived: bool = False,
) -> DbCanvasTemplate:
    stmt = _canvas_template_query().where(DbCanvasTemplate.id == template_id, DbCanvasTemplate.scope == "global")
    if not include_archived:
        stmt = stmt.where(DbCanvasTemplate.archived_at.is_(None))
    row = session.scalar(stmt)
    if row is None:
        raise NotFoundError("画布模板不存在")
    return row


def _global_template_contract(
    *,
    key: str,
    title: str,
    description: str | None,
    kind: TemplateKind,
    entry_mode: CanvasTemplateEntryMode,
    sort_order: int,
    template_json: dict[str, Any],
) -> CanvasTemplate:
    raw_payload = dict(template_json or {})
    raw_payload.update(
        {
            "key": key,
            "kind": kind,
            "entry_mode": entry_mode,
            "sort_order": sort_order,
            "title": title,
            "description": (description or "").strip(),
            "source": "builtin",
            "user_template_id": None,
            "scope": "global",
            "owner_user_id": None,
        }
    )
    raw_payload.setdefault("version", USER_TEMPLATE_SCHEMA_VERSION)
    try:
        return CanvasTemplate.model_validate(raw_payload)
    except BusinessValidationError:
        raise
    except ValueError as exc:
        raise BusinessValidationError("画布模板内容不合法") from exc


def _normalize_category_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise BusinessValidationError("画布模板分类名称不能为空")
    if len(normalized) > 120:
        raise BusinessValidationError("画布模板分类名称不能超过 120 个字符")
    return normalized


def _normalize_template_key(key: str) -> str:
    normalized = key.strip()
    if not normalized:
        raise BusinessValidationError("画布模板 key 不能为空")
    if normalized.startswith(USER_TEMPLATE_KEY_PREFIX):
        raise BusinessValidationError("全局画布模板 key 不能使用 user: 前缀")
    if len(normalized) > 120:
        raise BusinessValidationError("画布模板 key 不能超过 120 个字符")
    return normalized


def _normalize_template_title(title: str) -> str:
    normalized = title.strip()
    if not normalized:
        raise BusinessValidationError("画布模板名称不能为空")
    if len(normalized) > 255:
        raise BusinessValidationError("画布模板名称不能超过 255 个字符")
    return normalized


def _normalize_scope(scope: str) -> TemplateScope:
    normalized = (scope or "").strip().lower()
    if normalized not in {"global", "user"}:
        raise BusinessValidationError("画布模板范围不支持")
    return normalized  # type: ignore[return-value]


def _normalize_optional_scope(scope: str | None) -> TemplateScope | None:
    normalized = (scope or "").strip().lower()
    if not normalized or normalized == "all":
        return None
    if normalized not in {"global", "user"}:
        raise BusinessValidationError("画布模板范围不支持")
    return normalized  # type: ignore[return-value]


def _normalize_search(search: str | None) -> str | None:
    normalized = (search or "").strip()
    return normalized or None


def _normalize_optional_initial_workflow_entry(value: str | None) -> InitialWorkflowEntry | None:
    normalized = (value or "").strip().lower()
    if not normalized or normalized == "all":
        return None
    if normalized not in {"image", "copy", "tail", "blank"}:
        raise BusinessValidationError("初始工作台入口不支持")
    return normalized  # type: ignore[return-value]


def _template_scope(value: str) -> TemplateScope:
    return _normalize_scope(value)


def _template_kind(value: str) -> TemplateKind:
    if value not in {"full_canvas", "node_group"}:
        raise BusinessValidationError("画布模板类型不支持")
    return value  # type: ignore[return-value]


def _template_entry_mode(value: str) -> CanvasTemplateEntryMode:
    if value not in {"image", "copy", "tail"}:
        raise BusinessValidationError("画布模板入口类型不支持")
    return value  # type: ignore[return-value]


def _node_size(node_type: WorkflowNodeType, config_json: dict[str, Any]) -> str | None:
    if node_type != WorkflowNodeType.IMAGE_GENERATION:
        return None
    raw_size = config_json.get("size")
    return raw_size if isinstance(raw_size, str) and raw_size else None


def _selected_internal_edges(
    edges: list[WorkflowEdge],
    node_keys_by_id: dict[str, str],
) -> list[UserCanvasTemplateEdgePayload]:
    template_edges: list[UserCanvasTemplateEdgePayload] = []
    for edge in edges:
        source_key = node_keys_by_id.get(edge.source_node_id)
        target_key = node_keys_by_id.get(edge.target_node_id)
        if source_key is None or target_key is None:
            continue
        template_edges.append(
            UserCanvasTemplateEdgePayload(
                source_node_key=source_key,
                target_node_key=target_key,
                source_handle=edge.source_handle,
                target_handle=edge.target_handle,
            )
        )
    return template_edges


def extract_reusable_node_config(node: WorkflowNode, *, retain_prompt_text: bool = True) -> dict[str, Any]:
    if node.node_type == WorkflowNodeType.PRODUCT_CONTEXT:
        reusable_config = _sanitize_product_context_template_config(node.config_json or {})
    else:
        reusable_config = _sanitize_reusable_config(node.config_json or {})
    if not retain_prompt_text:
        reusable_config = _strip_prompt_text_config(node.node_type, reusable_config)
    if node.node_type == WorkflowNodeType.TAIL_SPLITTER:
        reusable_config.pop("source_text", None)
    return _normalize_template_node_config(node.node_type, reusable_config)


def _normalize_template_node_config(node_type: WorkflowNodeType, config_json: dict[str, Any]) -> dict[str, Any]:
    config = dict(config_json)
    if node_type == WorkflowNodeType.IMAGE_GENERATION:
        try:
            normalized_size = image_size_from_config(config)
        except ValueError as exc:
            raise BusinessValidationError(str(exc)) from exc
        if normalized_size is not None:
            config["size"] = normalized_size
        if "tool_options" in config:
            raw_tool_options = config.get("tool_options")
            config["tool_options"] = normalize_image_generation_tool_options(
                raw_tool_options if isinstance(raw_tool_options, dict) else None
            )
    if node_type == WorkflowNodeType.COPY_GENERATION:
        try:
            config = normalize_copy_node_config(config).model_dump(mode="json")
        except ValueError as exc:
            raise BusinessValidationError(str(exc)) from exc
    return config


def _workflow_template_entry_mode(value: str) -> CanvasTemplateEntryMode:
    if value == "blank":
        raise BusinessValidationError("空白画布不能保存为模板")
    return _template_entry_mode(value)


def _full_canvas_template_nodes(workflow) -> list[WorkflowNode]:
    nodes = sorted(workflow.nodes, key=lambda item: (item.position_x, item.position_y, item.created_at))
    tail_nodes = [node for node in nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER]
    if not tail_nodes:
        return nodes
    tail_node = tail_nodes[0]
    predecessor_ids = _transitive_predecessor_node_ids(workflow.edges, tail_node.id)
    allowed_ids = predecessor_ids | {tail_node.id}
    return [node for node in nodes if node.id in allowed_ids]


def _transitive_predecessor_node_ids(edges: list[WorkflowEdge], node_id: str) -> set[str]:
    incoming_by_target: dict[str, set[str]] = {}
    for edge in edges:
        incoming_by_target.setdefault(edge.target_node_id, set()).add(edge.source_node_id)
    pending = list(incoming_by_target.get(node_id, set()))
    seen: set[str] = set()
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        pending.extend(incoming_by_target.get(current, set()) - seen)
    return seen


def _strip_prompt_text_config(node_type: WorkflowNodeType, config_json: dict[str, Any]) -> dict[str, Any]:
    if node_type not in {WorkflowNodeType.COPY_GENERATION, WorkflowNodeType.IMAGE_GENERATION}:
        return config_json
    return {key: value for key, value in config_json.items() if key not in PROMPT_TEXT_CONFIG_KEYS}


def _sanitize_product_context_template_config(config_json: dict[str, Any]) -> dict[str, Any]:
    sanitized = _sanitize_reusable_config(
        {
            key: value
            for key, value in normalize_product_context_config(config_json).items()
            if key not in PRODUCT_CONTEXT_TEMPLATE_ASSET_CONFIG_KEYS
            and key not in PRODUCT_CONTEXT_TEMPLATE_RUNTIME_CONFIG_KEYS
        },
        allow_artifact_shaped_keys=True,
    )
    return sanitized if isinstance(sanitized, dict) else {}


def _sanitize_template_payload_product_context_configs(payload: dict[str, Any]) -> dict[str, Any]:
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        return payload
    for node in nodes:
        if not isinstance(node, dict) or node.get("node_type") != WorkflowNodeType.PRODUCT_CONTEXT.value:
            continue
        config_json = node.get("config_json")
        node["config_json"] = _sanitize_product_context_template_config(
            config_json if isinstance(config_json, dict) else {}
        )
    return payload


def _sanitize_reusable_config(
    value: Any,
    *,
    path: tuple[str, ...] = (),
    allow_artifact_shaped_keys: bool = False,
) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, nested_value in value.items():
            if not isinstance(key, str):
                raise BusinessValidationError("模板配置包含不可复用的产物数据")
            if key in SYSTEM_TEMPLATE_CONFIG_KEYS:
                continue
            normalized_key = key.lower()
            if normalized_key in ARTIFACT_SPECIFIC_CONFIG_KEYS:
                continue
            if normalized_key in REUSABLE_SUFFIX_CONFIG_KEYS:
                sanitized[key] = _sanitize_reusable_config(
                    nested_value,
                    path=(*path, key),
                    allow_artifact_shaped_keys=allow_artifact_shaped_keys,
                )
                continue
            if not allow_artifact_shaped_keys and normalized_key.endswith(ARTIFACT_SPECIFIC_KEY_SUFFIXES):
                raise BusinessValidationError("模板配置包含不可复用的产物数据")
            sanitized[key] = _sanitize_reusable_config(
                nested_value,
                path=(*path, key),
                allow_artifact_shaped_keys=allow_artifact_shaped_keys,
            )
        return sanitized
    if isinstance(value, list):
        return [
            _sanitize_reusable_config(
                item,
                path=path,
                allow_artifact_shaped_keys=allow_artifact_shaped_keys,
            )
            for item in value
        ]
    return value
