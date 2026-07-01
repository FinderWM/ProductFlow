import type {
  ApplyTailSplitPlanInput,
  ApplyWorkflowTemplateGroupInput,
  CanvasTemplateCategoryListResponse,
  CanvasTemplateScope,
  CanvasTemplateSummary,
  Deck,
  DeckSlide,
  DeckSourceManifest,
  DeckStyleOption,
  DeckSummary,
  CanvasTemplateListResponse,
  ConfigResponse,
  ConfigUpdateRequest,
  CurrentWeather,
  CreateEnhanceJobInput,
  CreateCanvasTemplateCategoryInput,
  CreateGlobalCanvasTemplateInput,
  CopySet,
  CopySetUpdateRequest,
  CopyUserTemplateToGlobalInput,
  CreateInspirationInput,
  CreateRoleRequest,
  CreateTrustedUserRequest,
  CreateUserCanvasTemplateInput,
  DuplicateWorkflowNodeGroupInput,
  GalleryEntry,
  GalleryEntryListResponse,
  GalleryEntryViewResponse,
  GalleryTag,
  GalleryTagCreateInput,
  GalleryTagUpdateInput,
  EnhanceJob,
  EnhanceJobListResponse,
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
  ImageGenerationConfigTestRequest,
  ImageGenerationConfigTestResponse,
  ImageSessionDetail,
  ImageSessionListResponse,
  ImageSessionStatus,
  ImageToolOptions,
  InspirationDetail,
  InspirationHistory,
  InspirationInitialWorkflowEntry,
  JobStatus,
  LoginPageConfig,
  LoginPageSelectionUpdateRequest,
  LoginPageTemplateConfigUpdateRequest,
  LoginPageTemplateId,
  ProviderConfigResponse,
  ProviderModelListResponse,
  ProviderProfile,
  ProviderProfileCreateRequest,
  ProviderProfileUpdateRequest,
  InspirationWorkflow,
  InspirationWorkflowStatus,
  WorkflowRunStartMode,
  InspirationWritebackResponse,
  InspirationListResponse,
  ReviewUserTemplateGroupInput,
  RuntimeConfig,
  ResourceLibraryAsset,
  ResourceLibraryAssetListResponse,
  ResourceLibraryGroup,
  ResourceLibraryGroupListResponse,
  ResourceLibrarySourceStatusListResponse,
  ResourceModerationResponse,
  ResourceModerationType,
  ResourceModerationUpdateInput,
  RbacPermissionCatalog,
  RbacRole,
  RbacRolePermissions,
  RbacUser,
  RbacUserListResponse,
  SettingsExportPayload,
  SettingsImportCommitResponse,
  SettingsImportPreviewResponse,
  SaveResourceLibraryAssetInput,
  SessionState,
  TextGenerationConfigJsonResponseFormatTestRequest,
  TextGenerationConfigJsonResponseFormatTestResponse,
  TextGenerationConfigTestRequest,
  TextGenerationConfigTestResponse,
  UpdateCanvasTemplateCategoryInput,
  UpdateGlobalCanvasTemplateInput,
  UpdateUserTemplateGroupInput,
  UserUsageStatsResponse,
  UserGenerationResourceGroupGrants,
  UserUiPreferences,
  UserUiPreferencesUpdateRequest,
  WeatherCoordinates,
  WeatherLocation,
} from "./types";
import { weatherConditionFromCode } from "./weather";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

interface OpenMeteoCurrentWeatherPayload {
  current?: {
    time?: string;
    temperature_2m?: unknown;
    relative_humidity_2m?: unknown;
    surface_pressure?: unknown;
    pressure_msl?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
  };
  timezone?: string | null;
}

interface OpenMeteoGeocodingPayload {
  results?: Array<{
    id?: number;
    name?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    country?: unknown;
    admin1?: unknown;
    timezone?: unknown;
  }>;
}

interface NominatimLocationPayload {
  place_id?: number;
  lat?: unknown;
  lon?: unknown;
  name?: unknown;
  display_name?: unknown;
}

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

