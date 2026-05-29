from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from productflow_backend.application.moderation import ensure_resource_usable
from productflow_backend.application.product_workflows import (
    apply_node_group_template_to_workflow,
    apply_tail_split_plan,
    archive_canvas_template_category,
    archive_global_canvas_template,
    archive_user_canvas_template,
    bind_workflow_node_image,
    cancel_product_workflow_run,
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
    get_or_create_product_workflow,
    get_product_workflow_status,
    list_canvas_template_categories,
    list_canvas_templates,
    rename_user_canvas_template,
    restore_canvas_template_category,
    restore_global_canvas_template,
    restore_user_canvas_template,
    retry_product_workflow_run,
    submit_product_workflow_run,
    update_canvas_template_category,
    update_global_canvas_template,
    update_workflow_copy_set,
    update_workflow_node,
    upload_workflow_node_image,
)
from productflow_backend.domain.rbac import (
    API_GLOBAL_TEMPLATES_MANAGE,
    API_INSPIRATIONS_GENERATE,
    API_INSPIRATIONS_READ,
    API_INSPIRATIONS_WRITE,
)
from productflow_backend.infrastructure.db.models import (
    AuthUser,
    PosterVariant,
    Product,
    ProductWorkflow,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
)
from productflow_backend.presentation.deps import get_session, require_api_permission
from productflow_backend.presentation.schemas.product_workflows import (
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
    DuplicateWorkflowNodeGroupRequest,
    ProductWorkflowResponse,
    ProductWorkflowStatusResponse,
    RunWorkflowRequest,
    UpdateCanvasTemplateCategoryRequest,
    UpdateGlobalCanvasTemplateRequest,
    UpdateUserTemplateGroupRequest,
    UpdateWorkflowCopySetRequest,
    UpdateWorkflowNodeRequest,
    serialize_canvas_template_category,
    serialize_canvas_template_summary,
    serialize_product_workflow,
    serialize_product_workflow_status,
    serialize_user_canvas_template_summary,
)
from productflow_backend.presentation.upload_validation import read_validated_image_upload

router = APIRouter(
    prefix="/api",
    tags=["product-workflows"],
)


def _ensure_product_access(
    session: Session,
    product_id: str,
    current_user: AuthUser,
    *,
    mutate: bool,
    require_usable: bool = True,
) -> Product:
    product = session.get(Product, product_id)
    if product is None or (not current_user.is_admin and product.owner_user_id != current_user.id):
        raise HTTPException(status_code=404, detail="商品不存在")
    if mutate and current_user.is_admin and product.owner_user_id != current_user.id:
        raise HTTPException(status_code=400, detail="管理员不能直接编辑其他用户资源")
    if mutate and require_usable:
        ensure_resource_usable(product)
    return product


def _ensure_product_workflow_read_does_not_create_for_restricted_product(
    session: Session,
    product: Product,
    current_user: AuthUser,
) -> None:
    restricted_read = (current_user.is_admin and product.owner_user_id != current_user.id) or not product.enabled
    if not restricted_read:
        return
    workflow_id = session.scalar(
        select(ProductWorkflow.id).where(ProductWorkflow.product_id == product.id, ProductWorkflow.active.is_(True))
    )
    if workflow_id is None:
        raise HTTPException(status_code=404, detail="工作流不存在")


def _ensure_node_access(session: Session, node_id: str, current_user: AuthUser, *, mutate: bool) -> WorkflowNode:
    node = session.get(WorkflowNode, node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="工作流节点不存在")
    workflow = session.get(ProductWorkflow, node.workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="工作流不存在")
    _ensure_product_access(session, workflow.product_id, current_user, mutate=mutate)
    return node


def _ensure_edge_access(session: Session, edge_id: str, current_user: AuthUser, *, mutate: bool) -> WorkflowEdge:
    edge = session.get(WorkflowEdge, edge_id)
    if edge is None:
        raise HTTPException(status_code=404, detail="工作流连线不存在")
    workflow = session.get(ProductWorkflow, edge.workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="工作流不存在")
    _ensure_product_access(session, workflow.product_id, current_user, mutate=mutate)
    return edge


