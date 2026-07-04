import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Plus,
  Power,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ClassicOptionToggle, ClassicSelectField, ClassicTextInput } from "../components/classicInputs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LayoutActionSurfaceButton } from "../components/LayoutActionSurfaceButton";
import { LayoutSwitchTabs, type LayoutSwitchTabItem } from "../components/LayoutSwitchTabs";
import { actionButtonComponentForAppearance } from "../components/layoutActionButtons";
import { ModalShell } from "../components/ModalShell";
import { TopNav } from "../components/TopNav";
import { WorkspaceOptionToggle, WorkspaceSelectField, WorkspaceTextInput } from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/preferences";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import type {
  GenerationResourceGroup,
  RbacApiPermission,
  RbacPermissionCatalog,
  RbacRolePermissions,
  RbacUser,
} from "../lib/types";

const RBAC_USER_PAGE_SIZE = 20;
const RBAC_FEEDBACK_AUTO_DISMISS_MS = 1000;

const RBAC_PANEL_CLASS =
  "pf-settings-bordered-module rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 " +
  "dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25";
const RBAC_FIELD_CARD_CLASS =
  "pf-settings-field-card rounded-xl border border-slate-200 bg-slate-50/70 shadow-none dark:border-slate-700 dark:bg-[#0b1220]";
const RBAC_SELECTABLE_SURFACE_STYLE: CSSProperties = {
  ["--pf-action-radius" as string]: "var(--pf-radius-md)",
  ["--pf-action-shadow" as string]: "none",
  ["--pf-action-shadow-hover" as string]: "none",
};

function rbacActionButtonComponent(workspaceSubpage: boolean) {
  return actionButtonComponentForAppearance(workspaceSubpage ? "workspace" : "classic");
}

type RbacSectionId = "users" | "roles";

type PendingUserAction =
  | { kind: "reset-password"; user: RbacUser }
  | { kind: "set-enabled"; user: RbacUser; enabled: boolean };

export interface RolePermissionDraft {
  menu_codes: string[];
  api_permission_codes: string[];
}

interface PermissionGroup {
  menuCode: string;
  menuTitle: string;
  menuEnabled: boolean;
  apiPermissions: RbacApiPermission[];
}

export function rolePermissionDraftFromResponse(payload: RbacRolePermissions): RolePermissionDraft {
  return {
    menu_codes: [...payload.menu_codes],
    api_permission_codes: [...payload.api_permission_codes],
  };
}

export function buildPermissionGroups(catalog: RbacPermissionCatalog): PermissionGroup[] {
  return catalog.menus.map((menu) => ({
    menuCode: menu.code,
    menuTitle: menu.title,
    menuEnabled: menu.enabled,
    apiPermissions: catalog.api_permissions.filter((permission) => permission.menu_code === menu.code),
  }));
}

export function toggleMenuPermissionDraft(
  draft: RolePermissionDraft,
  group: PermissionGroup,
  enabled: boolean,
): RolePermissionDraft {
  const nextMenuCodes = new Set(draft.menu_codes);
  const nextApiPermissionCodes = new Set(draft.api_permission_codes);

  if (enabled) {
    nextMenuCodes.add(group.menuCode);
    for (const permission of group.apiPermissions) {
      if (permission.enabled && permission.code.endsWith(":read")) {
        nextApiPermissionCodes.add(permission.code);
      }
    }
  } else {
    nextMenuCodes.delete(group.menuCode);
    for (const permission of group.apiPermissions) {
      nextApiPermissionCodes.delete(permission.code);
    }
  }

  return {
    menu_codes: [...nextMenuCodes].sort(),
    api_permission_codes: [...nextApiPermissionCodes].sort(),
  };
}

export function toggleApiPermissionDraft(
  draft: RolePermissionDraft,
  menuCode: string,
  permissionCode: string,
  enabled: boolean,
): RolePermissionDraft {
  const nextMenuCodes = new Set(draft.menu_codes);
  const nextApiPermissionCodes = new Set(draft.api_permission_codes);

  if (enabled) {
    nextMenuCodes.add(menuCode);
    nextApiPermissionCodes.add(permissionCode);
  } else {
    nextApiPermissionCodes.delete(permissionCode);
  }

  return {
    menu_codes: [...nextMenuCodes].sort(),
    api_permission_codes: [...nextApiPermissionCodes].sort(),
  };
}

export function rbacUserResourceGroupLabels(user: RbacUser, fallback: string): string[] {
  if (!user.resource_groups.length) {
    return [fallback];
  }
  return user.resource_groups.map((group) => group.name);
}

export function rbacUserResourceGroupSummary(user: RbacUser, fallback: string): string {
  return rbacUserResourceGroupLabels(user, fallback).join(" / ");
}

export function rbacUserListQueryKey(page: number, username: string, roleId: string) {
  return ["rbac-users", page, username, roleId] as const;
}

type RbacUserListQueryKey = ReturnType<typeof rbacUserListQueryKey>;

export function rbacUserResourceGroupIds(user: RbacUser): string[] {
  return user.resource_groups.map((group) => group.id).sort();
}

