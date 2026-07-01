from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import user_has_api_permission
from inspiration_one_backend.application.inspiration_workflow import execution as workflow_execution
from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.application.inspiration_workflow.deck_sources import (
    bind_deck_node_slide_material,
    build_deck_source_manifest,
    create_or_replace_deck_node_outline,
    enhance_deck_node_slide_material,
    generate_deck_node_deck,
    generate_deck_node_sample,
    generate_deck_node_slide_speaker_notes,
    preview_deck_node_output,
    refresh_deck_source_manifest,
    regenerate_deck_node_slide,
    rename_deck_node_deck,
    reorder_deck_node_slides,
    set_deck_node_style,
    unbind_deck_node_slide_material,
    update_deck_node_slide,
)
from inspiration_one_backend.application.inspiration_workflow.tail_splitter import TailSplitPlanImageGenerationConfig
from inspiration_one_backend.application.inspiration_workflows import (
    apply_node_group_template_to_workflow,
    apply_tail_split_plan,
    archive_canvas_template_category,
    archive_global_canvas_template,
    archive_user_canvas_template,
    bind_workflow_node_image,
    cancel_inspiration_workflow_run,
    clear_workflow_node_image,
    copy_user_canvas_template_to_global,
    create_canvas_template_category,
    create_global_canvas_template,
    create_user_canvas_template_from_active_workflow,
    create_user_canvas_template_from_workflow_nodes,
    create_workflow_edge,
    create_workflow_node,
    delete_workflow_edge,
    delete_workflow_node,
    duplicate_workflow_node_group,
    get_inspiration_workflow_status,
    get_or_create_inspiration_workflow,
    list_canvas_template_categories,
    list_canvas_template_categories_for_management,
    list_canvas_templates,
    list_canvas_templates_for_management,
    rename_user_canvas_template,
    restore_canvas_template_category,
    restore_global_canvas_template,
    restore_user_canvas_template,
    retry_inspiration_workflow_run,
    review_user_canvas_template,
    submit_failed_workflow_nodes_run,
    submit_inspiration_workflow_run,
    update_canvas_template_category,
    update_global_canvas_template,
    update_workflow_copy_set,
    update_workflow_node,
    upload_workflow_node_document,
    upload_workflow_node_image,
)
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.domain.enums import WorkflowNodeType
from inspiration_one_backend.domain.rbac import (
    API_DECK_GENERATE,
    API_DECK_READ,
    API_DECK_WRITE,
    API_GLOBAL_TEMPLATES_MANAGE,
    API_INSPIRATIONS_GENERATE,
    API_INSPIRATIONS_READ,
    API_INSPIRATIONS_WRITE,
)
from inspiration_one_backend.infrastructure.db.models import (
    AuthUser,
    Inspiration,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
)
from inspiration_one_backend.presentation.deps import get_session, require_any_api_permission, require_api_permission
from inspiration_one_backend.presentation.schemas.decks import (
    DeckResponse,
    DeckSlideResponse,
    EnhanceDeckSlideMaterialRequest,
    RenameDeckRequest,
    ReorderDeckSlidesRequest,
    SetDeckStyleRequest,
    UpdateDeckSlideRequest,
    serialize_deck,
    serialize_deck_slide,
)
from inspiration_one_backend.presentation.schemas.inspiration_workflows import (
    ApplyTailSplitPlanRequest,
    ApplyWorkflowTemplateGroupRequest,
    BindWorkflowNodeImageRequest,
    CanvasTemplateCategoryListResponse,
    CanvasTemplateCategoryResponse,
    CanvasTemplateListResponse,
    CanvasTemplateSummaryResponse,
    CopyUserTemplateToGlobalRequest,
    CreateCanvasTemplateCategoryRequest,
    CreateGlobalCanvasTemplateRequest,
    CreateUserCanvasTemplateRequest,
    CreateUserTemplateGroupRequest,
    CreateWorkflowEdgeRequest,
    CreateWorkflowNodeRequest,
    DeckNodeOutlineRequest,
    DeckNodeSlideMaterialRequest,
    DeckSourceManifestResponse,
    DuplicateWorkflowNodeGroupRequest,
    InspirationWorkflowResponse,
    InspirationWorkflowStatusResponse,
    ReviewUserTemplateGroupRequest,
    RunWorkflowRequest,
    UpdateCanvasTemplateCategoryRequest,
    UpdateGlobalCanvasTemplateRequest,
    UpdateUserTemplateGroupRequest,
    UpdateWorkflowCopySetRequest,
    UpdateWorkflowNodeRequest,
    serialize_canvas_template_category,
    serialize_canvas_template_summary,
    serialize_deck_source_manifest,
    serialize_inspiration_workflow,
    serialize_inspiration_workflow_status,
    serialize_user_canvas_template_summary,
)
from inspiration_one_backend.presentation.upload_validation import (
    read_validated_image_upload,
    read_validated_text_document_upload,
)