def _ensure_bind_image_source_usable(
    session: Session,
    node: WorkflowNode,
    payload: BindWorkflowNodeImageRequest,
) -> None:
    workflow = session.get(ProductWorkflow, node.workflow_id)
    if workflow is None:
        raise HTTPException(status_code=404, detail="工作流不存在")
    if payload.source_asset_id:
        asset = session.get(SourceAsset, payload.source_asset_id)
        if asset is not None and asset.product_id == workflow.product_id:
            ensure_resource_usable(asset)
    if payload.poster_variant_id:
        poster = session.get(PosterVariant, payload.poster_variant_id)
        if poster is not None and poster.product_id == workflow.product_id:
            ensure_resource_usable(poster)


@router.get("/products/{product_id}/workflow", response_model=ProductWorkflowResponse)
def get_product_workflow_endpoint(
    product_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> ProductWorkflowResponse:
    product = _ensure_product_access(session, product_id, current_user, mutate=False)
    _ensure_product_workflow_read_does_not_create_for_restricted_product(session, product, current_user)
    workflow = get_or_create_product_workflow(session, product_id)
    return serialize_product_workflow(workflow)


@router.get("/products/{product_id}/workflow/status", response_model=ProductWorkflowStatusResponse)
def get_product_workflow_status_endpoint(
    product_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> ProductWorkflowStatusResponse:
    _ensure_product_access(session, product_id, current_user, mutate=False)
    workflow = get_product_workflow_status(session, product_id)
    return serialize_product_workflow_status(workflow)


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
    )
    return serialize_user_canvas_template_summary(template)


@router.patch("/workflow/global-canvas-templates/{template_id}", response_model=CanvasTemplateSummaryResponse)
def update_global_canvas_template_endpoint(
    template_id: str,
    payload: UpdateGlobalCanvasTemplateRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_GLOBAL_TEMPLATES_MANAGE)),
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
    "/products/{product_id}/workflow/user-template-groups",
    response_model=CanvasTemplateSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_template_group_endpoint(
    product_id: str,
    payload: CreateUserTemplateGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateSummaryResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    template = create_user_canvas_template_from_workflow_nodes(
        session,
        product_id=product_id,
        title=payload.title,
        description=payload.description,
        node_ids=payload.node_ids,
        category_id=payload.category_id,
        owner_user_id=current_user.id,
    )
    return serialize_user_canvas_template_summary(template)


@router.post(
    "/products/{product_id}/workflow/user-canvas-templates",
    response_model=CanvasTemplateSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_canvas_template_endpoint(
    product_id: str,
    payload: CreateUserCanvasTemplateRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CanvasTemplateSummaryResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    template = create_user_canvas_template_from_active_workflow(
        session,
        product_id=product_id,
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
    "/products/{product_id}/workflow/nodes",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workflow_node_endpoint(
    product_id: str,
    payload: CreateWorkflowNodeRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    workflow = create_workflow_node(
        session,
        product_id=product_id,
        node_type=payload.node_type,
        title=payload.title,
        position_x=payload.position_x,
        position_y=payload.position_y,
        config_json=payload.config_json,
    )
    return serialize_product_workflow(workflow)


@router.post(
    "/products/{product_id}/workflow/template-groups",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def apply_workflow_template_group_endpoint(
    product_id: str,
    payload: ApplyWorkflowTemplateGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    workflow = apply_node_group_template_to_workflow(
        session,
        product_id=product_id,
        template_key=payload.template_key,
        position_x=payload.position_x,
        position_y=payload.position_y,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_product_workflow(workflow)


@router.post(
    "/products/{product_id}/workflow/node-groups/duplicate",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_workflow_node_group_endpoint(
    product_id: str,
    payload: DuplicateWorkflowNodeGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    workflow = duplicate_workflow_node_group(
        session,
        product_id=product_id,
        node_ids=payload.node_ids,
        position_x=payload.position_x,
        position_y=payload.position_y,
        offset_x=payload.offset_x,
        offset_y=payload.offset_y,
    )
    return serialize_product_workflow(workflow)


@router.patch("/workflow-nodes/{node_id}", response_model=ProductWorkflowResponse)
def update_workflow_node_endpoint(
    node_id: str,
    payload: UpdateWorkflowNodeRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = update_workflow_node(
        session,
        node_id=node_id,
        title=payload.title,
        position_x=payload.position_x,
        position_y=payload.position_y,
        config_json=payload.config_json,
    )
    return serialize_product_workflow(workflow)


@router.patch("/workflow-nodes/{node_id}/copy", response_model=ProductWorkflowResponse)
def update_workflow_copy_set_endpoint(
    node_id: str,
    payload: UpdateWorkflowCopySetRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = update_workflow_copy_set(
        session,
        node_id=node_id,
        structured_payload=payload.structured_payload,
    )
    return serialize_product_workflow(workflow)


@router.post("/workflow-nodes/{node_id}/tail-split-plan/apply", response_model=ProductWorkflowResponse)
def apply_tail_split_plan_endpoint(
    node_id: str,
    payload: ApplyTailSplitPlanRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = apply_tail_split_plan(
        session,
        node_id=node_id,
        plan_id=payload.plan_id,
        item_ids=payload.item_ids,
        position_x=payload.position_x,
        position_y=payload.position_y,
    )
    return serialize_product_workflow(workflow)


@router.post("/workflow-nodes/{node_id}/image", response_model=ProductWorkflowResponse)
async def upload_workflow_node_image_endpoint(
    node_id: str,
    image: UploadFile = File(...),
    role: str | None = Form(default=None),
    label: str | None = Form(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
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
    return serialize_product_workflow(workflow)


@router.post("/workflow-nodes/{node_id}/image-source", response_model=ProductWorkflowResponse)
def bind_workflow_node_image_endpoint(
    node_id: str,
    payload: BindWorkflowNodeImageRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    node = _ensure_node_access(session, node_id, current_user, mutate=True)
    _ensure_bind_image_source_usable(session, node, payload)
    workflow = bind_workflow_node_image(
        session,
        node_id=node_id,
        source_asset_id=payload.source_asset_id,
        poster_variant_id=payload.poster_variant_id,
    )
    return serialize_product_workflow(workflow)


@router.post(
    "/products/{product_id}/workflow/edges",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workflow_edge_endpoint(
    product_id: str,
    payload: CreateWorkflowEdgeRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    workflow = create_workflow_edge(
        session,
        product_id=product_id,
        source_node_id=payload.source_node_id,
        target_node_id=payload.target_node_id,
        source_handle=payload.source_handle,
        target_handle=payload.target_handle,
    )
    return serialize_product_workflow(workflow)


@router.delete("/workflow-edges/{edge_id}", response_model=ProductWorkflowResponse)
def delete_workflow_edge_endpoint(
    edge_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_edge_access(session, edge_id, current_user, mutate=True)
    workflow = delete_workflow_edge(session, edge_id=edge_id)
    return serialize_product_workflow(workflow)


@router.delete("/workflow-nodes/{node_id}", response_model=ProductWorkflowResponse)
def delete_workflow_node_endpoint(
    node_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductWorkflowResponse:
    _ensure_node_access(session, node_id, current_user, mutate=True)
    workflow = delete_workflow_node(session, node_id=node_id)
    return serialize_product_workflow(workflow)


@router.post("/products/{product_id}/workflow/run", response_model=ProductWorkflowResponse)
def run_product_workflow_endpoint(
    product_id: str,
    payload: RunWorkflowRequest | None = None,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_GENERATE)),
) -> ProductWorkflowResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    workflow = submit_product_workflow_run(
        session,
        product_id=product_id,
        start_node_id=payload.start_node_id if payload else None,
    )
    return serialize_product_workflow(workflow)


@router.post("/products/{product_id}/workflow/runs/{run_id}/cancel", response_model=ProductWorkflowResponse)
def cancel_product_workflow_run_endpoint(
    product_id: str,
    run_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_GENERATE)),
) -> ProductWorkflowResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True, require_usable=False)
    workflow = cancel_product_workflow_run(session, product_id=product_id, run_id=run_id)
    return serialize_product_workflow(workflow)


@router.post(
    "/products/{product_id}/workflow/runs/{run_id}/retry",
    response_model=ProductWorkflowResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_product_workflow_run_endpoint(
    product_id: str,
    run_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_GENERATE)),
) -> ProductWorkflowResponse:
    _ensure_product_access(session, product_id, current_user, mutate=True)
    workflow = retry_product_workflow_run(session, product_id=product_id, run_id=run_id)
    return serialize_product_workflow(workflow)
