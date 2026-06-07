import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
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

import { ConfirmDialog } from "../components/ConfirmDialog";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/preferences";
import type {
  GenerationResourceGroup,
  RbacApiPermission,
  RbacPermissionCatalog,
  RbacRolePermissions,
  RbacUser,
} from "../lib/types";

const RBAC_USER_PAGE_SIZE = 20;

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

export function rbacUserListQueryKey(page: number, username: string, roleId: string) {
  return ["rbac-users", page, username, roleId] as const;
}

type RbacUserListQueryKey = ReturnType<typeof rbacUserListQueryKey>;

export function RbacPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
  const generationResourceGroupsQuery = useQuery({
    queryKey: ["generation-resource-groups"],
    queryFn: api.listGenerationResourceGroups,
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
    () =>
      (generationResourceGroupsQuery.data ?? [])
        .filter((group) => !group.archived_at)
        .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name)),
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
    enabled: Boolean(resourceGroupGrantUser && !resourceGroupGrantUser.is_admin),
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
    onSuccess: async () => {
      setUsername("");
      setDisplayName("");
      setMessage(t("rbac.userCreated"));
      setError("");
      await Promise.all([refreshCurrentUserList(), queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })]);
    },
    onError: (mutationError) => setError(errorMessage(mutationError, t("rbac.createUserFailed"))),
  });

  const createRoleMutation = useMutation({
    mutationFn: () => api.createRbacRole({ code: roleCode.trim(), name: roleName.trim() }),
    onSuccess: async (createdRole) => {
      setRoleCode("");
      setRoleName("");
      setSelectedPermissionRoleId(createdRole.id);
      setMessage(t("rbac.roleCreated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["rbac-roles"] });
    },
    onError: (mutationError) => setError(errorMessage(mutationError, t("rbac.createRoleFailed"))),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: api.resetRbacUserPassword,
    onSuccess: async () => {
      setPendingUserAction(null);
      setMessage(t("rbac.passwordReset"));
      setError("");
      await Promise.all([refreshCurrentUserList(), queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })]);
    },
    onError: (mutationError) => setError(errorMessage(mutationError, t("rbac.resetPasswordFailed"))),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, enabled }: { userId: string; enabled: boolean }) =>
      api.updateRbacUser(userId, { enabled }),
    onSuccess: async () => {
      setPendingUserAction(null);
      setMessage(t("rbac.userUpdated"));
      setError("");
      await Promise.all([refreshCurrentUserList(), queryClient.invalidateQueries({ queryKey: ["rbac-roles"] })]);
    },
    onError: (mutationError) => setError(errorMessage(mutationError, t("rbac.updateUserFailed"))),
  });

  const saveRolePermissionsMutation = useMutation({
    mutationFn: () =>
      api.updateRbacRolePermissions(selectedPermissionRole!.id, {
        menu_codes: rolePermissionDraft?.menu_codes ?? [],
        api_permission_codes: rolePermissionDraft?.api_permission_codes ?? [],
      }),
    onSuccess: async (payload) => {
      setRolePermissionDraft(rolePermissionDraftFromResponse(payload));
      setMessage(t("rbac.permissionsSaved"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["rbac-role-permissions", payload.role_id] });
    },
    onError: (mutationError) => setError(errorMessage(mutationError, t("rbac.savePermissionsFailed"))),
  });

  const saveResourceGroupGrantsMutation = useMutation({
    mutationFn: () =>
      api.updateUserGenerationResourceGroupGrants(resourceGroupGrantUser!.id, {
        resource_group_ids: resourceGroupGrantDraft,
      }),
    onSuccess: async (payload) => {
      setResourceGroupGrantDraft([...payload.resource_group_ids]);
      setMessage(t("rbac.resourceGroupsSaved"));
      setError("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rbac-user-generation-resource-groups", payload.user_id] }),
        refreshCurrentUserList(),
      ]);
    },
    onError: (mutationError) => setError(errorMessage(mutationError, t("rbac.saveResourceGroupsFailed"))),
  });

  const handleCreateUser = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!username.trim()) {
      setError(t("rbac.usernameRequired"));
      return;
    }
    createUserMutation.mutate();
  };

  const handleCreateRole = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!roleCode.trim() || !roleName.trim()) {
      setError(t("rbac.roleRequired"));
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

  const loading = usersQuery.isLoading || rolesQuery.isLoading;
  const permissionsLoading = permissionCatalogQuery.isLoading || rolePermissionsQuery.isLoading;
  const resourceGroupGrantsLoading =
    generationResourceGroupsQuery.isLoading || resourceGroupGrantsQuery.isLoading;
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

  return (
    <div className="pf-app">
      <TopNav
        breadcrumbs={t("rbac.breadcrumb")}
        onHome={() => navigate("/products")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main className="pf-page flex flex-col gap-6">
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

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        ) : null}
        {message ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200">
            {message}
          </div>
        ) : null}

        <div
          className="inline-flex w-full gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:w-fit"
          role="tablist"
          aria-label={t("rbac.title")}
        >
          {(["users", "roles"] as const).map((section) => {
            const active = activeSection === section;
            return (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSection(section)}
                className={`inline-flex h-9 flex-1 items-center justify-center rounded-md px-4 text-sm font-semibold transition-colors sm:flex-none ${
                  active
                    ? "bg-slate-950 text-white shadow-sm dark:bg-violet-500"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                }`}
              >
                {section === "users" ? t("rbac.userManagement") : t("rbac.roleManagement")}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-8 text-sm text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
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
              <section className="pf-panel p-4">
                <div className="mb-4 flex items-center gap-2">
                  <UserPlus size={18} className="text-slate-500 dark:text-slate-400" />
                  <h2 className="text-sm font-semibold">{t("rbac.createUser")}</h2>
                </div>
                <form className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={handleCreateUser}>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder={t("rbac.username")}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                  />
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={t("rbac.displayName")}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                  />
                  <select
                    value={selectedRoleId}
                    onChange={(event) => setRoleId(event.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                  >
                    {assignableRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={createUserMutation.isPending}
                    className="inline-flex items-center justify-center rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
                  >
                    {createUserMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    <span className="ml-1.5">{t("rbac.add")}</span>
                  </button>
                </form>
              </section>
            ) : null}
            {activeSection === "roles" ? (
              <>
                <section className="pf-panel p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <ShieldCheck size={18} className="text-slate-500 dark:text-slate-400" />
                    <h2 className="text-sm font-semibold">{t("rbac.createRole")}</h2>
                  </div>
                  <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreateRole}>
                    <input
                      value={roleCode}
                      onChange={(event) => setRoleCode(event.target.value)}
                      placeholder={t("rbac.roleCode")}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                    />
                    <input
                      value={roleName}
                      onChange={(event) => setRoleName(event.target.value)}
                      placeholder={t("rbac.roleName")}
                      className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                    />
                    <button
                      type="submit"
                      disabled={createRoleMutation.isPending}
                      className="inline-flex items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-900"
                    >
                      {createRoleMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      <span className="ml-1.5">{t("rbac.add")}</span>
                    </button>
                  </form>
                </section>

                <section className="pf-panel p-4">
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
                    <input
                      value={roleSearch}
                      onChange={(event) => setRoleSearch(event.target.value)}
                      placeholder={t("rbac.roleSearchPlaceholder")}
                      className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition-colors focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                    />
                    {roleSearch ? (
                      <button
                        type="button"
                        onClick={() => setRoleSearch("")}
                        className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        aria-label={t("rbac.clearRoleSearch")}
                        title={t("rbac.clearRoleSearch")}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </label>

                  {filteredRoles.length ? filteredRoles.map((role) => {
                    const active = selectedPermissionRole?.id === role.id;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => setSelectedPermissionRoleId(role.id)}
                        className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-50"
                            : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                        }`}
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
                      </button>
                    );
                  }) : (
                    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
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
                  <button
                    type="button"
                    disabled={
                      !selectedPermissionRole ||
                      selectedPermissionRole.is_admin ||
                      !rolePermissionDraft ||
                      saveRolePermissionsMutation.isPending
                    }
                    onClick={() => saveRolePermissionsMutation.mutate()}
                    className="inline-flex items-center justify-center rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
                  >
                    {saveRolePermissionsMutation.isPending ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Save size={15} />
                    )}
                    <span className="ml-1.5">{t("rbac.savePermissions")}</span>
                  </button>
                </div>

                {!selectedPermissionRole ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    {emptyPermissionRoleMessage}
                  </div>
                ) : permissionsLoading ? (
                  <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    {t("app.loading")}
                  </div>
                ) : permissionCatalogQuery.isError || rolePermissionsQuery.isError || !rolePermissionDraft ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm font-medium text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200">
                    {t("rbac.permissionCatalogLoadFailed")}
                  </div>
                ) : selectedPermissionRole.is_admin ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {t("rbac.adminRoleReadonly")}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold">{t("rbac.menuPermissions")}</h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {permissionGroups.map((group) => (
                          <label
                            key={group.menuCode}
                            className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm dark:border-slate-800"
                          >
                            <input
                              type="checkbox"
                              checked={rolePermissionDraft.menu_codes.includes(group.menuCode)}
                              onChange={(event) =>
                                setRolePermissionDraft((current) =>
                                  current ? toggleMenuPermissionDraft(current, group, event.target.checked) : current,
                                )
                              }
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-950 dark:text-violet-400"
                            />
                            <div>
                              <div className="font-medium">{group.menuTitle}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{group.menuCode}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h3 className="mb-3 text-sm font-semibold">{t("rbac.apiPermissions")}</h3>
                      <div className="space-y-4">
                        {permissionGroups.map((group) => (
                          <div key={group.menuCode} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                            <div className="mb-3 text-sm font-semibold">{group.menuTitle}</div>
                            <div className="space-y-2">
                              {group.apiPermissions.map((permission) => (
                                <label
                                  key={permission.code}
                                  className="flex items-start gap-3 rounded-md border border-slate-100 px-3 py-3 text-sm dark:border-slate-900"
                                >
                                  <input
                                    type="checkbox"
                                    checked={rolePermissionDraft.api_permission_codes.includes(permission.code)}
                                    onChange={(event) =>
                                      setRolePermissionDraft((current) =>
                                        current
                                          ? toggleApiPermissionDraft(
                                              current,
                                              group.menuCode,
                                              permission.code,
                                              event.target.checked,
                                            )
                                          : current,
                                      )
                                    }
                                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-950 dark:text-violet-400"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-medium">{permission.title}</div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">{permission.code}</div>
                                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                      {permission.description}
                                    </div>
                                  </div>
                                </label>
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
            {resourceGroupGrantUser ? (
              <section className="pf-panel p-4">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">{t("rbac.resourceGroupGrants")}</h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {resourceGroupGrantUser.display_name} · {resourceGroupGrantUser.username}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setResourceGroupGrantUser(null)}
                      className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveResourceGroupGrantsMutation.mutate()}
                      disabled={
                        resourceGroupGrantUser.is_admin ||
                        resourceGroupGrantsLoading ||
                        saveResourceGroupGrantsMutation.isPending
                      }
                      className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
                    >
                      {saveResourceGroupGrantsMutation.isPending ? (
                        <Loader2 size={14} className="mr-1.5 animate-spin" />
                      ) : (
                        <Save size={14} className="mr-1.5" />
                      )}
                      {t("rbac.saveResourceGroups")}
                    </button>
                  </div>
                </div>
                {resourceGroupGrantUser.is_admin ? (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                    {t("rbac.adminResourceGroupsReadonly")}
                  </div>
                ) : resourceGroupGrantsLoading ? (
                  <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    {t("app.loading")}
                  </div>
                ) : generationResourceGroupsQuery.isError || resourceGroupGrantsQuery.isError ? (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm font-medium text-red-700 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-200">
                    {t("rbac.resourceGroupsLoadFailed")}
                  </div>
                ) : generationResourceGroups.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {generationResourceGroups.map((group) => (
                      <ResourceGroupGrantCheckbox
                        key={group.id}
                        group={group}
                        checked={resourceGroupGrantDraft.includes(group.id)}
                        disabled={saveResourceGroupGrantsMutation.isPending}
                        onToggle={(checked) => {
                          setResourceGroupGrantDraft((current) => {
                            const next = new Set(current);
                            if (checked) {
                              next.add(group.id);
                            } else {
                              next.delete(group.id);
                            }
                            return [...next].sort();
                          });
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    {t("rbac.noResourceGroups")}
                  </div>
                )}
              </section>
            ) : null}

            <section className="pf-table-panel">
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
                        <input
                          value={userSearchDraft}
                          onChange={(event) => setUserSearchDraft(event.target.value)}
                          placeholder={t("rbac.userSearchPlaceholder")}
                          className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition-colors focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                        />
                      </div>
                    </label>
                    <label className="min-w-0">
                      <span className="sr-only">{t("rbac.userRoleFilter")}</span>
                      <select
                        value={userRoleFilter}
                        onChange={(event) => {
                          setUserRoleFilter(event.target.value);
                          setUserPage(1);
                        }}
                        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition-colors focus:border-slate-900 focus:ring-1 focus:ring-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:focus:border-violet-400 dark:focus:ring-violet-400/30"
                      >
                        <option value="">{t("rbac.allRoles")}</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="submit"
                      disabled={usersQuery.isFetching}
                      className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
                    >
                      {usersQuery.isFetching ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}
                      {t("rbac.search")}
                    </button>
                    {userFiltersActive ? (
                      <button
                        type="button"
                        onClick={handleClearUserFilters}
                        disabled={usersQuery.isFetching}
                        className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
                      >
                        {t("rbac.clearFilters")}
                      </button>
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
	                      <th className="px-4 py-3 text-right">{t("products.table.actions")}</th>
	                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
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
	                              <div className="flex max-w-md flex-wrap gap-1.5">
	                                {rbacUserResourceGroupLabels(user, t("rbac.noGrantedResourceGroups")).map((label) => (
	                                  <span
	                                    key={label}
	                                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
	                                      user.resource_groups.length
	                                        ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-violet-400/40 dark:bg-violet-500/10 dark:text-violet-100"
	                                        : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
	                                    }`}
	                                  >
	                                    {label}
	                                  </span>
	                                ))}
	                              </div>
	                            </td>
	                            <td className="px-4 py-3">
	                              <span className={rbacUserStatusBadgeClassName(user)}>
	                                {disabled ? <Power size={12} aria-hidden="true" /> : null}
                                {statusLabel}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setResourceGroupGrantUser(user)}
                                  disabled={pendingUserActionBusy}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-all hover:scale-[1.03] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:border-violet-400/40 dark:hover:bg-violet-500/10 dark:hover:text-violet-100"
                                  aria-label={t("rbac.editResourceGroups")}
                                  title={t("rbac.editResourceGroups")}
                                >
                                  <ShieldCheck size={14} aria-hidden="true" />
                                </button>
                                {!user.is_admin ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setPendingUserAction({ kind: "reset-password", user })}
                                      disabled={pendingUserActionBusy}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-all hover:scale-[1.03] hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:border-amber-400/40 dark:hover:bg-amber-500/10 dark:hover:text-amber-100"
                                      aria-label={t("rbac.resetPassword")}
                                      title={t("rbac.resetPassword")}
                                    >
                                      <KeyRound size={14} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPendingUserAction({ kind: "set-enabled", user, enabled: !user.enabled })
                                      }
                                      disabled={pendingUserActionBusy}
                                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-all hover:scale-[1.03] hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:border-violet-400/40 dark:hover:bg-violet-500/10 dark:hover:text-violet-100"
                                      aria-label={user.enabled ? t("rbac.disable") : t("rbac.enable")}
                                      title={user.enabled ? t("rbac.disable") : t("rbac.enable")}
                                    >
                                      {user.enabled ? (
                                        <Power size={14} aria-hidden="true" />
                                      ) : (
                                        <RefreshCcw size={14} aria-hidden="true" />
                                      )}
                                    </button>
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
        title={pendingUserActionTitle}
        description={pendingUserActionDescription}
        confirmLabel={pendingUserActionConfirmLabel}
        cancelLabel={t("common.cancel")}
        busy={pendingUserActionBusy}
        destructive={pendingUserAction?.kind === "reset-password" || pendingUserAction?.enabled === false}
        onClose={() => setPendingUserAction(null)}
        onConfirm={handleConfirmUserAction}
      />
    </div>
  );
}

function ResourceGroupGrantCheckbox({
  group,
  checked,
  disabled,
  onToggle,
}: {
  group: GenerationResourceGroup;
  checked: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
        group.enabled
          ? "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
          : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-violet-400"
      />
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
    </label>
  );
}

function RbacPagination({
  page,
  totalPages,
  onPageChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={disabled || page <= 1}
        className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-45 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
      >
        <ChevronLeft size={14} className="mr-1" aria-hidden="true" />
        {t("pagination.previous")}
      </button>
      <span className="min-w-16 text-center text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={disabled || page >= totalPages}
        className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-45 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
      >
        {t("pagination.next")}
        <ChevronRight size={14} className="ml-1" aria-hidden="true" />
      </button>
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