export function RbacPage() {
  const { t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isWorkspaceSubpage = activeScheme === "workspace";
  const actionAppearance = isWorkspaceSubpage ? "workspace" : "classic";
  const PageActionButton = rbacActionButtonComponent(isWorkspaceSubpage);
  const sectionTabs: readonly LayoutSwitchTabItem<RbacSectionId>[] = [
    { value: "users", label: t("rbac.userManagement") },
    { value: "roles", label: t("rbac.roleManagement") },
  ];
  const [activeSection, setActiveSection] = useState<RbacSectionId>("users");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [roleName, setRoleName] = useState("");
  const [selectedPermissionRoleId, setSelectedPermissionRoleId] = useState("");
  const [rolePermissionDraft, setRolePermissionDraft] = useState<RolePermissionDraft | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [userSearchDraft, setUserSearchDraft] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [pendingUserAction, setPendingUserAction] = useState<PendingUserAction | null>(null);
  const [resourceGroupGrantUser, setResourceGroupGrantUser] = useState<RbacUser | null>(null);
  const [resourceGroupGrantDraft, setResourceGroupGrantDraft] = useState<string[]>([]);
  const [feedbackSuccess, setFeedbackSuccess] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [passwordSetupToken, setPasswordSetupToken] = useState("");
  const userListQueryKey = useMemo(
    () => rbacUserListQueryKey(userPage, userSearch, userRoleFilter),
    [userPage, userSearch, userRoleFilter],
  );
  const currentUserListQueryKey = useRef<RbacUserListQueryKey>(userListQueryKey);

  useEffect(() => {
    currentUserListQueryKey.current = userListQueryKey;
  }, [userListQueryKey]);

  const usersQuery = useQuery({
    queryKey: userListQueryKey,
    queryFn: () =>
      api.listRbacUsers({
        page: userPage,
        page_size: RBAC_USER_PAGE_SIZE,
        username: userSearch || undefined,
        role_id: userRoleFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });
  const rolesQuery = useQuery({ queryKey: ["rbac-roles"], queryFn: api.listRbacRoles });
  const permissionCatalogQuery = useQuery({
    queryKey: ["rbac-permission-catalog"],
    queryFn: api.listRbacPermissionCatalog,
  });
  const shouldLoadResourceGroupGrantData = Boolean(resourceGroupGrantUser && !resourceGroupGrantUser.is_admin);
  const generationResourceGroupsQuery = useQuery({
    queryKey: ["generation-resource-groups"],
    queryFn: () => api.listGenerationResourceGroups(),
    enabled: shouldLoadResourceGroupGrantData,
  });
  const roles = rolesQuery.data ?? [];
  const normalizedRoleSearch = roleSearch.trim().toLocaleLowerCase();
  const filteredRoles = useMemo(
    () =>
      normalizedRoleSearch
        ? roles.filter(
            (role) =>
              role.name.toLocaleLowerCase().includes(normalizedRoleSearch) ||
              role.code.toLocaleLowerCase().includes(normalizedRoleSearch),
          )
        : roles,
    [normalizedRoleSearch, roles],
  );
  const assignableRoles = useMemo(() => roles.filter((role) => !role.is_admin), [roles]);
  const selectedRoleId = roleId || assignableRoles[0]?.id || "";
  const selectedPermissionRole =
    filteredRoles.find((role) => role.id === selectedPermissionRoleId) ?? filteredRoles[0] ?? null;
  const users = usersQuery.data?.items ?? [];
  const userTotal = usersQuery.data?.total ?? 0;
  const userTotalPages = Math.max(1, Math.ceil(userTotal / RBAC_USER_PAGE_SIZE));
  const permissionGroups = useMemo(
    () => (permissionCatalogQuery.data ? buildPermissionGroups(permissionCatalogQuery.data) : []),
    [permissionCatalogQuery.data],
  );
  const generationResourceGroups = useMemo(
    () => (generationResourceGroupsQuery.data ?? []).filter((group) => !group.archived_at),
    [generationResourceGroupsQuery.data],
  );

  const rolePermissionsQuery = useQuery({
    queryKey: ["rbac-role-permissions", selectedPermissionRole?.id ?? ""],
    queryFn: () => api.getRbacRolePermissions(selectedPermissionRole!.id),
    enabled: Boolean(selectedPermissionRole?.id),
  });
  const resourceGroupGrantsQuery = useQuery({
    queryKey: ["rbac-user-generation-resource-groups", resourceGroupGrantUser?.id ?? ""],
    queryFn: () => api.getUserGenerationResourceGroupGrants(resourceGroupGrantUser!.id),
    enabled: shouldLoadResourceGroupGrantData,
  });

  const refreshCurrentUserList = async () => {
    await queryClient.invalidateQueries({ queryKey: currentUserListQueryKey.current, exact: true });
  };

  useEffect(() => {
    if (!filteredRoles.length) {
      if (selectedPermissionRoleId) {
        setSelectedPermissionRoleId("");
      }
      return;
    }
    if (!selectedPermissionRoleId && filteredRoles[0]?.id) {
      setSelectedPermissionRoleId(filteredRoles[0].id);
      return;
    }
    if (
      selectedPermissionRoleId &&
      !filteredRoles.some((role) => role.id === selectedPermissionRoleId) &&
      filteredRoles[0]?.id
    ) {
      setSelectedPermissionRoleId(filteredRoles[0].id);
    }
  }, [filteredRoles, selectedPermissionRoleId]);

  useEffect(() => {
    if (usersQuery.data && userPage > userTotalPages) {
      setUserPage(userTotalPages);
    }
  }, [userPage, userTotalPages, usersQuery.data]);

  useEffect(() => {
    if (!selectedPermissionRole?.id) {
      setRolePermissionDraft(null);
      return;
    }
    if (rolePermissionsQuery.data?.role_id === selectedPermissionRole.id) {
      setRolePermissionDraft(rolePermissionDraftFromResponse(rolePermissionsQuery.data));
    }
  }, [rolePermissionsQuery.data, selectedPermissionRole?.id]);

  useEffect(() => {
    if (!resourceGroupGrantUser) {
      setResourceGroupGrantDraft([]);
      return;
    }
    if (resourceGroupGrantUser.is_admin) {
      setResourceGroupGrantDraft([]);
      return;
    }
    if (resourceGroupGrantsQuery.data?.user_id === resourceGroupGrantUser.id) {
      setResourceGroupGrantDraft([...resourceGroupGrantsQuery.data.resource_group_ids]);
    }
  }, [resourceGroupGrantUser, resourceGroupGrantsQuery.data]);

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: () =>
      api.createRbacUser({
        username: username.trim(),
        display_name: displayName.trim() || null,
        role_id: selectedRoleId || null,
      }),
    onSuccess: async (createdUser) => {
      setUsername("");
      setDisplayName("");
      setFeedbackSuccess(t("rbac.userCreated"));
      setPasswordSetupToken(createdUser.password_setup_token ?? "");
      setFeedbackError("");
      await Promise.all([refreshCurrentUserList(), queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })]);
    },
    onError: (mutationError) => setFeedbackError(errorMessage(mutationError, t("rbac.createUserFailed"))),
  });

  const createRoleMutation = useMutation({
    mutationFn: () => api.createRbacRole({ code: roleCode.trim(), name: roleName.trim() }),
    onSuccess: async (createdRole) => {
      setRoleCode("");
      setRoleName("");
      setSelectedPermissionRoleId(createdRole.id);
      setFeedbackSuccess(t("rbac.roleCreated"));
      setFeedbackError("");
      await queryClient.invalidateQueries({ queryKey: ["rbac-roles"] });
    },
    onError: (mutationError) => setFeedbackError(errorMessage(mutationError, t("rbac.createRoleFailed"))),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: api.resetRbacUserPassword,
    onSuccess: async (updatedUser) => {
      setPendingUserAction(null);
      setFeedbackSuccess(t("rbac.passwordReset"));
      setPasswordSetupToken(updatedUser.password_setup_token ?? "");
      setFeedbackError("");
      await Promise.all([refreshCurrentUserList(), queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })]);
    },
    onError: (mutationError) => setFeedbackError(errorMessage(mutationError, t("rbac.resetPasswordFailed"))),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, enabled }: { userId: string; enabled: boolean }) =>
      api.updateRbacUser(userId, { enabled }),
    onSuccess: async () => {
      setPendingUserAction(null);
      setFeedbackSuccess(t("rbac.userUpdated"));
      setPasswordSetupToken("");
      setFeedbackError("");
      await Promise.all([refreshCurrentUserList(), queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })]);
    },
    onError: (mutationError) => setFeedbackError(errorMessage(mutationError, t("rbac.updateUserFailed"))),
  });

  const saveRolePermissionsMutation = useMutation({
    mutationFn: () =>
      api.updateRbacRolePermissions(selectedPermissionRole!.id, {
        menu_codes: rolePermissionDraft?.menu_codes ?? [],
        api_permission_codes: rolePermissionDraft?.api_permission_codes ?? [],
      }),
    onSuccess: async (payload) => {
      setRolePermissionDraft(rolePermissionDraftFromResponse(payload));
      setFeedbackSuccess(t("rbac.permissionsSaved"));
      setPasswordSetupToken("");
      setFeedbackError("");
      await queryClient.invalidateQueries({ queryKey: ["rbac-role-permissions", payload.role_id] });
    },
    onError: (mutationError) => setFeedbackError(errorMessage(mutationError, t("rbac.savePermissionsFailed"))),
  });

  const saveResourceGroupGrantsMutation = useMutation({
    mutationFn: () =>
      api.updateUserGenerationResourceGroupGrants(resourceGroupGrantUser!.id, {
        resource_group_ids: resourceGroupGrantDraft,
      }),
    onSuccess: async (payload) => {
      setResourceGroupGrantDraft([...payload.resource_group_ids]);
      setResourceGroupGrantUser(null);
      setFeedbackSuccess(t("rbac.resourceGroupsSaved"));
      setPasswordSetupToken("");
      setFeedbackError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rbac-user-generation-resource-groups", payload.user_id] }),
        refreshCurrentUserList(),
      ]);
    },
    onError: (mutationError) => setFeedbackError(errorMessage(mutationError, t("rbac.saveResourceGroupsFailed"))),
  });

  const handleCreateUser = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedbackSuccess("");
    setPasswordSetupToken("");
    setFeedbackError("");
    if (!username.trim()) {
      setFeedbackError(t("rbac.usernameRequired"));
      return;
    }
    createUserMutation.mutate();
  };

  const handleCreateRole = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedbackSuccess("");
    setPasswordSetupToken("");
    setFeedbackError("");
    if (!roleCode.trim() || !roleName.trim()) {
      setFeedbackError(t("rbac.roleRequired"));
      return;
    }
    createRoleMutation.mutate();
  };

  const handleUserSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setUserSearch(userSearchDraft.trim());
    setUserPage(1);
  };

  const handleClearUserFilters = () => {
    setUserSearchDraft("");
    setUserSearch("");
    setUserRoleFilter("");
    setUserPage(1);
  };

  const handleConfirmUserAction = () => {
    if (!pendingUserAction) {
      return;
    }
    if (pendingUserAction.kind === "reset-password") {
      resetPasswordMutation.mutate(pendingUserAction.user.id);
      return;
    }
    updateUserMutation.mutate({ userId: pendingUserAction.user.id, enabled: pendingUserAction.enabled });
  };

  const openResourceGroupGrantDialog = (user: RbacUser) => {
    setResourceGroupGrantUser(user);
    setResourceGroupGrantDraft(user.is_admin ? [] : rbacUserResourceGroupIds(user));
  };

  const loading = usersQuery.isLoading || rolesQuery.isLoading;
  const permissionsLoading = permissionCatalogQuery.isLoading || rolePermissionsQuery.isLoading;
  const resourceGroupGrantsLoading =
    shouldLoadResourceGroupGrantData &&
    (generationResourceGroupsQuery.isLoading || resourceGroupGrantsQuery.isLoading);
  const userFiltersActive = Boolean(userSearch || userRoleFilter);
  const pendingUserActionBusy = resetPasswordMutation.isPending || updateUserMutation.isPending;
  const pendingUserActionTitle = pendingUserAction
    ? pendingUserAction.kind === "reset-password"
      ? t("rbac.confirmResetPasswordTitle")
      : pendingUserAction.enabled
        ? t("rbac.confirmEnableTitle")
        : t("rbac.confirmDisableTitle")
    : "";
  const pendingUserActionDescription = pendingUserAction
    ? pendingUserAction.kind === "reset-password"
      ? t("rbac.confirmResetPassword", { username: pendingUserAction.user.username })
      : pendingUserAction.enabled
        ? t("rbac.confirmEnable", { username: pendingUserAction.user.username })
        : t("rbac.confirmDisable", { username: pendingUserAction.user.username })
    : "";
  const pendingUserActionConfirmLabel = pendingUserAction
    ? pendingUserAction.kind === "reset-password"
      ? t("rbac.resetPassword")
      : pendingUserAction.enabled
        ? t("rbac.enable")
        : t("rbac.disable")
    : "";
  const emptyPermissionRoleMessage = roles.length ? t("rbac.noMatchingRoles") : t("rbac.noRoles");
  const resourceGroupGrantDialogOpen = Boolean(resourceGroupGrantUser);

  return (
    <div className="pf-app pf-settings-workspace">
      <TopNav
        breadcrumbs={t("rbac.breadcrumb")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main className="pf-page pf-rbac-page flex flex-col gap-6">
        <section className="pf-page-header">
          <div>
            <div className="pf-eyebrow mb-2 gap-1.5">
              <ShieldCheck size={13} />
              {t("rbac.breadcrumb")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("rbac.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{t("rbac.description")}</p>
          </div>
        </section>

        {passwordSetupToken ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow-sm dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="mb-1 font-semibold">{t("rbac.passwordSetupToken")}</div>
            <code className="block break-all rounded border border-amber-200 bg-white px-2 py-1 font-mono text-xs text-amber-900 dark:border-amber-400/25 dark:bg-slate-950 dark:text-amber-100">
              {passwordSetupToken}
            </code>
          </div>
        ) : null}

        <LayoutSwitchTabs
          appearance={actionAppearance}
          value={activeSection}
          items={sectionTabs}
          ariaLabel={t("rbac.title")}
          onChange={setActiveSection}
          className="w-full max-w-md"
          tabClassName="flex-1"
        />

        {loading ? (
          <div className={`${RBAC_PANEL_CLASS} flex items-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400`}>
            <Loader2 size={16} className="animate-spin" />
            {t("app.loading")}
          </div>
        ) : usersQuery.isError || rolesQuery.isError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200">
            {t("rbac.loadFailed")}
          </div>
        ) : (
          <>
            {activeSection === "users" ? (
              <section className={RBAC_PANEL_CLASS}>
                <div className="mb-4 flex items-center gap-2">
                  <UserPlus size={18} className="text-slate-500 dark:text-slate-400" />
                  <h2 className="text-sm font-semibold">{t("rbac.createUser")}</h2>
                </div>
                <form className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={handleCreateUser}>
                  {isWorkspaceSubpage ? (
                    <>
                      <WorkspaceTextInput
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder={t("rbac.username")}
                        size="compact"
                      />
                      <WorkspaceTextInput
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder={t("rbac.displayName")}
                        size="compact"
                      />
                      <WorkspaceSelectField
                        value={selectedRoleId}
                        onChange={setRoleId}
                        size="compact"
                        options={assignableRoles.map((role) => ({
                          value: role.id,
                          label: role.name,
                        }))}
                      />
                    </>
                  ) : (
                    <>
                      <ClassicTextInput
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder={t("rbac.username")}
                        size="compact"
                      />
                      <ClassicTextInput
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder={t("rbac.displayName")}
                        size="compact"
                      />
                      <ClassicSelectField
                        value={selectedRoleId}
                        onChange={setRoleId}
                        size="compact"
                        options={assignableRoles.map((role) => ({
                          value: role.id,
                          label: role.name,
                        }))}
                      />
                    </>
                  )}
                  <PageActionButton
                    type="submit"
                    disabled={createUserMutation.isPending}
                    preset="primary"
                    size="md"
                    loading={createUserMutation.isPending}
                    leadingIcon={<Plus size={15} />}
                  >
                    {t("rbac.add")}
                  </PageActionButton>
                </form>
              </section>
            ) : null}
            {activeSection === "roles" ? (
              <>
                <section className={RBAC_PANEL_CLASS}>
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldCheck size={18} className="text-slate-500 dark:text-slate-400" />
                    <h2 className="text-sm font-semibold">{t("rbac.createRole")}</h2>
                  </div>
                  <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreateRole}>
                    {isWorkspaceSubpage ? (
                      <>
                        <WorkspaceTextInput
                          value={roleCode}
                          onChange={(event) => setRoleCode(event.target.value)}
                          placeholder={t("rbac.roleCode")}
                          size="compact"
                        />
                        <WorkspaceTextInput
                          value={roleName}
                          onChange={(event) => setRoleName(event.target.value)}
                          placeholder={t("rbac.roleName")}
                          size="compact"
                        />
                      </>
                    ) : (
                      <>
                        <ClassicTextInput
                          value={roleCode}
                          onChange={(event) => setRoleCode(event.target.value)}
                          placeholder={t("rbac.roleCode")}
                          size="compact"
                        />
                        <ClassicTextInput
                          value={roleName}
                          onChange={(event) => setRoleName(event.target.value)}
                          placeholder={t("rbac.roleName")}
                          size="compact"
                        />
                      </>
                    )}
                    <PageActionButton
                      type="submit"
                      disabled={createRoleMutation.isPending}
                      preset="primary"
                      size="md"
                      loading={createRoleMutation.isPending}
                      leadingIcon={<Plus size={15} />}
                    >
                      {t("rbac.add")}
                    </PageActionButton>
                  </form>
                </section>

                <section className={RBAC_PANEL_CLASS}>
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">{t("rbac.roleManagement")}</h2>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{roles.length}</span>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                <div className="space-y-3">
                  <label className="relative block">
                    <span className="sr-only">{t("rbac.roleSearch")}</span>
                    <Search
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    {isWorkspaceSubpage ? (
                      <WorkspaceTextInput
                        value={roleSearch}
                        onChange={(event) => setRoleSearch(event.target.value)}
                        placeholder={t("rbac.roleSearchPlaceholder")}
                        size="compact"
                        className="pl-9 pr-9"
                      />
                    ) : (
                      <ClassicTextInput
                        value={roleSearch}
                        onChange={(event) => setRoleSearch(event.target.value)}
                        placeholder={t("rbac.roleSearchPlaceholder")}
                        size="compact"
                        className="pl-9 pr-9"
                      />
                    )}
                    {roleSearch ? (
                      <PageActionButton
                        type="button"
                        onClick={() => setRoleSearch("")}
                        preset="secondary"
                        size="icon-sm"
                        className="absolute right-2 top-1/2 -translate-y-1/2"
                        aria-label={t("rbac.clearRoleSearch")}
                        title={t("rbac.clearRoleSearch")}
                        leadingIcon={<X size={14} aria-hidden="true" />}
                      />
                    ) : null}
                  </label>

                  {filteredRoles.length ? filteredRoles.map((role) => {
                    const active = selectedPermissionRole?.id === role.id;
                    return (
                      <LayoutActionSurfaceButton
                        key={role.id}
                        appearance={actionAppearance}
                        preset="secondary"
                        aria-pressed={active}
                        onClick={() => setSelectedPermissionRoleId(role.id)}
                        style={RBAC_SELECTABLE_SURFACE_STYLE}
                        className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left active:scale-[0.99]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{role.name}</div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                            <span className="max-w-full truncate text-xs text-slate-500 dark:text-slate-400">
                              {role.code}
                            </span>
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {t("rbac.roleUserCount", { count: role.user_count })}
                            </span>
                          </div>
                        </div>
                        {role.is_admin ? (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {t("rbac.adminRole")}
                          </span>
                        ) : null}
                      </LayoutActionSurfaceButton>
                    );
                  }) : (
                    <div className={`${RBAC_FIELD_CARD_CLASS} border-dashed px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400`}>
                      {t("rbac.noMatchingRoles")}
                    </div>
                  )}
                </div>

                <div className="min-w-0 border-t border-slate-200 pt-4 dark:border-slate-800 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{t("rbac.permissionEditor")}</h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {selectedPermissionRole ? selectedPermissionRole.name : emptyPermissionRoleMessage}
                    </p>
                  </div>
                  <PageActionButton
                    disabled={
                      !selectedPermissionRole ||
                      selectedPermissionRole.is_admin ||
                      !rolePermissionDraft ||
                      saveRolePermissionsMutation.isPending
                    }
                    onClick={() => saveRolePermissionsMutation.mutate()}
                    preset="primary"
                    size="md"
                    loading={saveRolePermissionsMutation.isPending}
                    leadingIcon={<Save size={15} />}
                  >
                    {t("rbac.savePermissions")}
                  </PageActionButton>
                </div>

                {!selectedPermissionRole ? (
                  <div className={`${RBAC_FIELD_CARD_CLASS} px-3 py-6 text-sm text-slate-500 dark:text-slate-400`}>
                    {emptyPermissionRoleMessage}
                  </div>
                ) : permissionsLoading ? (
                  <div className={`${RBAC_FIELD_CARD_CLASS} flex items-center gap-2 px-3 py-6 text-sm text-slate-500 dark:text-slate-400`}>
                    <Loader2 size={16} className="animate-spin" />
                    {t("app.loading")}
                  </div>
                ) : permissionCatalogQuery.isError || rolePermissionsQuery.isError || !rolePermissionDraft ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm font-medium text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200">
                    {t("rbac.permissionCatalogLoadFailed")}
                  </div>
                ) : selectedPermissionRole.is_admin ? (
                  <div className={`${RBAC_FIELD_CARD_CLASS} px-3 py-6 text-sm text-slate-600 dark:text-slate-300`}>
                    {t("rbac.adminRoleReadonly")}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold">{t("rbac.menuPermissions")}</h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {permissionGroups.map((group) => (
                          <RbacOptionToggle
                            key={group.menuCode}
                            checked={rolePermissionDraft.menu_codes.includes(group.menuCode)}
                            workspaceSubpage={isWorkspaceSubpage}
                            onChange={(checked) =>
                              setRolePermissionDraft((current) =>
                                current ? toggleMenuPermissionDraft(current, group, checked) : current,
                              )
                            }
                          >
                            <span>
                              <div className="font-medium">{group.menuTitle}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{group.menuCode}</div>
                            </span>
                          </RbacOptionToggle>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-sm font-semibold">{t("rbac.apiPermissions")}</h3>
                      <div className="space-y-4">
                        {permissionGroups.map((group) => (
                          <div key={group.menuCode} className={`${RBAC_FIELD_CARD_CLASS} p-3`}>
                            <div className="mb-3 text-sm font-semibold">{group.menuTitle}</div>
                            <div className="space-y-2">
                              {group.apiPermissions.map((permission) => (
                                <RbacOptionToggle
                                  key={permission.code}
                                  checked={rolePermissionDraft.api_permission_codes.includes(permission.code)}
                                  workspaceSubpage={isWorkspaceSubpage}
                                  onChange={(checked) =>
                                    setRolePermissionDraft((current) =>
                                      current
                                        ? toggleApiPermissionDraft(current, group.menuCode, permission.code, checked)
                                        : current,
                                    )
                                  }
                                >
                                  <div className="min-w-0">
                                    <div className="font-medium">{permission.title}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">{permission.code}</div>
                                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                      {permission.description}
                                    </div>
                                  </div>
                                </RbacOptionToggle>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              </div>
            </section>
              </>
            ) : null}

            {activeSection === "users" ? (
              <>
            <section className="pf-table-panel pf-governed-table-panel pf-rbac-user-table-panel">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">{t("rbac.users")}</h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {t("rbac.userPaginationSummary", {
                        page: userPage,
                        totalPages: userTotalPages,
                        total: userTotal,
                      })}
                    </p>
                  </div>
                  <form className="grid gap-2 sm:grid-cols-[1fr_180px_auto_auto]" onSubmit={handleUserSearch}>
                    <label className="min-w-0">
                      <span className="sr-only">{t("rbac.userSearch")}</span>
                      <div className="relative">
                        <Search
                          size={15}
                          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        />
                        {isWorkspaceSubpage ? (
                          <WorkspaceTextInput
                            value={userSearchDraft}
                            onChange={(event) => setUserSearchDraft(event.target.value)}
                            placeholder={t("rbac.userSearchPlaceholder")}
                            size="compact"
                            className="pl-9 pr-3"
                          />
                        ) : (
                          <ClassicTextInput
                            value={userSearchDraft}
                            onChange={(event) => setUserSearchDraft(event.target.value)}
                            placeholder={t("rbac.userSearchPlaceholder")}
                            size="compact"
                            className="pl-9 pr-3"
                          />
                        )}
                      </div>
                    </label>
                    <label className="min-w-0">
                      <span className="sr-only">{t("rbac.userRoleFilter")}</span>
                      {isWorkspaceSubpage ? (
                        <WorkspaceSelectField
                          value={userRoleFilter}
                          onChange={(value) => {
                            setUserRoleFilter(value);
                            setUserPage(1);
                          }}
                          size="compact"
                          options={[
                            { value: "", label: t("rbac.allRoles") },
                            ...roles.map((role) => ({ value: role.id, label: role.name })),
                          ]}
                        />
                      ) : (
                        <ClassicSelectField
                          value={userRoleFilter}
                          onChange={(value) => {
                            setUserRoleFilter(value);
                            setUserPage(1);
                          }}
                          size="compact"
                          options={[
                            { value: "", label: t("rbac.allRoles") },
                            ...roles.map((role) => ({ value: role.id, label: role.name })),
                          ]}
                        />
                      )}
                    </label>
                    <PageActionButton
                      type="submit"
                      disabled={usersQuery.isFetching}
                      preset="primary"
                      size="md"
                      loading={usersQuery.isFetching}
                    >
                      {t("rbac.search")}
                    </PageActionButton>
                    {userFiltersActive ? (
                      <PageActionButton
                        onClick={handleClearUserFilters}
                        disabled={usersQuery.isFetching}
                        preset="secondary"
                        size="md"
                      >
                        {t("rbac.clearFilters")}
                      </PageActionButton>
                    ) : null}
                  </form>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
	                    <tr>
	                      <th className="px-4 py-3">{t("rbac.username")}</th>
	                      <th className="px-4 py-3">{t("rbac.role")}</th>
	                      <th className="px-4 py-3">{t("rbac.resourceGroups")}</th>
	                      <th className="px-4 py-3">{t("rbac.status")}</th>
	                      <th className="px-4 py-3 text-right">{t("inspirations.table.actions")}</th>
	                    </tr>
                  </thead>
                  <tbody className="pf-gradient-table-body">
                    {users.length ? (
                      users.map((user) => {
                        const disabled = !user.enabled;
                        const statusLabel = disabled
                          ? t("rbac.disabled")
                          : user.password_pending
                            ? t("rbac.passwordPending")
                            : t("rbac.enabled");

                        return (
                          <tr key={user.id} className={rbacUserRowClassName(user)}>
                            <td className="px-4 py-3">
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className={disabled ? "font-semibold text-rose-800 dark:text-rose-100" : "font-medium"}>
                                  {user.display_name}
                                </span>
                                {disabled ? (
                                  <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200">
                                    {t("rbac.disabled")}
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{user.username}</div>
	                            </td>
	                            <td className="px-4 py-3">{user.role_name}</td>
		                            <td className="px-4 py-3">
		                              <PageActionButton
		                                type="button"
		                                onClick={() => openResourceGroupGrantDialog(user)}
		                                disabled={pendingUserActionBusy}
		                                preset="secondary"
		                                size="sm"
		                                className="max-w-md justify-start gap-0 text-left"
		                                aria-label={t("rbac.editResourceGroups")}
		                                title={rbacUserResourceGroupSummary(user, t("rbac.noGrantedResourceGroups"))}
		                              >
		                                <span className="truncate">
		                                  {rbacUserResourceGroupSummary(user, t("rbac.noGrantedResourceGroups"))}
		                                </span>
		                              </PageActionButton>
		                            </td>
	                            <td className="px-4 py-3">
	                              <div className="flex flex-col items-start gap-1">
	                                <span className={rbacUserStatusBadgeClassName(user)}>
	                                  {disabled ? <Power size={12} aria-hidden="true" /> : null}
                                  {statusLabel}
                                </span>
                                {user.possibly_online ? (
                                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
                                    {t("rbac.possiblyOnline")}
                                  </span>
                                ) : null}
                                <div className="space-y-0.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                                  <div>
                                    {t("rbac.lastLogin")} {formatDateTime(user.last_login_at)}
                                  </div>
                                  <div>
                                    {t("rbac.lastSeen")} {formatDateTime(user.last_seen_at)}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <PageActionButton
                                  type="button"
                                  onClick={() => openResourceGroupGrantDialog(user)}
                                  disabled={pendingUserActionBusy}
                                  preset="secondary"
                                  size="icon-sm"
                                  aria-label={t("rbac.editResourceGroups")}
                                  title={t("rbac.editResourceGroups")}
                                  leadingIcon={<ShieldCheck size={14} aria-hidden="true" />}
                                />
                                {!user.is_admin ? (
                                  <>
                                    <PageActionButton
                                      type="button"
                                      onClick={() => setPendingUserAction({ kind: "reset-password", user })}
                                      disabled={pendingUserActionBusy}
                                      preset="secondary"
                                      size="icon-sm"
                                      aria-label={t("rbac.resetPassword")}
                                      title={t("rbac.resetPassword")}
                                      leadingIcon={<KeyRound size={14} aria-hidden="true" />}
                                    />
                                    <PageActionButton
                                      type="button"
                                      onClick={() =>
                                        setPendingUserAction({ kind: "set-enabled", user, enabled: !user.enabled })
                                      }
                                      disabled={pendingUserActionBusy}
                                      preset={user.enabled ? "danger" : "secondary"}
                                      size="icon-sm"
                                      aria-label={user.enabled ? t("rbac.disable") : t("rbac.enable")}
                                      title={user.enabled ? t("rbac.disable") : t("rbac.enable")}
                                      leadingIcon={
                                        user.enabled ? (
                                          <Power size={14} aria-hidden="true" />
                                        ) : (
                                          <RefreshCcw size={14} aria-hidden="true" />
                                        )
                                      }
                                    />
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
	                    ) : (
	                      <tr>
	                        <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
	                          {usersQuery.isFetching ? t("app.loading") : t("rbac.noMatchingUsers")}
	                        </td>
	                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {t("rbac.userPaginationSummary", {
                    page: userPage,
                    totalPages: userTotalPages,
                    total: userTotal,
                  })}
                </span>
                <RbacPagination
                  page={userPage}
                  totalPages={userTotalPages}
                  onPageChange={setUserPage}
                  disabled={usersQuery.isFetching}
                  workspaceSubpage={isWorkspaceSubpage}
                />
              </div>
            </section>
	          </>
	        ) : null}
          </>
        )}
      </main>
      <ConfirmDialog
        open={Boolean(pendingUserAction)}
        appearance={isWorkspaceSubpage ? "workspace" : "classic"}
        title={pendingUserActionTitle}
        description={pendingUserActionDescription}
        confirmLabel={pendingUserActionConfirmLabel}
        cancelLabel={t("common.cancel")}
        busy={pendingUserActionBusy}
        destructive={pendingUserAction?.kind === "reset-password" || pendingUserAction?.enabled === false}
        onClose={() => setPendingUserAction(null)}
        onConfirm={handleConfirmUserAction}
      />
      <ResourceGroupGrantDialog
        open={resourceGroupGrantDialogOpen}
        user={resourceGroupGrantUser}
        groups={generationResourceGroups}
        draft={resourceGroupGrantDraft}
        loading={resourceGroupGrantsLoading}
        busy={saveResourceGroupGrantsMutation.isPending}
        workspaceSubpage={isWorkspaceSubpage}
        hasError={generationResourceGroupsQuery.isError || resourceGroupGrantsQuery.isError}
        onClose={() => {
          if (saveResourceGroupGrantsMutation.isPending) {
            return;
          }
          setResourceGroupGrantUser(null);
        }}
        onSave={() => saveResourceGroupGrantsMutation.mutate()}
        onToggleGroup={(groupId, checked) => {
          setResourceGroupGrantDraft((current) => {
            const next = new Set(current);
            if (checked) {
              next.add(groupId);
            } else {
              next.delete(groupId);
            }
            return [...next].sort();
          });
        }}
      />
      <RbacFeedbackDialog
        successMessage={feedbackSuccess}
        errorMessage={feedbackError}
        workspaceSubpage={isWorkspaceSubpage}
        onCloseSuccess={() => setFeedbackSuccess("")}
        onCloseError={() => setFeedbackError("")}
      />
    </div>
  );
}

interface ResourceGroupGrantDialogProps {
  open: boolean;
  user: RbacUser | null;
  groups: GenerationResourceGroup[];
  draft: string[];
  loading: boolean;
  busy: boolean;
  workspaceSubpage?: boolean;
  hasError: boolean;
  onClose: () => void;
  onSave: () => void;
  onToggleGroup: (groupId: string, checked: boolean) => void;
}

function RbacFeedbackDialog({
  successMessage,
  errorMessage,
  workspaceSubpage = false,
  onCloseSuccess,
  onCloseError,
}: {
  successMessage: string;
  errorMessage: string;
  workspaceSubpage?: boolean;
  onCloseSuccess: () => void;
  onCloseError: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const PageActionButton = rbacActionButtonComponent(workspaceSubpage);
  const open = Boolean(successMessage || errorMessage);
  const isError = Boolean(errorMessage);
  const message = errorMessage || successMessage;

  useEffect(() => {
    if (!successMessage || isError) {
      return undefined;
    }
    const timer = window.setTimeout(onCloseSuccess, RBAC_FEEDBACK_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [isError, onCloseSuccess, successMessage]);

  if (!open) {
    return null;
  }

  const Icon = isError ? X : CheckCircle2;

  return (
    <ModalShell
      open={open}
      role={isError ? "alertdialog" : "dialog"}
      onClose={isError ? onCloseError : onCloseSuccess}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      overlayClassName="z-[95] bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
    >
        <div className="flex items-start gap-3 px-5 py-5">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isError
                ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200"
                : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200"
            }`}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
              {isError ? t("settings.operationFailed") : t("settings.operationSucceeded")}
            </h2>
            <p id={descriptionId} className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
              {message}
            </p>
          </div>
          {isError ? (
            <PageActionButton
              type="button"
              onClick={onCloseError}
              preset="secondary"
              size="icon-sm"
              aria-label={t("common.close")}
              title={t("common.close")}
              leadingIcon={<X size={15} />}
            />
          ) : null}
        </div>
    </ModalShell>
  );
}

function ResourceGroupGrantDialog({
  open,
  user,
  groups,
  draft,
  loading,
  busy,
  workspaceSubpage = false,
  hasError,
  onClose,
  onSave,
  onToggleGroup,
}: ResourceGroupGrantDialogProps) {
  const { t } = useI18n();
  const PageActionButton = rbacActionButtonComponent(workspaceSubpage);

  if (!open || !user) {
    return null;
  }

  const readonly = user.is_admin;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      ariaLabel={t("rbac.resourceGroupGrants")}
      overlayClassName="z-[90] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="flex w-full max-w-3xl max-h-[min(80vh,720px)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/25 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
    >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">{t("rbac.resourceGroupGrants")}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {user.display_name} · {user.username}
            </p>
          </div>
          <PageActionButton
            type="button"
            onClick={onClose}
            disabled={busy}
            preset="secondary"
            size="icon-sm"
            aria-label={t("common.cancel")}
            title={t("common.cancel")}
            leadingIcon={<X size={15} />}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {readonly ? (
            <div className={`${RBAC_FIELD_CARD_CLASS} px-4 py-6 text-sm text-slate-600 dark:text-slate-300`}>
              {t("rbac.adminResourceGroupsReadonly")}
            </div>
          ) : loading ? (
            <div className={`${RBAC_FIELD_CARD_CLASS} flex items-center gap-2 px-4 py-6 text-sm text-slate-500 dark:text-slate-400`}>
              <Loader2 size={16} className="animate-spin" />
              {t("app.loading")}
            </div>
          ) : hasError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200">
              {t("rbac.resourceGroupsLoadFailed")}
            </div>
          ) : groups.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {groups.map((group) => (
                <ResourceGroupGrantCheckbox
                  key={group.id}
                  group={group}
                  checked={draft.includes(group.id)}
                  disabled={busy}
                  workspaceSubpage={workspaceSubpage}
                  onToggle={(checked) => onToggleGroup(group.id, checked)}
                />
              ))}
            </div>
          ) : (
            <div className={`${RBAC_FIELD_CARD_CLASS} border-dashed px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400`}>
              {t("rbac.noResourceGroups")}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
          <PageActionButton onClick={onClose} disabled={busy} preset="secondary" size="md">
            {t("common.cancel")}
          </PageActionButton>
          <PageActionButton
            onClick={onSave}
            disabled={readonly || loading || busy}
            preset="primary"
            size="md"
            loading={busy}
            leadingIcon={<Save size={14} />}
          >
            {t("rbac.saveResourceGroups")}
          </PageActionButton>
        </div>
    </ModalShell>
  );
}

function RbacOptionToggle({
  checked,
  disabled = false,
  workspaceSubpage = false,
  children,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  workspaceSubpage?: boolean;
  children: React.ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return workspaceSubpage ? (
    <WorkspaceOptionToggle
      checked={checked}
      disabled={disabled}
      layout="card"
      onChange={onChange}
    >
      {children}
    </WorkspaceOptionToggle>
  ) : (
    <ClassicOptionToggle checked={checked} disabled={disabled} layout="card" onChange={onChange}>
      <span className="min-w-0 leading-5">{children}</span>
    </ClassicOptionToggle>
  );
}

function ResourceGroupGrantCheckbox({
  group,
  checked,
  disabled,
  workspaceSubpage = false,
  onToggle,
}: {
  group: GenerationResourceGroup;
  checked: boolean;
  disabled: boolean;
  workspaceSubpage?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <RbacOptionToggle
      checked={checked}
      disabled={disabled}
      workspaceSubpage={workspaceSubpage}
      onChange={onToggle}
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 font-medium text-slate-900 dark:text-slate-100">
          {group.name}
          {!group.enabled ? (
            <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {t("rbac.resourceGroupDisabled")}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block font-mono text-xs text-slate-500 dark:text-slate-400">{group.key}</span>
        {group.description ? (
          <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{group.description}</span>
        ) : null}
      </span>
    </RbacOptionToggle>
  );
}

function RbacPagination({
  page,
  totalPages,
  onPageChange,
  disabled,
  workspaceSubpage = false,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled: boolean;
  workspaceSubpage?: boolean;
}) {
  const { t } = useI18n();
  const PageActionButton = rbacActionButtonComponent(workspaceSubpage);

  return (
    <div className="inline-flex items-center gap-2">
      <PageActionButton
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={disabled || page <= 1}
        preset="secondary"
        size="sm"
        leadingIcon={<ChevronLeft size={14} aria-hidden="true" />}
      >
        {t("pagination.previous")}
      </PageActionButton>
      <span className="min-w-16 text-center text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
        {page} / {totalPages}
      </span>
      <PageActionButton
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={disabled || page >= totalPages}
        preset="secondary"
        size="sm"
        trailingIcon={<ChevronRight size={14} aria-hidden="true" />}
      >
        {t("pagination.next")}
      </PageActionButton>
    </div>
  );
}

function rbacUserRowClassName(user: RbacUser): string | undefined {
  if (user.enabled) {
    return undefined;
  }
  return "bg-rose-50/70 dark:bg-rose-950/20";
}

function rbacUserStatusBadgeClassName(user: RbacUser): string {
  if (!user.enabled) {
    return "inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200";
  }
  if (user.password_pending) {
    return "inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200";
  }
  return "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  return fallback;
}
