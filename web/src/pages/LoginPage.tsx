import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useI18n } from "../lib/preferences";

interface LoginPageProps {
  authenticated: boolean;
}

export function LoginPage({ authenticated }: LoginPageProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"login" | "password">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (authenticated) {
      navigate("/products", { replace: true });
    }
  }, [authenticated, navigate]);

  const loginMutation = useMutation({
    mutationFn: (payload: { username: string; password: string; mode: "login" | "password" }) =>
      payload.mode === "login"
        ? api.login(payload.username, payload.password)
        : api.setPassword(payload.username, payload.password),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/products", { replace: true });
    },
    onError: (mutationError) => {
      if (mutationError instanceof ApiError) {
        setError(mutationError.detail);
        return;
      }
      setError(t("login.error"));
    },
  });

  const handleLogin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError(t("login.missingFields"));
      return;
    }
    if (mode === "password") {
      if (password.length < 6) {
        setError(t("login.passwordTooShort"));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("login.passwordMismatch"));
        return;
      }
    }
    loginMutation.mutate({ username: username.trim(), password, mode });
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-[#060a12] dark:text-slate-100">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#e4e4e7_1px,transparent_1px),linear-gradient(to_bottom,#e4e4e7_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-50 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_70%,transparent_100%)] dark:bg-[linear-gradient(to_right,rgba(71,85,105,0.34)_1px,transparent_1px),linear-gradient(to_bottom,rgba(71,85,105,0.34)_1px,transparent_1px)] dark:opacity-70" />

      <div className="relative w-full max-w-sm px-6">
        <div className="mb-10">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 shadow-sm shadow-zinc-900/20 dark:border dark:border-violet-400/35 dark:bg-violet-500/18 dark:shadow-violet-950/30">
            <LayoutGrid size={20} className="text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">ProductFlow</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">
            {mode === "login" ? t("login.loginHint") : t("login.setPasswordHint")}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-zinc-200 bg-white p-1 text-xs font-semibold shadow-sm dark:border-slate-700 dark:bg-[#0b1220]">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError("");
            }}
            className={`rounded-md px-3 py-2 transition-colors ${
              mode === "login"
                ? "bg-zinc-900 text-white dark:bg-violet-500"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            }`}
          >
            {t("login.mode.login")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setError("");
            }}
            className={`rounded-md px-3 py-2 transition-colors ${
              mode === "password"
                ? "bg-zinc-900 text-white dark:bg-violet-500"
                : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            }`}
          >
            {t("login.mode.password")}
          </button>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-slate-400">
              {t("login.username")}
            </label>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 transition-shadow placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
              placeholder={t("login.usernamePlaceholder")}
              autoComplete="username"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-slate-400">
              {mode === "login" ? t("login.password") : t("login.newPassword")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 transition-shadow placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
              placeholder={t("login.passwordPlaceholder")}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {mode === "password" ? (
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-slate-400">
                {t("login.confirmPassword")}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 transition-shadow placeholder:text-zinc-400 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/25"
                placeholder={t("login.confirmPasswordPlaceholder")}
                autoComplete="new-password"
              />
            </div>
          ) : null}

          {error ? <div className="text-xs font-medium text-red-500 dark:text-red-300">{error}</div> : null}

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="flex w-full items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-zinc-900/20 transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-gradient-to-r dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/35"
          >
            {mode === "login" ? t("login.submit") : t("login.setPassword")}
            <ArrowRight size={14} className="ml-2 opacity-70" />
          </button>
        </form>
      </div>
    </div>
  );
}