router = APIRouter(
    prefix="/api",
    tags=["inspiration-workflows"],
)


def _ensure_inspiration_access(
    session: Session,
    inspiration_id: str,
    current_user: AuthUser,
    *,
    mutate: bool,
    require_usable: bool = True,
) -> Inspiration:
    inspiration = session.get(Inspiration, inspiration_id)
    if (
        inspiration is None
        or (not current_user.is_admin and inspiration.owner_user_id != current_user.id)
        or (not current_user.is_admin and inspiration.deleted_at is not None)
    ):
        raise HTTPException(status_code=404, detail="灵感产物不存在")
    if mutate and inspiration.deleted_at is not None:
        raise HTTPException(status_code=400, detail="灵感产物已删除")
    if mutate and current_user.is_admin and inspiration.owner_user_id != current_user.id:
        raise HTTPException(status_code=400, detail="管理员不能直接编辑其他用户资源")
    if mutate and require_usable:
        ensure_resource_usable(inspiration)
    return inspiration


def _ensure_inspiration_workflow_read_does_not_create_for_restricted_inspiration(
    session: Session,
    inspiration: Inspiration,
    current_user: AuthUser,
) -> None:
    restricted_read = (
        current_user.is_admin and inspiration.owner_user_id != current_user.id
    ) or not inspiration.enabled
    if not restricted_read:
        return
    workflow_id = session.scalar(
        select(InspirationWorkflow.id).where(
            InspirationWorkflow.inspiration_id == inspiration.id, InspirationWorkflow.active.is_(True)
        )
    )
    if workflow_id is None:
        raise HTTPException(status_code=404, detail="工作流不存在")


def _ensure_node_access(session: Session, node_id: str, current_user: AuthUser, *, mutate: bool) -> WorkflowNode:
    node = session.get(WorkflowNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="工作流节点不存在")
    workflow = session.get(InspirationWorkflow, node.workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="工作流不存在")
    _ensure_inspiration_access(session, workflow.inspiration_id, current_user, mutate=mutate)
    return node


def _ensure_edge_access(session: Session, edge_id: str, current_user: AuthUser, *, mutate: bool) -> WorkflowEdge:
    edge = session.get(WorkflowEdge, edge_id)
    if edge is None:
        raise HTTPException(status_code=404, detail="工作流连线不存在")
    workflow = session.get(InspirationWorkflow, edge.workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="工作流不存在")
    _ensure_inspiration_access(session, workflow.inspiration_id, current_user, mutate=mutate)
    return edge


def _ensure_workflow_deck_node_context(
    session: Session,
    *,
    inspiration_id: str,
    node_id: str,
    current_user: AuthUser,
    mutate: bool,
) -> tuple[InspirationWorkflow, WorkflowNode]:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=mutate)
    node = _ensure_node_access(session, node_id, current_user, mutate=mutate)
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)
    if workflow.inspiration_id != inspiration_id:
        raise HTTPException(status_code=404, detail="工作流节点不存在")
    return workflow, node


def _serialize_workflow_response(session: Session, workflow: InspirationWorkflow) -> InspirationWorkflowResponse:
    output_json_overrides = {
        node.id: preview_deck_node_output(session, workflow=workflow, deck_node=node)
        for node in workflow.nodes
        if node.node_type == WorkflowNodeType.DECK_GENERATION
    }
    return serialize_inspiration_workflow(workflow, output_json_overrides=output_json_overrides)


def _ensure_bind_image_source_usable(
    session: Session,
    node: WorkflowNode,
    payload: BindWorkflowNodeImageRequest,
) -> None:
    workflow = session.get(InspirationWorkflow, node.workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="工作流不存在")
    if payload.source_asset_id:
        asset = session.get(SourceAsset, payload.source_asset_id)
        if asset is not None and asset.inspiration_id == workflow.inspiration_id:
            ensure_resource_usable(asset)
    if payload.poster_variant_id:
        poster = session.get(PosterVariant, payload.poster_variant_id)
        if poster is not None and poster.inspiration_id == workflow.inspiration_id:
            ensure_resource_usable(poster)


