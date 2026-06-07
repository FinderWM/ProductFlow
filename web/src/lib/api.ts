import type {
  ApplyTailSplitPlanInput,
  ApplyWorkflowTemplateGroupInput,
  CanvasTemplateCategoryListResponse,
  CanvasTemplateScope,
  CanvasTemplateSummary,
  CanvasTemplateListResponse,
  ConfigResponse,
  ConfigUpdateRequest,
  CreateCanvasTemplateCategoryInput,
  CreateGlobalCanvasTemplateInput,
  CopySet,
  CopySetUpdateRequest,
  CopyUserTemplateToGlobalInput,
  CreateProductInput,
  CreateRoleRequest,
  CreateTrustedUserRequest,
  CreateUserCanvasTemplateInput,
  DuplicateWorkflowNodeGroupInput,
  GalleryEntry,
  GalleryEntryListResponse,
  GenerationConfig,
  GenerationConfigCreateRequest,
  GenerationConfigOption,
  GenerationConfigSelectionMode,
  GenerationResourceGroup,
  GenerationResourceGroupCreateRequest,
  GenerationResourceGroupTag,
  GenerationResourceGroupUpdateRequest,
  GenerationConfigStatusSummary,
  GenerationConfigUpdateRequest,
  GenerationQueueOverview,
  CreateUserTemplateGroupInput,
  ImageSessionDetail,
  ImageSessionListResponse,
  ImageSessionStatus,
  ImageToolOptions,
  ProductDetail,
  ProductHistory,
  ProductInitialWorkflowEntry,
  ProviderBinding,
  ProviderBindingUpdateRequest,
  ProviderConfigResponse,
  ProviderModelListResponse,
  ProviderProfile,
  ProviderProfileCreateRequest,
  ProviderProfileUpdateRequest,
  ProductWorkflow,
  ProductWorkflowStatus,
  WorkflowRunStartMode,
  ProductWritebackResponse,
  ProductListResponse,
  ReviewUserTemplateGroupInput,
  RuntimeConfig,
  RbacPermissionCatalog,
  RbacRole,
  RbacRolePermissions,
  RbacUser,
  RbacUserListResponse,
  SettingsExportPayload,
  SettingsImportCommitResponse,
  SettingsImportPreviewResponse,
  SessionState,
  TextGenerationConfigTestRequest,
  TextGenerationConfigTestResponse,
  UpdateCanvasTemplateCategoryInput,
  UpdateGlobalCanvasTemplateInput,
  UpdateUserTemplateGroupInput,
  UserUsageStatsResponse,
  UserGenerationResourceGroupGrants,
} from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

function toApiUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${API_BASE_URL}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(toApiUrl(path), {
    credentials: "include",
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
    ...init,
  });

  if (!response.ok) {
    let detail = "请求失败";
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail ?? detail;
    } catch {
      detail = response.statusText || detail;
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  toApiUrl,
  getSessionState(): Promise<SessionState> {
    return request<SessionState>("/api/auth/session");
  },
  createSession(username: string, password: string): Promise<{ ok: boolean }> {
    return request("/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  login(username: string, password: string): Promise<{ ok: boolean }> {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  setPassword(username: string, password: string, setupToken: string): Promise<{ ok: boolean }> {
    return request("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ username, password, setup_token: setupToken }),
    });
  },
  destroySession(): Promise<{ ok: boolean }> {
    return request("/api/auth/session", { method: "DELETE" });
  },
  listRbacUsers(input?: {
    page?: number;
    page_size?: number;
    username?: string;
    role_id?: string;
  }): Promise<RbacUserListResponse> {
    const params = new URLSearchParams({
      page: String(input?.page ?? 1),
      page_size: String(input?.page_size ?? 20),
    });
    if (input?.username) {
      params.set("username", input.username);
    }
    if (input?.role_id) {
      params.set("role_id", input.role_id);
    }
    return request(`/api/rbac/users?${params.toString()}`);
  },
  createRbacUser(payload: CreateTrustedUserRequest): Promise<RbacUser> {
    return request("/api/rbac/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateRbacUser(userId: string, payload: { enabled: boolean }): Promise<RbacUser> {
    return request(`/api/rbac/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  resetRbacUserPassword(userId: string): Promise<RbacUser> {
    return request(`/api/rbac/users/${userId}/reset-password`, { method: "POST" });
  },
  listRbacRoles(): Promise<RbacRole[]> {
    return request("/api/rbac/roles");
  },
  createRbacRole(payload: CreateRoleRequest): Promise<RbacRole> {
    return request("/api/rbac/roles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  listRbacPermissionCatalog(): Promise<RbacPermissionCatalog> {
    return request("/api/rbac/permissions");
  },
  getRbacRolePermissions(roleId: string): Promise<RbacRolePermissions> {
    return request(`/api/rbac/roles/${roleId}/permissions`);
  },
  updateRbacRolePermissions(roleId: string, payload: Omit<RbacRolePermissions, "role_id">): Promise<RbacRolePermissions> {
    return request(`/api/rbac/roles/${roleId}/permissions`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  getUserGenerationResourceGroupGrants(userId: string): Promise<UserGenerationResourceGroupGrants> {
    return request(`/api/rbac/users/${encodeURIComponent(userId)}/generation-resource-groups`);
  },
  updateUserGenerationResourceGroupGrants(
    userId: string,
    payload: { resource_group_ids: string[] },
  ): Promise<UserGenerationResourceGroupGrants> {
    return request(`/api/rbac/users/${encodeURIComponent(userId)}/generation-resource-groups`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  listProducts(input: {
    resource_group_id: string;
    page?: number;
    page_size?: number;
    title?: string;
    updated_from?: string;
    updated_to?: string;
    owner_user_id?: string;
  }): Promise<ProductListResponse> {
    const params = new URLSearchParams({
      resource_group_id: input.resource_group_id,
      page: String(input.page ?? 1),
      page_size: String(input.page_size ?? 20),
    });
    if (input.title) {
      params.set("title", input.title);
    }
    if (input.updated_from) {
      params.set("updated_from", input.updated_from);
    }
    if (input.updated_to) {
      params.set("updated_to", input.updated_to);
    }
    if (input.owner_user_id) {
      params.set("owner_user_id", input.owner_user_id);
    }
    return request(`/api/products?${params.toString()}`);
  },
  getProduct(productId: string): Promise<ProductDetail> {
    return request(`/api/products/${productId}`);
  },
  deleteProduct(productId: string): Promise<void> {
    return request(`/api/products/${productId}`, { method: "DELETE" });
  },
  getProductHistory(productId: string, input?: { resource_group_id?: string | null }): Promise<ProductHistory> {
    const params = new URLSearchParams();
    if (input?.resource_group_id) {
      params.set("resource_group_id", input.resource_group_id);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/products/${productId}/history${suffix}`);
  },
  getConfig(): Promise<ConfigResponse> {
    return request("/api/settings");
  },
  getProviderConfig(): Promise<ProviderConfigResponse> {
    return request("/api/settings/provider-config");
  },
  listProviderModels(profileId: string, providerKind: string): Promise<ProviderModelListResponse> {
    return request(
      `/api/settings/provider-profiles/${encodeURIComponent(profileId)}/models?provider_kind=${encodeURIComponent(
        providerKind,
      )}`,
    );
  },
  createProviderProfile(payload: ProviderProfileCreateRequest): Promise<ProviderProfile> {
    return request("/api/settings/provider-profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateProviderProfile(profileId: string, payload: ProviderProfileUpdateRequest): Promise<ProviderProfile> {
    return request(`/api/settings/provider-profiles/${profileId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  archiveProviderProfile(profileId: string): Promise<ProviderProfile> {
    return request(`/api/settings/provider-profiles/${profileId}`, { method: "DELETE" });
  },
  updateProviderBinding(purpose: "text" | "image", payload: ProviderBindingUpdateRequest): Promise<ProviderBinding> {
    return request(`/api/settings/provider-bindings/${purpose}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  getGenerationConfigStatus(input?: { start_date?: string; end_date?: string }): Promise<GenerationConfigStatusSummary> {
    const params = new URLSearchParams();
    if (input?.start_date) {
      params.set("start_date", input.start_date);
    }
    if (input?.end_date) {
      params.set("end_date", input.end_date);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/settings/generation-config-status${suffix}`);
  },
  getUsageStats(input?: {
    start_date?: string;
    end_date?: string;
    user_id?: string;
    username?: string;
  }): Promise<UserUsageStatsResponse> {
    const params = new URLSearchParams();
    if (input?.start_date) {
      params.set("start_date", input.start_date);
    }
    if (input?.end_date) {
      params.set("end_date", input.end_date);
    }
    if (input?.user_id) {
      params.set("user_id", input.user_id);
    }
    if (input?.username) {
      params.set("username", input.username);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/usage-stats${suffix}`);
  },
  listGenerationConfigs(): Promise<GenerationConfig[]> {
    return request("/api/settings/generation-configs");
  },
  listGenerationConfigOptions(): Promise<GenerationConfigOption[]> {
    return request("/api/settings/generation-config-options");
  },
  listGenerationResourceGroups(): Promise<GenerationResourceGroup[]> {
    return request("/api/settings/generation-resource-groups");
  },
  listMyGenerationResourceGroups(): Promise<GenerationResourceGroup[]> {
    return request("/api/settings/my-generation-resource-groups");
  },
  createGenerationResourceGroup(payload: GenerationResourceGroupCreateRequest): Promise<GenerationResourceGroup> {
    return request("/api/settings/generation-resource-groups", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateGenerationResourceGroup(
    resourceGroupId: string,
    payload: GenerationResourceGroupUpdateRequest,
  ): Promise<GenerationResourceGroup> {
    return request(`/api/settings/generation-resource-groups/${encodeURIComponent(resourceGroupId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  archiveGenerationResourceGroup(resourceGroupId: string): Promise<GenerationResourceGroup> {
    return request(`/api/settings/generation-resource-groups/${encodeURIComponent(resourceGroupId)}`, {
      method: "DELETE",
    });
  },
  createGenerationConfig(payload: GenerationConfigCreateRequest): Promise<GenerationConfig> {
    return request("/api/settings/generation-configs", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateGenerationConfig(configId: string, payload: GenerationConfigUpdateRequest): Promise<GenerationConfig> {
    return request(`/api/settings/generation-configs/${encodeURIComponent(configId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  archiveGenerationConfig(configId: string): Promise<GenerationConfig> {
    return request(`/api/settings/generation-configs/${encodeURIComponent(configId)}`, { method: "DELETE" });
  },
  testTextGenerationConfig(payload: TextGenerationConfigTestRequest): Promise<TextGenerationConfigTestResponse> {
    return request("/api/settings/generation-configs/test-text", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getRuntimeConfig(): Promise<RuntimeConfig> {
    return request("/api/settings/runtime");
  },
  getGenerationQueueOverview(): Promise<GenerationQueueOverview> {
    return request("/api/generation-queue");
  },
  updateConfig(payload: ConfigUpdateRequest): Promise<ConfigResponse> {
    return request("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  exportSettings(): Promise<SettingsExportPayload> {
    return request("/api/settings/export");
  },
  previewSettingsImport(payload: SettingsExportPayload): Promise<SettingsImportPreviewResponse> {
    return request("/api/settings/import/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  importSettings(payload: SettingsExportPayload): Promise<SettingsImportCommitResponse> {
    return request("/api/settings/import", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async createProduct(input: CreateProductInput): Promise<ProductDetail> {
    const formData = new FormData();
    formData.set("name", input.name);
    formData.set("resource_group_id", input.resource_group_id);
    if (input.file) {
      formData.set("image", input.file);
    }
    input.referenceFiles?.forEach((referenceFile) => {
      formData.append("reference_images", referenceFile);
    });
    if (input.category) {
      formData.set("category", input.category);
    }
    if (input.price) {
      formData.set("price", input.price);
    }
    if (input.source_note) {
      formData.set("source_note", input.source_note);
    }
    if (input.long_text) {
      formData.set("long_text", input.long_text);
    }
    if (input.dynamic_fields !== undefined) {
      formData.set("dynamic_fields_json", JSON.stringify(input.dynamic_fields));
    }
    if (input.contextDocumentFile) {
      formData.set("context_document", input.contextDocumentFile);
    }
    if (input.canvas_template_key !== undefined) {
      formData.set("canvas_template_key", input.canvas_template_key);
    }
    if (input.initial_workflow_entry !== undefined) {
      formData.set("initial_workflow_entry", input.initial_workflow_entry);
    }
    if (input.entry_text) {
      formData.set("entry_text", input.entry_text);
    }
    return request("/api/products", {
      method: "POST",
      body: formData,
    });
  },
  async addReferenceImages(productId: string, files: File[]): Promise<ProductDetail> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("reference_images", file);
    });
    return request(`/api/products/${productId}/reference-images`, {
      method: "POST",
      body: formData,
    });
  },
  deleteSourceAsset(assetId: string): Promise<ProductDetail> {
    return request(`/api/source-assets/${assetId}`, { method: "DELETE" });
  },
  updateCopySet(copySetId: string, payload: CopySetUpdateRequest): Promise<CopySet> {
    return request(`/api/copy-sets/${copySetId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  confirmCopySet(copySetId: string): Promise<CopySet> {
    return request(`/api/copy-sets/${copySetId}/confirm`, { method: "POST" });
  },
  listImageSessions(productId?: string): Promise<ImageSessionListResponse> {
    const query = productId ? `?product_id=${encodeURIComponent(productId)}` : "";
    return request(`/api/image-sessions${query}`);
  },
  createImageSession(input: { product_id?: string; title?: string }): Promise<ImageSessionDetail> {
    return request("/api/image-sessions", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getImageSession(sessionId: string): Promise<ImageSessionDetail> {
    return request(`/api/image-sessions/${sessionId}`);
  },
  getImageSessionStatus(sessionId: string): Promise<ImageSessionStatus> {
    return request(`/api/image-sessions/${sessionId}/status`);
  },
  updateImageSession(sessionId: string, input: { title: string }): Promise<ImageSessionDetail> {
    return request(`/api/image-sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  deleteImageSession(sessionId: string): Promise<void> {
    return request(`/api/image-sessions/${sessionId}`, { method: "DELETE" });
  },
  async addImageSessionReferenceImages(sessionId: string, files: File[]): Promise<ImageSessionDetail> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("reference_images", file);
    });
    return request(`/api/image-sessions/${sessionId}/reference-images`, {
      method: "POST",
      body: formData,
    });
  },
  deleteImageSessionReferenceImage(sessionId: string, assetId: string): Promise<ImageSessionDetail> {
    return request(`/api/image-sessions/${sessionId}/reference-images/${assetId}`, { method: "DELETE" });
  },
  generateImageSessionRound(
    sessionId: string,
    input: {
      prompt: string;
      size: string;
      base_asset_id?: string | null;
      selected_reference_asset_ids?: string[];
      generation_count?: number;
      tool_options?: ImageToolOptions | null;
      resource_group_id: string;
      generation_config_mode?: GenerationConfigSelectionMode;
      generation_config_id?: string | null;
    },
  ): Promise<ImageSessionDetail> {
    return request(`/api/image-sessions/${sessionId}/generate`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  polishImageSessionPrompt(input: {
    prompt: string;
    resource_group_id: string;
    generation_config_mode?: GenerationConfigSelectionMode;
    generation_config_id?: string | null;
  }): Promise<{
    prompt: string;
    model_name: string;
    generation_config_id: string;
    resource_group_id: string;
    resource_group: GenerationResourceGroupTag;
  }> {
    return request("/api/image-sessions/prompt-polish", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  retryImageSessionGenerationTask(sessionId: string, taskId: string): Promise<ImageSessionDetail> {
    return request(`/api/image-sessions/${sessionId}/generation-tasks/${taskId}/retry`, { method: "POST" });
  },
  cancelImageSessionGenerationTask(sessionId: string, taskId: string): Promise<ImageSessionDetail> {
    return request(`/api/image-sessions/${sessionId}/generation-tasks/${taskId}/cancel`, { method: "POST" });
  },
  attachImageSessionAssetToProduct(
    sessionId: string,
    assetId: string,
    input: { product_id?: string; target: "reference" | "main_source" },
  ): Promise<ProductWritebackResponse> {
    return request(`/api/image-sessions/${sessionId}/assets/${assetId}/attach-to-product`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  listGalleryEntries(input: { resource_group_id: string }): Promise<GalleryEntryListResponse> {
    const params = new URLSearchParams({ resource_group_id: input.resource_group_id });
    return request(`/api/gallery?${params.toString()}`);
  },
  saveGalleryEntry(imageSessionAssetId: string): Promise<GalleryEntry> {
    return request("/api/gallery", {
      method: "POST",
      body: JSON.stringify({ image_session_asset_id: imageSessionAssetId }),
    });
  },
  getProductWorkflow(productId: string): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow`);
  },
  getProductWorkflowStatus(productId: string): Promise<ProductWorkflowStatus> {
    return request(`/api/products/${productId}/workflow/status`);
  },
  listCanvasTemplates(input?: {
    search?: string;
    category_id?: string;
    scope?: CanvasTemplateScope;
    initial_workflow_entry?: ProductInitialWorkflowEntry;
  }): Promise<CanvasTemplateListResponse> {
    const params = new URLSearchParams();
    if (input?.search) {
      params.set("search", input.search);
    }
    if (input?.category_id) {
      params.set("category_id", input.category_id);
    }
    if (input?.scope) {
      params.set("scope", input.scope);
    }
    if (input?.initial_workflow_entry) {
      params.set("initial_workflow_entry", input.initial_workflow_entry);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/workflow/canvas-templates${suffix}`);
  },
  listManageCanvasTemplates(input?: {
    search?: string;
    category_id?: string;
    scope?: CanvasTemplateScope;
    initial_workflow_entry?: ProductInitialWorkflowEntry;
  }): Promise<CanvasTemplateListResponse> {
    const params = new URLSearchParams();
    if (input?.search) {
      params.set("search", input.search);
    }
    if (input?.category_id) {
      params.set("category_id", input.category_id);
    }
    if (input?.scope) {
      params.set("scope", input.scope);
    }
    if (input?.initial_workflow_entry) {
      params.set("initial_workflow_entry", input.initial_workflow_entry);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/workflow/canvas-templates/manage${suffix}`);
  },
  listCanvasTemplateCategories(input?: {
    search?: string;
    scope?: CanvasTemplateScope;
  }): Promise<CanvasTemplateCategoryListResponse> {
    const params = new URLSearchParams();
    if (input?.search) {
      params.set("search", input.search);
    }
    if (input?.scope) {
      params.set("scope", input.scope);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/workflow/canvas-template-categories${suffix}`);
  },
  listManageCanvasTemplateCategories(input?: {
    search?: string;
    scope?: CanvasTemplateScope;
  }): Promise<CanvasTemplateCategoryListResponse> {
    const params = new URLSearchParams();
    if (input?.search) {
      params.set("search", input.search);
    }
    if (input?.scope) {
      params.set("scope", input.scope);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/workflow/canvas-template-categories/manage${suffix}`);
  },
  createCanvasTemplateCategory(scope: CanvasTemplateScope, input: CreateCanvasTemplateCategoryInput) {
    return request<CanvasTemplateCategoryListResponse["items"][number]>(
      `/api/workflow/${scope === "global" ? "global" : "user"}-template-categories`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
  updateCanvasTemplateCategory(
    scope: CanvasTemplateScope,
    categoryId: string,
    input: UpdateCanvasTemplateCategoryInput,
  ) {
    return request<CanvasTemplateCategoryListResponse["items"][number]>(
      `/api/workflow/${scope === "global" ? "global" : "user"}-template-categories/${encodeURIComponent(categoryId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  },
  archiveCanvasTemplateCategory(scope: CanvasTemplateScope, categoryId: string): Promise<void> {
    return request(
      `/api/workflow/${scope === "global" ? "global" : "user"}-template-categories/${encodeURIComponent(categoryId)}`,
      {
        method: "DELETE",
      },
    );
  },
  createGlobalCanvasTemplate(input: CreateGlobalCanvasTemplateInput): Promise<CanvasTemplateSummary> {
    return request("/api/workflow/global-canvas-templates", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateGlobalCanvasTemplate(templateId: string, input: UpdateGlobalCanvasTemplateInput): Promise<CanvasTemplateSummary> {
    return request(`/api/workflow/global-canvas-templates/${encodeURIComponent(templateId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  archiveGlobalCanvasTemplate(templateId: string): Promise<void> {
    return request(`/api/workflow/global-canvas-templates/${encodeURIComponent(templateId)}`, {
      method: "DELETE",
    });
  },
  applyWorkflowTemplateGroup(productId: string, input: ApplyWorkflowTemplateGroupInput): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/template-groups`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  duplicateWorkflowNodeGroup(
    productId: string,
    input: DuplicateWorkflowNodeGroupInput,
  ): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/node-groups/duplicate`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  createUserTemplateGroup(productId: string, input: CreateUserTemplateGroupInput): Promise<CanvasTemplateSummary> {
    return request(`/api/products/${productId}/workflow/user-template-groups`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  createUserCanvasTemplate(
    productId: string,
    input: CreateUserCanvasTemplateInput,
  ): Promise<CanvasTemplateSummary> {
    return request(`/api/products/${productId}/workflow/user-canvas-templates`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateUserTemplateGroup(templateId: string, input: UpdateUserTemplateGroupInput): Promise<CanvasTemplateSummary> {
    return request(`/api/workflow/user-template-groups/${templateId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  reviewUserTemplateGroup(
    templateId: string,
    input: ReviewUserTemplateGroupInput,
  ): Promise<CanvasTemplateSummary> {
    return request(`/api/workflow/user-template-groups/${templateId}/review`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  copyUserTemplateToGlobal(
    templateId: string,
    input: CopyUserTemplateToGlobalInput,
  ): Promise<CanvasTemplateSummary> {
    return request(`/api/workflow/user-template-groups/${templateId}/copy-to-global`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  archiveUserTemplateGroup(templateId: string): Promise<void> {
    return request(`/api/workflow/user-template-groups/${templateId}`, {
      method: "DELETE",
    });
  },
  createWorkflowNode(
    productId: string,
    input: {
      node_type: ProductWorkflow["nodes"][number]["node_type"];
      title: string;
      position_x: number;
      position_y: number;
      config_json: Record<string, unknown>;
    },
  ): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/nodes`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateWorkflowNode(
    nodeId: string,
    input: {
      title?: string;
      position_x?: number;
      position_y?: number;
      config_json?: Record<string, unknown>;
    },
  ): Promise<ProductWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  updateWorkflowNodeCopy(nodeId: string, payload: CopySetUpdateRequest): Promise<ProductWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/copy`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  applyTailSplitPlan(nodeId: string, payload: ApplyTailSplitPlanInput): Promise<ProductWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/tail-split-plan/apply`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async uploadWorkflowNodeImage(
    nodeId: string,
    input: { file: File; role?: string; label?: string },
  ): Promise<ProductWorkflow> {
    const formData = new FormData();
    formData.set("image", input.file);
    if (input.role) {
      formData.set("role", input.role);
    }
    if (input.label) {
      formData.set("label", input.label);
    }
    return request(`/api/workflow-nodes/${nodeId}/image`, {
      method: "POST",
      body: formData,
    });
  },
  async uploadWorkflowNodeDocument(nodeId: string, input: { file: File }): Promise<ProductWorkflow> {
    const formData = new FormData();
    formData.set("document", input.file);
    return request(`/api/workflow-nodes/${nodeId}/document`, {
      method: "POST",
      body: formData,
    });
  },
  bindWorkflowNodeImage(
    nodeId: string,
    input: { source_asset_id?: string; poster_variant_id?: string },
  ): Promise<ProductWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/image-source`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  clearWorkflowNodeImage(nodeId: string): Promise<ProductWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/image`, { method: "DELETE" });
  },
  createWorkflowEdge(
    productId: string,
    input: { source_node_id: string; target_node_id: string; source_handle?: string; target_handle?: string },
  ): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/edges`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  deleteWorkflowEdge(edgeId: string): Promise<ProductWorkflow> {
    return request(`/api/workflow-edges/${edgeId}`, { method: "DELETE" });
  },
  deleteWorkflowNode(nodeId: string): Promise<ProductWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}`, { method: "DELETE" });
  },
  runProductWorkflow(
    productId: string,
    input?: { start_node_id?: string; start_mode?: WorkflowRunStartMode },
  ): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/run`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
  },
  cancelProductWorkflowRun(productId: string, runId: string): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/runs/${runId}/cancel`, { method: "POST" });
  },
  retryProductWorkflowRun(productId: string, runId: string): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/runs/${runId}/retry`, { method: "POST" });
  },
  retryFailedWorkflowNodes(productId: string): Promise<ProductWorkflow> {
    return request(`/api/products/${productId}/workflow/failed-nodes/retry`, { method: "POST" });
  },
};