async function fetchApiBlob(path: string): Promise<Blob> {
  const response = await fetch(toApiUrl(path), {
    credentials: "include",
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
  return response.blob();
}

async function fetchApiDataUrl(path: string): Promise<string> {
  const blob = await fetchApiBlob(path);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("图片读取失败"));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("图片读取失败")));
    reader.readAsDataURL(blob);
  });
}

async function requestExternalJson<T>(url: string, failureDetail: string): Promise<T> {
  const response = await fetch(url, { credentials: "omit" });

  if (!response.ok) {
    throw new ApiError(response.status, failureDetail);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(502, failureDetail);
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCoordinate(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ApiError(400, "天气坐标无效");
  }
  return value.toFixed(4);
}

function normalizeOpenMeteoWeather(payload: OpenMeteoCurrentWeatherPayload): CurrentWeather {
  const weatherCode = finiteNumber(payload.current?.weather_code);
  if (weatherCode === null) {
    throw new ApiError(502, "天气接口返回异常");
  }

  return {
    weather_code: weatherCode,
    condition: weatherConditionFromCode(weatherCode),
    temperature_celsius: finiteNumber(payload.current?.temperature_2m),
    humidity_percent: finiteNumber(payload.current?.relative_humidity_2m),
    pressure_hpa: finiteNumber(payload.current?.surface_pressure) ?? finiteNumber(payload.current?.pressure_msl),
    is_day: finiteNumber(payload.current?.is_day) !== 0,
    observed_at: payload.current?.time ?? null,
    timezone: payload.timezone ?? null,
  };
}

function normalizeWeatherLocations(payload: OpenMeteoGeocodingPayload): WeatherLocation[] {
  return (payload.results ?? []).flatMap((result) => {
    const latitude = finiteNumber(result.latitude);
    const longitude = finiteNumber(result.longitude);
    if (typeof result.name !== "string" || latitude === null || longitude === null) {
      return [];
    }

    return [
      {
        id: typeof result.id === "number" ? result.id : null,
        name: result.name,
        latitude,
        longitude,
        country: typeof result.country === "string" ? result.country : null,
        admin1: typeof result.admin1 === "string" ? result.admin1 : null,
        timezone: typeof result.timezone === "string" ? result.timezone : null,
      },
    ];
  });
}

function normalizeNominatimLocations(payload: NominatimLocationPayload[]): WeatherLocation[] {
  return payload.flatMap((result) => {
    const latitude = typeof result.lat === "string" ? Number(result.lat) : null;
    const longitude = typeof result.lon === "string" ? Number(result.lon) : null;
    if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return [];
    }

    const displayName =
      typeof result.display_name === "string"
        ? result.display_name
        : typeof result.name === "string"
          ? result.name
          : "";

    return [
      {
        id: typeof result.place_id === "number" ? result.place_id : null,
        name: displayName || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        latitude,
        longitude,
        country: null,
        admin1: null,
        timezone: null,
      },
    ];
  });
}