@router.get("/inspirations/{inspiration_id}/workflow", response_model=InspirationWorkflowResponse)
def get_inspiration_workflow_endpoint(
    inspiration_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> InspirationWorkflowResponse:
    inspiration = _ensure_inspiration_access(session, inspiration_id, current_user, mutate=False)
    _ensure_inspiration_workflow_read_does_not_create_for_restricted_inspiration(session, inspiration, current_user)
    workflow = get_or_create_inspiration_workflow(session, inspiration_id)
    return _serialize_workflow_response(session, workflow)


@router.get("/inspirations/{inspiration_id}/workflow/status", response_model=InspirationWorkflowStatusResponse)
def get_inspiration_workflow_status_endpoint(
    inspiration_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> InspirationWorkflowStatusResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=False)
    workflow = get_inspiration_workflow_status(session, inspiration_id)
    return serialize_inspiration_workflow_status(workflow)


@router.get("/workflow/canvas-templates", response_model=CanvasTemplateListResponse)
def list_canvas_templates_endpoint(
    search: str | None = Query(default=None, max_length=120),
    category_id: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    initial_workflow_entry: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> CanvasTemplateListResponse:
    templates = [
        serialize_canvas_template_summary(template)
        for template in list_canvas_templates(
            session,
            actor_user_id=current_user.id,
            actor_is_admin=current_user.is_admin,
            search=search,
            category_id=category_id,
            scope=scope,
            initial_workflow_entry=initial_workflow_entry,
        )
    ]
    return CanvasTemplateListResponse(items=templates)


@router.get("/workflow/canvas-templates/manage", response_model=CanvasTemplateListResponse)
def list_canvas_templates_for_management_endpoint(
    search: str | None = Query(default=None, max_length=120),
    category_id: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    initial_workflow_entry: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_any_api_permission(API_INSPIRATIONS_READ, API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateListResponse:
    can_manage_global_templates = user_has_api_permission(session, current_user, API_GLOBAL_TEMPLATES_MANAGE)
    if not can_manage_global_templates and scope != "user":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有接口权限")
    templates = [
        serialize_canvas_template_summary(template)
        for template in list_canvas_templates_for_management(
            session,
            actor_user_id=current_user.id,
            actor_is_admin=can_manage_global_templates,
            search=search,
            category_id=category_id,
            scope=scope,
            initial_workflow_entry=initial_workflow_entry,
        )
    ]
    return CanvasTemplateListResponse(items=templates)


@router.get("/workflow/canvas-template-categories", response_model=CanvasTemplateCategoryListResponse)
def list_canvas_template_categories_endpoint(
    search: str | None = Query(default=None, max_length=120),
    scope: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> CanvasTemplateCategoryListResponse:
    categories = list_canvas_template_categories(
        session,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        search=search,
        scope=scope,
    )
    return CanvasTemplateCategoryListResponse(
        items=[serialize_canvas_template_category(category) for category in categories]
    )


@router.get("/workflow/canvas-template-categories/manage", response_model=CanvasTemplateCategoryListResponse)
def list_canvas_template_categories_for_management_endpoint(
    search: str | None = Query(default=None, max_length=120),
    scope: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_any_api_permission(API_INSPIRATIONS_READ, API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateCategoryListResponse:
    can_manage_global_templates = user_has_api_permission(session, current_user, API_GLOBAL_TEMPLATES_MANAGE)
    if not can_manage_global_templates and scope != "user":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="没有接口权限")
    categories = list_canvas_template_categories_for_management(
        session,
        actor_user_id=current_user.id,
        actor_is_admin=can_manage_global_templates,
        search=search,
        scope=scope,
    )
    return CanvasTemplateCategoryListResponse(
        items=[serialize_canvas_template_category(category) for category in categories]
    )


@router.post(
    "/workflow/user-template-categories",
    response_model=CanvasTemplateCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_template_category_endpoint(
    payload: CreateCanvasTemplateCategoryRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateCategoryResponse:
    category = create_canvas_template_category(
        session,
        scope="user",
        name=payload.name,
        sort_order=payload.sort_order,
        actor_user_id=current_user.id,
    )
    return serialize_canvas_template_category(category)


@router.patch(
    "/workflow/user-template-categories/{category_id}",
    response_model=CanvasTemplateCategoryResponse,
)
def update_user_template_category_endpoint(
    category_id: str,
    payload: UpdateCanvasTemplateCategoryRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateCategoryResponse:
    category = update_canvas_template_category(
        session,
        category_id=category_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        expected_scope="user",
        name=payload.name,
        sort_order=payload.sort_order,
    )
    return serialize_canvas_template_category(category)


@router.delete("/workflow/user-template-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_user_template_category_endpoint(
    category_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> None:
    archive_canvas_template_category(
        session,
        category_id=category_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        expected_scope="user",
    )


@router.post(
    "/workflow/user-template-categories/{category_id}/restore",
    response_model=CanvasTemplateCategoryResponse,
)
def restore_user_template_category_endpoint(
    category_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateCategoryResponse:
    category = restore_canvas_template_category(
        session,
        category_id=category_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        expected_scope="user",
    )
    return serialize_canvas_template_category(category)


@router.post(
    "/workflow/global-template-categories",
    response_model=CanvasTemplateCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_global_template_category_endpoint(
    payload: CreateCanvasTemplateCategoryRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateCategoryResponse:
    category = create_canvas_template_category(
        session,
        scope="global",
        name=payload.name,
        sort_order=payload.sort_order,
        actor_user_id=current_user.id,
    )
    return serialize_canvas_template_category(category)


@router.patch(
    "/workflow/global-template-categories/{category_id}",
    response_model=CanvasTemplateCategoryResponse,
)
def update_global_template_category_endpoint(
    category_id: str,
    payload: UpdateCanvasTemplateCategoryRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateCategoryResponse:
    category = update_canvas_template_category(
        session,
        category_id=category_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        expected_scope="global",
        name=payload.name,
        sort_order=payload.sort_order,
    )
    return serialize_canvas_template_category(category)


@router.delete("/workflow/global-template-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_global_template_category_endpoint(
    category_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> None:
    archive_canvas_template_category(
        session,
        category_id=category_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        expected_scope="global",
    )


@router.post(
    "/workflow/global-template-categories/{category_id}/restore",
    response_model=CanvasTemplateCategoryResponse,
)
def restore_global_template_category_endpoint(
    category_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateCategoryResponse:
    category = restore_canvas_template_category(
        session,
        category_id=category_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        expected_scope="global",
    )
    return serialize_canvas_template_category(category)


@router.post(
    "/workflow/global-canvas-templates",
    response_model=CanvasTemplateSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_global_canvas_template_endpoint(
    payload: CreateGlobalCanvasTemplateRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateSummaryResponse:
    template = create_global_canvas_template(
        session,
        key=payload.key,
        title=payload.title,
        description=payload.description,
        kind=payload.kind,
        entry_mode=payload.entry_mode,
        sort_order=payload.sort_order,
        category_id=payload.category_id,
        template_json=payload.template_json,
        enabled=payload.enabled,
    )
    return serialize_user_canvas_template_summary(template)


@router.patch("/workflow/global-canvas-templates/{template_id}", response_model=CanvasTemplateSummaryResponse)
def update_global_canvas_template_endpoint(
    template_id: str,
    payload: UpdateGlobalCanvasTemplateRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateSummaryResponse:
    template = update_global_canvas_template(
        session,
        template_id=template_id,
        title=payload.title,
        description=payload.description,
        kind=payload.kind,
        entry_mode=payload.entry_mode,
        sort_order=payload.sort_order,
        category_id=payload.category_id,
        template_json=payload.template_json,
        enabled=payload.enabled,
        disabled_reason=payload.disabled_reason,
        actor_user_id=current_user.id,
    )
    return serialize_user_canvas_template_summary(template)


@router.delete("/workflow/global-canvas-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_global_canvas_template_endpoint(
    template_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> None:
    archive_global_canvas_template(session, template_id=template_id)


@router.post("/workflow/global-canvas-templates/{template_id}/restore", response_model=CanvasTemplateSummaryResponse)
def restore_global_canvas_template_endpoint(
    template_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateSummaryResponse:
    template = restore_global_canvas_template(session, template_id=template_id)
    return serialize_user_canvas_template_summary(template)


@router.post(
    "/inspirations/{inspiration_id}/workflow/user-template-groups",
    response_model=CanvasTemplateSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_template_group_endpoint(
    inspiration_id: str,
    payload: CreateUserTemplateGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateSummaryResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    template = create_user_canvas_template_from_workflow_nodes(
        session,
        inspiration_id=inspiration_id,
        title=payload.title,
        description=payload.description,
        node_ids=payload.node_ids,
        category_id=payload.category_id,
        owner_user_id=current_user.id,
    )
    return serialize_user_canvas_template_summary(template)


@router.post(
    "/inspirations/{inspiration_id}/workflow/user-canvas-templates",
    response_model=CanvasTemplateSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_canvas_template_endpoint(
    inspiration_id: str,
    payload: CreateUserCanvasTemplateRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateSummaryResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    template = create_user_canvas_template_from_active_workflow(
        session,
        inspiration_id=inspiration_id,
        title=payload.title,
        description=payload.description,
        category_id=payload.category_id,
        retain_prompt_text=payload.retain_prompt_text,
        sort_order=payload.sort_order,
        owner_user_id=current_user.id,
    )
    return serialize_user_canvas_template_summary(template)


@router.patch("/workflow/user-template-groups/{template_id}", response_model=CanvasTemplateSummaryResponse)
def update_user_template_group_endpoint(
    template_id: str,
    payload: UpdateUserTemplateGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateSummaryResponse:
    template = rename_user_canvas_template(
        session,
        template_id=template_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        title=payload.title,
        description=payload.description,
        category_id=payload.category_id,
        sort_order=payload.sort_order,
        enabled=payload.enabled,
        disabled_reason=payload.disabled_reason,
        review_note=payload.review_note,
    )
    return serialize_user_canvas_template_summary(template)


@router.post("/workflow/user-template-groups/{template_id}/review", response_model=CanvasTemplateSummaryResponse)
def review_user_template_group_endpoint(
    template_id: str,
    payload: ReviewUserTemplateGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateSummaryResponse:
    template = review_user_canvas_template(
        session,
        template_id=template_id,
        approved=payload.approved,
        actor_user_id=current_user.id,
        disabled_reason=payload.disabled_reason,
    )
    return serialize_user_canvas_template_summary(template)


@router.post(
    "/workflow/user-template-groups/{template_id}/copy-to-global",
    response_model=CanvasTemplateSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def copy_user_template_to_global_endpoint(
    template_id: str,
    payload: CopyUserTemplateToGlobalRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
) -> CanvasTemplateSummaryResponse:
    template = copy_user_canvas_template_to_global(
        session,
        template_id=template_id,
        category_id=payload.category_id,
        title=payload.title,
        description=payload.description,
        sort_order=payload.sort_order,
    )
    return serialize_user_canvas_template_summary(template)


@router.delete("/workflow/user-template-groups/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_user_template_group_endpoint(
    template_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> None:
    archive_user_canvas_template(
        session,
        template_id=template_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )


@router.post("/workflow/user-template-groups/{template_id}/restore", response_model=CanvasTemplateSummaryResponse)
def restore_user_template_group_endpoint(
    template_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateSummaryResponse:
    template = restore_user_canvas_template(
        session,
        template_id=template_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_user_canvas_template_summary(template)


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes",
    response_model=InspirationWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workflow_node_endpoint(
    inspiration_id: str,
    payload: CreateWorkflowNodeRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    workflow = create_workflow_node(
        session,
        inspiration_id=inspiration_id,
        node_type=payload.node_type,
        title=payload.title,
        position_x=payload.position_x,
        position_y=payload.position_y,
        config_json=payload.config_json,
    )
    return _serialize_workflow_response(session, workflow)


@router.post(
    "/inspirations/{inspiration_id}/workflow/template-groups",
    response_model=InspirationWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def apply_workflow_template_group_endpoint(
    inspiration_id: str,
    payload: ApplyWorkflowTemplateGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    workflow = apply_node_group_template_to_workflow(
        session,
        inspiration_id=inspiration_id,
        template_key=payload.template_key,
        position_x=payload.position_x,
        position_y=payload.position_y,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return _serialize_workflow_response(session, workflow)


@router.post(
    "/inspirations/{inspiration_id}/workflow/node-groups/duplicate",
    response_model=InspirationWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_workflow_node_group_endpoint(
    inspiration_id: str,
    payload: DuplicateWorkflowNodeGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    workflow = duplicate_workflow_node_group(
        session,
        inspiration_id=inspiration_id,
        node_ids=payload.node_ids,
        position_x=payload.position_x,
        position_y=payload.position_y,
        offset_x=payload.offset_x,
        offset_y=payload.offset_y,
    )
    return _serialize_workflow_response(session, workflow)


@router.get(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/sources",
    response_model=DeckSourceManifestResponse,
)
def get_workflow_deck_sources_endpoint(
    inspiration_id: str,
    node_id: str,
    include_transitive_inputs: bool | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_READ)),
) -> DeckSourceManifestResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=False,
    )
    manifest = build_deck_source_manifest(
        session,
        workflow=workflow,
        deck_node=node,
        include_transitive_inputs=include_transitive_inputs,
    )
    return serialize_deck_source_manifest(manifest)


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/refresh-sources",
    response_model=DeckSourceManifestResponse,
)
def refresh_workflow_deck_sources_endpoint(
    inspiration_id: str,
    node_id: str,
    include_transitive_inputs: bool | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckSourceManifestResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    manifest = refresh_deck_source_manifest(
        session,
        workflow=workflow,
        deck_node=node,
        include_transitive_inputs=include_transitive_inputs,
    )
    return serialize_deck_source_manifest(manifest)


@router.patch(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck",
    response_model=DeckResponse,
)
def rename_workflow_deck_endpoint(
    inspiration_id: str,
    node_id: str,
    payload: RenameDeckRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    deck = rename_deck_node_deck(
        session,
        workflow=workflow,
        deck_node=node,
        title=payload.title,
        speaker_notes_enabled=payload.speaker_notes_enabled,
    )
    return serialize_deck(deck, session=session)


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/outline",
    response_model=DeckResponse,
)
def create_or_replace_workflow_deck_outline_endpoint(
    inspiration_id: str,
    node_id: str,
    payload: DeckNodeOutlineRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    deck = create_or_replace_deck_node_outline(
        session,
        workflow=workflow,
        deck_node=node,
        resource_group_id=payload.resource_group_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        title=payload.title,
        max_slides=payload.max_slides,
        style_key=payload.style_key,
        source_input=payload.source_input,
        include_transitive_inputs=payload.include_transitive_inputs,
        planning_strategy=payload.planning_strategy,
        slide_count_mode=payload.slide_count_mode,
        group_by=payload.group_by,
        section_pages=payload.section_pages,
        per_group_image_cap=payload.per_group_image_cap,
        slide_context=[item.model_dump() for item in payload.slide_context],
        text_generation_config_mode=payload.text_generation_config_mode,
        text_generation_config_id=payload.text_generation_config_id,
        image_generation_config_mode=payload.image_generation_config_mode,
        image_generation_config_id=payload.image_generation_config_id,
    )
    return serialize_deck(deck, session=session)


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/style",
    response_model=DeckResponse,
)
def set_workflow_deck_style_endpoint(
    inspiration_id: str,
    node_id: str,
    payload: SetDeckStyleRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    deck = set_deck_node_style(session, workflow=workflow, deck_node=node, style_key=payload.style_key)
    return serialize_deck(deck, session=session)


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/sample",
    response_model=DeckResponse,
)
def generate_workflow_deck_sample_endpoint(
    inspiration_id: str,
    node_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    deck = generate_deck_node_sample(session, workflow=workflow, deck_node=node)
    return serialize_deck(deck, session=session)


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/generate",
    response_model=DeckResponse,
)
def generate_workflow_deck_endpoint(
    inspiration_id: str,
    node_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    deck = generate_deck_node_deck(session, workflow=workflow, deck_node=node)
    return serialize_deck(deck, session=session)


@router.put(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/slide-order",
    response_model=DeckResponse,
)
def reorder_workflow_deck_slides_endpoint(
    inspiration_id: str,
    node_id: str,
    payload: ReorderDeckSlidesRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    deck = reorder_deck_node_slides(session, workflow=workflow, deck_node=node, slide_ids=payload.slide_ids)
    return serialize_deck(deck, session=session)


@router.put(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/slides/{slide_id}",
    response_model=DeckSlideResponse,
)
def update_workflow_deck_slide_endpoint(
    inspiration_id: str,
    node_id: str,
    slide_id: str,
    payload: UpdateDeckSlideRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckSlideResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    slide = update_deck_node_slide(
        session,
        workflow=workflow,
        deck_node=node,
        slide_id=slide_id,
        title=payload.title,
        points=payload.points,
        speaker_notes=payload.speaker_notes,
    )
    return serialize_deck_slide(slide)


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/regenerate",
    response_model=DeckSlideResponse,
)
def regenerate_workflow_deck_slide_endpoint(
    inspiration_id: str,
    node_id: str,
    slide_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckSlideResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    return serialize_deck_slide(
        regenerate_deck_node_slide(session, workflow=workflow, deck_node=node, slide_id=slide_id)
    )


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/speaker-notes",
    response_model=DeckSlideResponse,
)
def generate_workflow_deck_slide_speaker_notes_endpoint(
    inspiration_id: str,
    node_id: str,
    slide_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckSlideResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    return serialize_deck_slide(
        generate_deck_node_slide_speaker_notes(
            session,
            workflow=workflow,
            deck_node=node,
            slide_id=slide_id,
            actor_user_id=current_user.id,
        )
    )


@router.post(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/material/enhance",
    response_model=DeckSlideResponse,
)
def enhance_workflow_deck_slide_material_endpoint(
    inspiration_id: str,
    node_id: str,
    slide_id: str,
    payload: EnhanceDeckSlideMaterialRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckSlideResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    return serialize_deck_slide(
        enhance_deck_node_slide_material(
            session,
            workflow=workflow,
            deck_node=node,
            slide_id=slide_id,
            prompt=payload.prompt,
        )
    )


@router.put(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/material",
    response_model=DeckSlideResponse,
)
def bind_workflow_deck_slide_material_endpoint(
    inspiration_id: str,
    node_id: str,
    slide_id: str,
    payload: DeckNodeSlideMaterialRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckSlideResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    slide = bind_deck_node_slide_material(
        session,
        workflow=workflow,
        deck_node=node,
        slide_id=slide_id,
        source_item_id=payload.source_item_id,
        target_slot=payload.target_slot,
        caption_source=payload.caption_source,
    )
    return serialize_deck_slide(slide)


@router.delete(
    "/inspirations/{inspiration_id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/material",
    response_model=DeckSlideResponse,
)
def unbind_workflow_deck_slide_material_endpoint(
    inspiration_id: str,
    node_id: str,
    slide_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckSlideResponse:
    workflow, node = _ensure_workflow_deck_node_context(
        session,
        inspiration_id=inspiration_id,
        node_id=node_id,
        current_user=current_user,
        mutate=True,
    )
    slide = unbind_deck_node_slide_material(
        session,
        workflow=workflow,
        deck_node=node,
        slide_id=slide_id,
    )
    return serialize_deck_slide(slide)


@router.patch("/workflow-nodes/{node_id}", response_model=InspirationWorkflowResponse)
def update_workflow_node_endpoint(
    node_id: str,
    payload: UpdateWorkflowNodeRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = update_workflow_node(
        session,
        node_id=node_id,
        title=payload.title,
        position_x=payload.position_x,
        position_y=payload.position_y,
        config_json=payload.config_json,
    )
    return _serialize_workflow_response(session, workflow)


@router.patch("/workflow-nodes/{node_id}/copy", response_model=InspirationWorkflowResponse)
def update_workflow_copy_set_endpoint(
    node_id: str,
    payload: UpdateWorkflowCopySetRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = update_workflow_copy_set(
        session,
        node_id=node_id,
        structured_payload=payload.structured_payload,
    )
    return _serialize_workflow_response(session, workflow)


@router.post("/workflow-nodes/{node_id}/tail-split-plan/apply", response_model=InspirationWorkflowResponse)
def apply_tail_split_plan_endpoint(
    node_id: str,
    payload: ApplyTailSplitPlanRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = apply_tail_split_plan(
        session,
        node_id=node_id,
        plan_id=payload.plan_id,
        item_ids=payload.item_ids,
        items=payload.items,
        image_generation_config=(
            TailSplitPlanImageGenerationConfig(**payload.image_generation_config.model_dump())
            if payload.image_generation_config is not None
            else None
        ),
        position_x=payload.position_x,
        position_y=payload.position_y,
        reuse_public_copy_node=payload.reuse_public_copy_node,
        reuse_public_reference_node=payload.reuse_public_reference_node,
        enqueue=lambda run_id: workflow_execution.enqueue_workflow_run(run_id),
    )
    return _serialize_workflow_response(session, workflow)


@router.post("/workflow-nodes/{node_id}/image", response_model=InspirationWorkflowResponse)
async def upload_workflow_node_image_endpoint(
    node_id: str,
    image: UploadFile = File(...),
    role: str | None = Form(default=None),
    label: str | None = Form(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    validated = await read_validated_image_upload(image, fallback_filename="workflow-image.bin")
    workflow = upload_workflow_node_image(
        session,
        node_id=node_id,
        image_bytes=validated.content,
        filename=validated.filename,
        content_type=validated.mime_type,
        role=role,
        label=label,
    )
    return _serialize_workflow_response(session, workflow)


@router.post("/workflow-nodes/{node_id}/document", response_model=InspirationWorkflowResponse)
async def upload_workflow_node_document_endpoint(
    node_id: str,
    document: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    validated = await read_validated_text_document_upload(document, fallback_filename="workflow-document.txt")
    workflow = upload_workflow_node_document(
        session,
        node_id=node_id,
        document_bytes=validated.content,
        filename=validated.filename,
        content_type=validated.mime_type,
        document_text=validated.text,
    )
    return _serialize_workflow_response(session, workflow)


@router.post("/workflow-nodes/{node_id}/image-source", response_model=InspirationWorkflowResponse)
def bind_workflow_node_image_endpoint(
    node_id: str,
    payload: BindWorkflowNodeImageRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    node = _ensure_node_access(session, node_id, current_user, mutate=True)
    _ensure_bind_image_source_usable(session, node, payload)
    workflow = bind_workflow_node_image(
        session,
        node_id=node_id,
        source_asset_id=payload.source_asset_id,
        poster_variant_id=payload.poster_variant_id,
    )
    return _serialize_workflow_response(session, workflow)


@router.delete("/workflow-nodes/{node_id}/image", response_model=InspirationWorkflowResponse)
def clear_workflow_node_image_endpoint(
    node_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = clear_workflow_node_image(session, node_id=node_id)
    return _serialize_workflow_response(session, workflow)


@router.post(
    "/inspirations/{inspiration_id}/workflow/edges",
    response_model=InspirationWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workflow_edge_endpoint(
    inspiration_id: str,
    payload: CreateWorkflowEdgeRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    workflow = create_workflow_edge(
        session,
        inspiration_id=inspiration_id,
        source_node_id=payload.source_node_id,
        target_node_id=payload.target_node_id,
        source_handle=payload.source_handle,
        target_handle=payload.target_handle,
    )
    return _serialize_workflow_response(session, workflow)


@router.delete("/workflow-edges/{edge_id}", response_model=InspirationWorkflowResponse)
def delete_workflow_edge_endpoint(
    edge_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_edge_access(session, edge_id, current_user, mutate=True)
    workflow = delete_workflow_edge(session, edge_id=edge_id)
    return _serialize_workflow_response(session, workflow)


@router.delete("/workflow-nodes/{node_id}", response_model=InspirationWorkflowResponse)
def delete_workflow_node_endpoint(
    node_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = delete_workflow_node(session, node_id=node_id)
    return _serialize_workflow_response(session, workflow)


@router.post("/inspirations/{inspiration_id}/workflow/run", response_model=InspirationWorkflowResponse)
def run_inspiration_workflow_endpoint(
    inspiration_id: str,
    payload: RunWorkflowRequest | None = None,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_GENERATE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    workflow = submit_inspiration_workflow_run(
        session,
        inspiration_id=inspiration_id,
        start_node_id=payload.start_node_id if payload else None,
        start_mode=payload.start_mode if payload else "from_node",
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return _serialize_workflow_response(session, workflow)


@router.post("/inspirations/{inspiration_id}/workflow/runs/{run_id}/cancel", response_model=InspirationWorkflowResponse)
def cancel_inspiration_workflow_run_endpoint(
    inspiration_id: str,
    run_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_GENERATE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True, require_usable=False)
    workflow = cancel_inspiration_workflow_run(session, inspiration_id=inspiration_id, run_id=run_id)
    return _serialize_workflow_response(session, workflow)


@router.post(
    "/inspirations/{inspiration_id}/workflow/runs/{run_id}/retry",
    response_model=InspirationWorkflowResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_inspiration_workflow_run_endpoint(
    inspiration_id: str,
    run_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_GENERATE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    workflow = retry_inspiration_workflow_run(
        session,
        inspiration_id=inspiration_id,
        run_id=run_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return _serialize_workflow_response(session, workflow)


@router.post(
    "/inspirations/{inspiration_id}/workflow/failed-nodes/retry",
    response_model=InspirationWorkflowResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_failed_workflow_nodes_endpoint(
    inspiration_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_GENERATE)),
) -> InspirationWorkflowResponse:
    _ensure_inspiration_access(session, inspiration_id, current_user, mutate=True)
    workflow = submit_failed_workflow_nodes_run(
        session,
        inspiration_id=inspiration_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return _serialize_workflow_response(session, workflow)
