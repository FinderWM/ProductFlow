import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Power, RefreshCcw, Save, ShieldCheck, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/preferences";
import type { RbacApiPermission, RbacPermissionCatalog, RbacRolePermissions } from "../lib/types";

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
  const removedPermissionCodes = new Set(group.apiPermissions.map((permission) => permission.code));
  let nextApiPermissionCodes = draft.api_permission_codes;

  if (enabled) {
    nextMenuCodes.add(group.menuCode);
  } else {
    nextMenuCodes.delete(group.menuCode);
    nextApiPermissionCodes = draft.api_permission_codes.filter((code) => !removedPermissionCodes.has(code));
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

export function RbacPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [roleName, setRoleName] = useState("");
  const [selectedPermissionRoleId, setSelectedPermissionRoleId] = useState("");
  const [rolePermissionDraft, setRolePermissionDraft] = useState<RolePermissionDraft | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const usersQuery = useQuery({ queryKey: ["rbac-users"], queryFn: api.listRbacUsers });
  const rolesQuery = useQuery({ queryKey: ["rbac-roles"], queryFn: api.listRbacRoles });
  const permissionCatalogQuery = useQuery({
    queryKey: ["rbac-permission-catalog"],
    queryFn: api.listRbacPermissionCatalog,
  });
  const roles = rolesQuery.data ?? [];
  const assignableRoles = useMemo(() => roles.filter((role) => !role.is_admin), [roles]);
  const selectedRoleId = roleId || assignableRoles[0]?.id || "";
  const selectedPermissionRole = roles.find((role) => role.id === selectedPermissionRoleId) ?? roles[0] ?? null;
  const permissionGroups = useMemo(
    () => (permissionCatalogQuery.data ? buildPermissionGroups(permissionCatalogQuery.data) : []),
    [permissionCatalogQuery.data],
  );

  const rolePermissionsQuery = useQuery({
    queryKey: ["rbac-role-permissions", selectedPermissionRole?.id ?? ""],
    queryFn: () => api.getRbacRolePermissions(selectedPermissionRole!.id),
    enabled: Boolean(selectedPermissionRole?.id),
  });

  useEffect(() => {
    if (!selectedPermissionRoleId && roles[0]?.id) {
      setSelectedPermissionRoleId(roles[0].id);
      return;
    }
    if (selectedPermissionRoleId && !roles.some((role) => role.id === selectedPermissionRoleId) && roles[0]?.id) {
      setSelectedPermissionRoleId(roles[0].id);
    }
  }, [roles, selectedPermissionRoleId]);

  useEffect(() => {
    if (!selectedPermissionRole?.id) {
      setRolePermissionDraft(null);
      return;
    }
    if (rolePermissionsQuery.data?.role_id === selectedPermissionRole.id) {
      setRolePermissionDraft(rolePermissionDraftFromResponse(rolePermissionsQuery.data));
    }
  }, [rolePermissionsQuery.data, selectedPermissionRole?.id]);

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
      await queryClient.invalidateQueries({ queryKey: ["rbac-users"] });
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
      setMessage(t("rbac.passwordReset"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["rbac-users"] });
    },
    onError: (mutationError) => setError(errorMessage(mutationError, t("rbac.resetPasswordFailed"))),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, enabled }: { userId: string; enabled: boolean }) =>
      api.updateRbacUser(userId, { enabled }),
    onSuccess: async () => {
      setMessage(t("rbac.userUpdated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["rbac-users"] });
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

  const loading = usersQuery.isLoading || rolesQuery.isLoading;
  const permissionsLoading = permissionCatalogQuery.isLoading || rolePermissionsQuery.isLoading;

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
            <section className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
              <div className="pf-panel p-4">
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
              </div>

              <div className="pf-panel p-4">
                <div className="mb-4 flex items-center gap-2">
                  <ShieldCheck size={18} className="text-slate-500 dark:text-slate-400" />
                  <h2 className="text-sm font-semibold">{t("rbac.createRole")}</h2>
                </div>
                <form className="grid gap-3" onSubmit={handleCreateRole}>
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
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
              <div className="pf-panel p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">{t("rbac.rolePermissions")}</h2>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{roles.length}</span>
                </div>
                <div className="space-y-2">
                  {roles.map((role) => {
                    const active = selectedPermissionRole?.id === role.id;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => setSelectedPermissionRoleId(role.id)}
                        className={`flex w-full items-start justify-between rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-violet-500/50 dark:bg-violet-500/10 dark:text-violet-50"
                            : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-900"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{role.name}</div>
                          <div className="truncate text-xs text-slate-500 dark:text-slate-400">{role.code}</div>
                        </div>
                        {role.is_admin ? (
                          <span className="ml-3 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {t("rbac.adminRole")}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pf-panel p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{t("rbac.permissionEditor")}</h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {selectedPermissionRole ? selectedPermissionRole.name : t("rbac.noRoles")}
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
                    {t("rbac.noRoles")}
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
            </section>

            <section className="pf-table-panel">
              <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <h2 className="text-sm font-semibold">{t("rbac.users")}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/70 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">{t("rbac.username")}</th>
                      <th className="px-4 py-3">{t("rbac.role")}</th>
                      <th className="px-4 py-3">{t("rbac.status")}</th>
                      <th className="px-4 py-3 text-right">{t("products.table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(usersQuery.data ?? []).map((user) => (
                      <tr key={user.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{user.display_name}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">{user.username}</div>
                        </td>
                        <td className="px-4 py-3">{user.role_name}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {user.password_pending
                              ? t("rbac.passwordPending")
                              : user.enabled
                                ? t("rbac.enabled")
                                : t("rbac.disabled")}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            {!user.is_admin ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => resetPasswordMutation.mutate(user.id)}
                                  disabled={resetPasswordMutation.isPending}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                                  aria-label={t("rbac.resetPassword")}
                                  title={t("rbac.resetPassword")}
                                >
                                  <KeyRound size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateUserMutation.mutate({ userId: user.id, enabled: !user.enabled })}
                                  disabled={updateUserMutation.isPending}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                                  aria-label={user.enabled ? t("rbac.disable") : t("rbac.enable")}
                                  title={user.enabled ? t("rbac.disable") : t("rbac.enable")}
                                >
                                  {user.enabled ? <Power size={14} /> : <RefreshCcw size={14} />}
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  return fallback;
}