export const api = {
  toApiUrl,
  fetchApiBlob,
  fetchApiDataUrl,
  async searchWeatherLocations(input: { query: string; language?: string }): Promise<WeatherLocation[]> {
    const query = input.query.trim();
    if (!query) {
      return [];
    }
    const params = new URLSearchParams({
      name: query,
      count: "5",
      format: "json",
      language: input.language ?? "zh",
    });
    const openMeteoPayload = await requestExternalJson<OpenMeteoGeocodingPayload>(
      `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`,
      "天气位置查询失败",
    );
    const openMeteoLocations = normalizeWeatherLocations(openMeteoPayload);
    if (openMeteoLocations.length > 0) {
      return openMeteoLocations;
    }

    const fallbackParams = new URLSearchParams({
      q: query,
      format: "json",
      limit: "5",
      addressdetails: "1",
      "accept-language": input.language ?? "zh",
    });
    const nominatimPayload = await requestExternalJson<NominatimLocationPayload[]>(
      `https://nominatim.openstreetmap.org/search?${fallbackParams.toString()}`,
      "天气位置查询失败",
    );
    return normalizeNominatimLocations(nominatimPayload);
  },
  async findWeatherLocation(input: { query: string; language?: string }): Promise<WeatherLocation | null> {
    const locations = await api.searchWeatherLocations(input);
    return locations[0] ?? null;
  },
  async getCurrentWeather(input: WeatherCoordinates): Promise<CurrentWeather> {
    const params = new URLSearchParams({
      latitude: normalizeCoordinate(input.latitude),
      longitude: normalizeCoordinate(input.longitude),
      current: "temperature_2m,relative_humidity_2m,surface_pressure,pressure_msl,weather_code,is_day",
      timezone: "auto",
      forecast_days: "1",
    });
    const payload = await requestExternalJson<OpenMeteoCurrentWeatherPayload>(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      "天气接口请求失败",
    );
    return normalizeOpenMeteoWeather(payload);
  },
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
  getLoginPageConfig(templateId?: LoginPageTemplateId): Promise<LoginPageConfig> {
    const path = templateId
      ? `/api/public/login-page-config/${encodeURIComponent(templateId)}`
      : "/api/public/login-page-config";
    return request<LoginPageConfig>(path);
  },
  listRbacUsers(input?: {
    page?: number;
    page_size?: number;
    username?: string;
    query?: string;
    role_id?: string;
  }): Promise<RbacUserListResponse> {
    const params = new URLSearchParams({
      page: String(input?.page ?? 1),
      page_size: String(input?.page_size ?? 20),
    });
    if (input?.username) {
      params.set("username", input.username);
    }
    if (input?.query) {
      params.set("query", input.query);
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
  listInspirations(input: {
    resource_group_id?: string | null;
    page?: number;
    page_size?: number;
    title?: string;
    updated_from?: string;
    updated_to?: string;
    owner_user_id?: string;
    only_deleted?: boolean;
  }): Promise<InspirationListResponse> {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      page_size: String(input.page_size ?? 20),
    });
    if (input.resource_group_id) {
      params.set("resource_group_id", input.resource_group_id);
    }
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
    if (input.only_deleted) {
      params.set("only_deleted", "true");
    }
    return request(`/api/inspirations?${params.toString()}`);
  },
  getInspiration(inspirationId: string): Promise<InspirationDetail> {
    return request(`/api/inspirations/${inspirationId}`);
  },
  deleteInspiration(inspirationId: string): Promise<void> {
    return request(`/api/inspirations/${inspirationId}`, { method: "DELETE" });
  },
  getInspirationHistory(inspirationId: string, input?: { resource_group_id?: string | null }): Promise<InspirationHistory> {
    const params = new URLSearchParams();
    if (input?.resource_group_id) {
      params.set("resource_group_id", input.resource_group_id);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/inspirations/${inspirationId}/history${suffix}`);
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
  unfreezeGenerationConfig(configId: string): Promise<GenerationConfig> {
    return request(`/api/settings/generation-configs/${encodeURIComponent(configId)}/unfreeze`, { method: "POST" });
  },
  testTextGenerationConfig(payload: TextGenerationConfigTestRequest): Promise<TextGenerationConfigTestResponse> {
    return request("/api/settings/generation-configs/test-text", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  testTextGenerationConfigJsonResponseFormat(
    payload: TextGenerationConfigJsonResponseFormatTestRequest,
  ): Promise<TextGenerationConfigJsonResponseFormatTestResponse> {
    return request("/api/settings/generation-configs/test-json-response-format", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  testImageGenerationConfig(payload: ImageGenerationConfigTestRequest): Promise<ImageGenerationConfigTestResponse> {
    return request("/api/settings/generation-configs/test-image", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getRuntimeConfig(): Promise<RuntimeConfig> {
    return request("/api/settings/runtime");
  },
  getUserUiPreferences(): Promise<UserUiPreferences> {
    return request("/api/settings/ui-preferences");
  },
  updateUserUiPreferences(payload: UserUiPreferencesUpdateRequest): Promise<UserUiPreferences> {
    return request("/api/settings/ui-preferences", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  getGenerationQueueOverview(): Promise<GenerationQueueOverview> {
    return request("/api/generation-queue");
  },
  listEnhanceJobs(input?: { limit?: number; offset?: number; status?: JobStatus | null }): Promise<EnhanceJobListResponse> {
    const params = new URLSearchParams({
      limit: String(input?.limit ?? 50),
      offset: String(input?.offset ?? 0),
    });
    if (input?.status) {
      params.set("status", input.status);
    }
    return request(`/api/enhance-jobs?${params.toString()}`);
  },
  createEnhanceJob(input: CreateEnhanceJobInput): Promise<EnhanceJob> {
    return request("/api/enhance-jobs", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getEnhanceJob(jobId: string): Promise<EnhanceJob> {
    return request(`/api/enhance-jobs/${encodeURIComponent(jobId)}`);
  },
  cancelEnhanceJob(jobId: string): Promise<EnhanceJob> {
    return request(`/api/enhance-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  },
  uploadEnhanceJobFinal(jobId: string, blob: Blob): Promise<EnhanceJob> {
    const formData = new FormData();
    formData.set("file", blob, `enhance-${jobId}.png`);
    return request(`/api/enhance-jobs/${encodeURIComponent(jobId)}/final`, {
      method: "POST",
      body: formData,
    });
  },
  saveEnhanceJobToLibrary(jobId: string, input?: { group_ids?: string[] }): Promise<ResourceLibraryAsset> {
    return request(`/api/enhance-jobs/${encodeURIComponent(jobId)}/save-to-library`, {
      method: "POST",
      body: JSON.stringify({ group_ids: input?.group_ids ?? [] }),
    });
  },
  attachEnhanceJobToImageSession(jobId: string): Promise<ImageSessionDetail> {
    return request(`/api/enhance-jobs/${encodeURIComponent(jobId)}/attach-to-image-session`, {
      method: "POST",
    });
  },
  updateConfig(payload: ConfigUpdateRequest): Promise<ConfigResponse> {
    return request("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  updateLoginPageSelection(payload: LoginPageSelectionUpdateRequest): Promise<ConfigResponse> {
    return request("/api/settings/login-page-selection", {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  resetLoginPageSelection(): Promise<ConfigResponse> {
    return request("/api/settings/login-page-selection/reset", { method: "POST" });
  },
  updateLoginPageTemplateConfig(
    templateId: string,
    payload: LoginPageTemplateConfigUpdateRequest,
  ): Promise<ConfigResponse> {
    return request(`/api/settings/login-page-template-config/${encodeURIComponent(templateId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  resetLoginPageTemplateConfig(templateId: string): Promise<ConfigResponse> {
    return request(`/api/settings/login-page-template-config/${encodeURIComponent(templateId)}/reset`, {
      method: "POST",
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
  async createInspiration(input: CreateInspirationInput): Promise<InspirationDetail> {
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
    return request("/api/inspirations", {
      method: "POST",
      body: formData,
    });
  },
  async addReferenceImages(inspirationId: string, files: File[]): Promise<InspirationDetail> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("reference_images", file);
    });
    return request(`/api/inspirations/${inspirationId}/reference-images`, {
      method: "POST",
      body: formData,
    });
  },
  deleteSourceAsset(assetId: string): Promise<InspirationDetail> {
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
  listImageSessions(
    inspirationId: string | undefined,
    input?: { resource_group_id?: string | null; owner_user_id?: string; only_deleted?: boolean },
  ): Promise<ImageSessionListResponse> {
    const params = new URLSearchParams();
    if (inspirationId) {
      params.set("inspiration_id", inspirationId);
    }
    if (input?.resource_group_id) {
      params.set("resource_group_id", input.resource_group_id);
    }
    if (input?.owner_user_id) {
      params.set("owner_user_id", input.owner_user_id);
    }
    if (input?.only_deleted) {
      params.set("only_deleted", "true");
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/image-sessions${suffix}`);
  },
  createImageSession(input: { inspiration_id?: string; resource_group_id: string; title?: string }): Promise<ImageSessionDetail> {
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
      base_asset_ids?: string[];
      base_asset_id?: string | null;
      selected_reference_asset_ids?: string[];
      generation_count?: number;
      tool_options?: ImageToolOptions | null;
      resource_group_id: string;
      generation_config_mode?: GenerationConfigSelectionMode;
      generation_config_id?: string | null;
      retry_generation_task_id?: string | null;
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
  attachImageSessionAssetToInspiration(
    sessionId: string,
    assetId: string,
    input: { inspiration_id?: string; target: "reference" | "main_source" },
  ): Promise<InspirationWritebackResponse> {
    return request(`/api/image-sessions/${sessionId}/assets/${assetId}/attach-to-inspiration`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  listResourceLibraryGroups(): Promise<ResourceLibraryGroupListResponse> {
    return request("/api/resource-library/groups");
  },
  createResourceLibraryGroup(input: { name: string; sort_order?: number }): Promise<ResourceLibraryGroup> {
    return request("/api/resource-library/groups", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateResourceLibraryGroup(
    groupId: string,
    input: { name?: string; sort_order?: number },
  ): Promise<ResourceLibraryGroup> {
    return request(`/api/resource-library/groups/${encodeURIComponent(groupId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  archiveResourceLibraryGroup(groupId: string): Promise<void> {
    return request(`/api/resource-library/groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });
  },
  listResourceLibraryAssets(input?: { group_id?: string | null }): Promise<ResourceLibraryAssetListResponse> {
    const params = new URLSearchParams();
    if (input?.group_id) {
      params.set("group_id", input.group_id);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/resource-library/assets${suffix}`);
  },
  listResourceLibrarySourceStatus(input: {
    source_type: SaveResourceLibraryAssetInput["source_type"];
    source_ids: string[];
  }): Promise<ResourceLibrarySourceStatusListResponse> {
    const params = new URLSearchParams();
    params.set("source_type", input.source_type);
    for (const sourceId of input.source_ids) {
      params.append("source_ids", sourceId);
    }
    return request(`/api/resource-library/source-status?${params.toString()}`);
  },
  saveResourceLibraryAsset(input: SaveResourceLibraryAssetInput): Promise<ResourceLibraryAsset> {
    return request("/api/resource-library/assets/save", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  uploadResourceLibraryAssets(input: {
    files: File[];
    group_ids?: string[];
  }): Promise<ResourceLibraryAssetListResponse> {
    const formData = new FormData();
    input.files.forEach((file) => {
      formData.append("images", file);
    });
    input.group_ids?.forEach((groupId) => {
      formData.append("group_ids", groupId);
    });
    return request("/api/resource-library/assets/upload", {
      method: "POST",
      body: formData,
    });
  },
  updateResourceLibraryAssetGroups(assetId: string, input: { group_ids: string[] }): Promise<ResourceLibraryAsset> {
    return request(`/api/resource-library/assets/${encodeURIComponent(assetId)}/groups`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  archiveResourceLibraryAsset(assetId: string): Promise<void> {
    return request(`/api/resource-library/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
  },
  loadResourceLibraryAssetToWorkflowNode(assetId: string, input: { node_id: string }): Promise<InspirationWorkflow> {
    return request(`/api/resource-library/assets/${encodeURIComponent(assetId)}/load-to-workflow-node`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  loadResourceLibraryAssetToImageSession(
    assetId: string,
    input: { image_session_id: string },
  ): Promise<ImageSessionDetail> {
    return request(`/api/resource-library/assets/${encodeURIComponent(assetId)}/load-to-image-session`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  listGalleryEntries(input?: {
    resource_group_id?: string | null;
    tag_ids?: string[];
    include_disabled?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<GalleryEntryListResponse> {
    const params = new URLSearchParams();
    if (input?.resource_group_id) {
      params.set("resource_group_id", input.resource_group_id);
    }
    input?.tag_ids?.forEach((tagId) => {
      if (tagId) {
        params.append("tag_ids", tagId);
      }
    });
    if (input?.include_disabled) {
      params.set("include_disabled", "true");
    }
    if (input?.limit !== undefined) {
      params.set("limit", `${input.limit}`);
    }
    if (input?.offset !== undefined) {
      params.set("offset", `${input.offset}`);
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/gallery${suffix}`);
  },
  listGalleryTags(input?: { include_disabled?: boolean }): Promise<GalleryTag[]> {
    const params = new URLSearchParams();
    if (input?.include_disabled) {
      params.set("include_disabled", "true");
    }
    const suffix = params.size ? `?${params.toString()}` : "";
    return request(`/api/gallery/tags${suffix}`);
  },
  createGalleryTag(payload: GalleryTagCreateInput): Promise<GalleryTag> {
    return request("/api/gallery/tags", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  updateGalleryTag(tagId: string, payload: GalleryTagUpdateInput): Promise<GalleryTag> {
    return request(`/api/gallery/tags/${encodeURIComponent(tagId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  deleteGalleryTag(tagId: string): Promise<GalleryTag> {
    return request(`/api/gallery/tags/${encodeURIComponent(tagId)}`, { method: "DELETE" });
  },
  replaceGalleryEntryTags(galleryEntryId: string, tagIds: string[]): Promise<GalleryEntry> {
    return request(`/api/gallery/${encodeURIComponent(galleryEntryId)}/tags`, {
      method: "PATCH",
      body: JSON.stringify({ tag_ids: tagIds }),
    });
  },
  saveGalleryEntry(imageSessionAssetId: string, input?: { tag_ids?: string[] }): Promise<GalleryEntry> {
    return request("/api/gallery", {
      method: "POST",
      body: JSON.stringify({ image_session_asset_id: imageSessionAssetId, tag_ids: input?.tag_ids ?? [] }),
    });
  },
  recordGalleryEntryView(galleryEntryId: string): Promise<GalleryEntryViewResponse> {
    return request(`/api/gallery/${galleryEntryId}/views`, {
      method: "POST",
    });
  },
  updateResourceModeration(
    resourceType: ResourceModerationType,
    resourceId: string,
    input: ResourceModerationUpdateInput,
  ): Promise<ResourceModerationResponse> {
    return request(
      `/api/resource-moderation/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  },
  getInspirationWorkflow(inspirationId: string): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow`);
  },
  getInspirationWorkflowStatus(inspirationId: string): Promise<InspirationWorkflowStatus> {
    return request(`/api/inspirations/${inspirationId}/workflow/status`);
  },
  listCanvasTemplates(input?: {
    search?: string;
    category_id?: string;
    scope?: CanvasTemplateScope;
    initial_workflow_entry?: InspirationInitialWorkflowEntry;
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
    initial_workflow_entry?: InspirationInitialWorkflowEntry;
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
  applyWorkflowTemplateGroup(inspirationId: string, input: ApplyWorkflowTemplateGroupInput): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/template-groups`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  duplicateWorkflowNodeGroup(
    inspirationId: string,
    input: DuplicateWorkflowNodeGroupInput,
  ): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/node-groups/duplicate`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  createUserTemplateGroup(inspirationId: string, input: CreateUserTemplateGroupInput): Promise<CanvasTemplateSummary> {
    return request(`/api/inspirations/${inspirationId}/workflow/user-template-groups`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  createUserCanvasTemplate(
    inspirationId: string,
    input: CreateUserCanvasTemplateInput,
  ): Promise<CanvasTemplateSummary> {
    return request(`/api/inspirations/${inspirationId}/workflow/user-canvas-templates`, {
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
    inspirationId: string,
    input: {
      node_type: InspirationWorkflow["nodes"][number]["node_type"];
      title: string;
      position_x: number;
      position_y: number;
      config_json: Record<string, unknown>;
    },
  ): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes`, {
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
  ): Promise<InspirationWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  updateWorkflowNodeCopy(nodeId: string, payload: CopySetUpdateRequest): Promise<InspirationWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/copy`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },
  applyTailSplitPlan(nodeId: string, payload: ApplyTailSplitPlanInput): Promise<InspirationWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/tail-split-plan/apply`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  async uploadWorkflowNodeImage(
    nodeId: string,
    input: { file: File; role?: string; label?: string },
  ): Promise<InspirationWorkflow> {
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
  async uploadWorkflowNodeDocument(nodeId: string, input: { file: File }): Promise<InspirationWorkflow> {
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
  ): Promise<InspirationWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/image-source`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  clearWorkflowNodeImage(nodeId: string): Promise<InspirationWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}/image`, { method: "DELETE" });
  },
  createWorkflowEdge(
    inspirationId: string,
    input: { source_node_id: string; target_node_id: string; source_handle?: string; target_handle?: string },
  ): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/edges`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  deleteWorkflowEdge(edgeId: string): Promise<InspirationWorkflow> {
    return request(`/api/workflow-edges/${edgeId}`, { method: "DELETE" });
  },
  deleteWorkflowNode(nodeId: string): Promise<InspirationWorkflow> {
    return request(`/api/workflow-nodes/${nodeId}`, { method: "DELETE" });
  },
  runInspirationWorkflow(
    inspirationId: string,
    input?: { start_node_id?: string; start_mode?: WorkflowRunStartMode },
  ): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/run`, {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
  },
  cancelInspirationWorkflowRun(inspirationId: string, runId: string): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/runs/${runId}/cancel`, { method: "POST" });
  },
  retryInspirationWorkflowRun(inspirationId: string, runId: string): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/runs/${runId}/retry`, { method: "POST" });
  },
  retryFailedWorkflowNodes(inspirationId: string): Promise<InspirationWorkflow> {
    return request(`/api/inspirations/${inspirationId}/workflow/failed-nodes/retry`, { method: "POST" });
  },
  getWorkflowDeckSources(
    inspirationId: string,
    nodeId: string,
    includeTransitiveInputs?: boolean,
  ): Promise<DeckSourceManifest> {
    const params = includeTransitiveInputs === undefined ? "" : `?include_transitive_inputs=${includeTransitiveInputs}`;
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/sources${params}`);
  },
  refreshWorkflowDeckSources(
    inspirationId: string,
    nodeId: string,
    includeTransitiveInputs?: boolean,
  ): Promise<DeckSourceManifest> {
    const params = includeTransitiveInputs === undefined ? "" : `?include_transitive_inputs=${includeTransitiveInputs}`;
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/refresh-sources${params}`, {
      method: "POST",
    });
  },
  renameWorkflowDeck(
    inspirationId: string,
    nodeId: string,
    input: { title?: string; speaker_notes_enabled?: boolean },
  ): Promise<Deck> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  createWorkflowDeckOutline(
    inspirationId: string,
    nodeId: string,
    input: {
      resource_group_id?: string | null;
      text_generation_config_mode?: "auto" | "manual";
      text_generation_config_id?: string | null;
      image_generation_config_mode?: "auto" | "manual";
      image_generation_config_id?: string | null;
      title?: string;
      source_input?: string;
      max_slides?: number;
      style_key?: string;
      include_transitive_inputs?: boolean;
      planning_strategy?: "hybrid" | "copy_led" | "image_led";
      slide_count_mode?: "auto" | "target";
      group_by?: "tail_item" | "source_node";
      section_pages?: boolean;
      per_group_image_cap?: number;
      slide_context?: Array<{
        title?: string;
        points?: string[];
      }>;
    },
  ): Promise<Deck> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/outline`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  setWorkflowDeckStyle(
    inspirationId: string,
    nodeId: string,
    input: { style_key?: string | null },
  ): Promise<Deck> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/style`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  generateWorkflowDeckSample(inspirationId: string, nodeId: string): Promise<Deck> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/sample`, { method: "POST" });
  },
  generateWorkflowDeck(inspirationId: string, nodeId: string): Promise<Deck> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/generate`, { method: "POST" });
  },
  reorderWorkflowDeckSlides(inspirationId: string, nodeId: string, slideIds: string[]): Promise<Deck> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/slide-order`, {
      method: "PUT",
      body: JSON.stringify({ slide_ids: slideIds }),
    });
  },
  updateWorkflowDeckSlide(
    inspirationId: string,
    nodeId: string,
    slideId: string,
    input: { title?: string; points?: string[]; speaker_notes?: string },
  ): Promise<DeckSlide> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/slides/${slideId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  regenerateWorkflowDeckSlide(inspirationId: string, nodeId: string, slideId: string): Promise<DeckSlide> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/slides/${slideId}/regenerate`, {
      method: "POST",
    });
  },
  generateWorkflowDeckSlideSpeakerNotes(inspirationId: string, nodeId: string, slideId: string): Promise<DeckSlide> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/slides/${slideId}/speaker-notes`, {
      method: "POST",
    });
  },
  enhanceWorkflowDeckSlideMaterial(
    inspirationId: string,
    nodeId: string,
    slideId: string,
    input: { prompt?: string },
  ): Promise<DeckSlide> {
    return request(
      `/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/slides/${slideId}/material/enhance`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },
  bindWorkflowDeckSlideMaterial(
    inspirationId: string,
    nodeId: string,
    slideId: string,
    input: { source_item_id: string; target_slot?: string; caption_source?: string },
  ): Promise<DeckSlide> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/slides/${slideId}/material`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  unbindWorkflowDeckSlideMaterial(inspirationId: string, nodeId: string, slideId: string): Promise<DeckSlide> {
    return request(`/api/inspirations/${inspirationId}/workflow/nodes/${nodeId}/deck/slides/${slideId}/material`, {
      method: "DELETE",
    });
  },
  listDeckStyles(): Promise<DeckStyleOption[]> {
    return request("/api/deck-styles");
  },
  listDecks(inspirationId: string): Promise<DeckSummary[]> {
    return request(`/api/inspirations/${inspirationId}/decks`);
  },
  getDeck(deckId: string): Promise<Deck> {
    return request(`/api/decks/${deckId}`);
  },
  createDeck(
    inspirationId: string,
    input: {
      resource_group_id: string;
      source_input?: string;
      title?: string;
      max_slides?: number;
      style_key?: string;
    },
  ): Promise<Deck> {
    return request(`/api/inspirations/${inspirationId}/decks`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  renameDeck(deckId: string, input: { title?: string; speaker_notes_enabled?: boolean }): Promise<Deck> {
    return request(`/api/decks/${deckId}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  deleteDeck(deckId: string): Promise<void> {
    return request(`/api/decks/${deckId}`, { method: "DELETE" });
  },
  replaceDeckOutline(
    deckId: string,
    input: { title?: string; slides: { title: string; points: string[] }[] },
  ): Promise<Deck> {
    return request(`/api/decks/${deckId}/outline`, { method: "PUT", body: JSON.stringify(input) });
  },
  setDeckStyle(deckId: string, input: { style_key?: string; style_reference_asset_id?: string }): Promise<Deck> {
    return request(`/api/decks/${deckId}/style`, { method: "POST", body: JSON.stringify(input) });
  },
  generateDeck(deckId: string): Promise<Deck> {
    return request(`/api/decks/${deckId}/generate`, { method: "POST" });
  },
  generateDeckSample(deckId: string): Promise<Deck> {
    return request(`/api/decks/${deckId}/sample`, { method: "POST" });
  },
  regenerateDeckSlide(slideId: string): Promise<DeckSlide> {
    return request(`/api/deck-slides/${slideId}/regenerate`, { method: "POST" });
  },
  updateDeckSlide(
    slideId: string,
    input: { title?: string; points?: string[]; speaker_notes?: string },
  ): Promise<DeckSlide> {
    return request(`/api/deck-slides/${slideId}`, { method: "PUT", body: JSON.stringify(input) });
  },
  generateDeckSlideSpeakerNotes(slideId: string): Promise<DeckSlide> {
    return request(`/api/deck-slides/${slideId}/speaker-notes`, { method: "POST" });
  },
  enhanceDeckSlideMaterial(slideId: string, input: { prompt?: string }): Promise<DeckSlide> {
    return request(`/api/deck-slides/${slideId}/material/enhance`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  setDeckSlideMaterial(slideId: string, input: { source_type: string; asset_id: string }): Promise<DeckSlide> {
    return request(`/api/deck-slides/${slideId}/material`, { method: "PUT", body: JSON.stringify(input) });
  },
  exportDeck(deckId: string): Promise<Deck> {
    return request(`/api/decks/${deckId}/export`, { method: "POST" });
  },
  reorderDeckSlides(deckId: string, slideIds: string[]): Promise<Deck> {
    return request(`/api/decks/${deckId}/slide-order`, {
      method: "PUT",
      body: JSON.stringify({ slide_ids: slideIds }),
    });
  },
  uploadDeckStyleReference(deckId: string, file: File): Promise<Deck> {
    const formData = new FormData();
    formData.set("image", file);
    return request(`/api/decks/${deckId}/style-reference`, { method: "POST", body: formData });
  },
  saveDeckSlideToResourceLibrary(slideId: string): Promise<void> {
    return request(`/api/deck-slides/${slideId}/resource-library`, { method: "POST" });
  },
};
