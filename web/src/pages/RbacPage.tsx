import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Power, RefreshCcw, ShieldCheck, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/preferences";

export function RbacPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [roleCode, setRoleCode] = useState("");
  const [roleName, setRoleName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const usersQuery = useQuery({ queryKey: ["rbac-users"], queryFn: api.listRbacUsers });
  const rolesQuery = useQuery({ queryKey: ["rbac-roles"], queryFn: api.listRbacRoles });
  const roles = rolesQuery.data ?? [];
  const assignableRoles = useMemo(() => roles.filter((role) => !role.is_admin), [roles]);
  const selectedRoleId = roleId || assignableRoles[0]?.id || "";

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
    onSuccess: async () => {
      setRoleCode("");
      setRoleName("");
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

  return (
    <div className="min-h-screen bg-slate-50 pb-24 text-slate-950 dark:bg-[#060a12] dark:text-slate-100 lg:pb-0">
      <TopNav
        breadcrumbs={t("rbac.breadcrumb")}
        onHome={() => navigate("/products")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm dark:bg-violet-500">
            <ShieldCheck size={20} />
          </div>
          <div>
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
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
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

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
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

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
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
