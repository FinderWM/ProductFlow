import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, PointerEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "../lib/api";
import { useLoginMotionLifecycle } from "../lib/loginMotion";
import { useI18n } from "../lib/preferences";
import type { LoginPageConfig, LoginPageTemplateId } from "../lib/types";
import "./LoginPage.css";

interface LoginPageProps {
  authenticated: boolean;
  authenticatedRedirectPath: string;
  templateId?: LoginPageTemplateId;
}

interface LoginFormModel {
  mode: "login" | "password";
  username: string;
  setupToken: string;
  password: string;
  confirmPassword: string;
  error: string;
  pending: boolean;
  setMode: (mode: "login" | "password") => void;
  setUsername: (value: string) => void;
  setSetupToken: (value: string) => void;
  setPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

interface CommandOrbitPointerEffect {
  xVar: string;
  yVar: string;
  tiltVar?: string;
  scaleVar?: string;
  x: number;
  y: number;
  tilt?: number;
  scale?: number;
}

const DEFAULT_LOGIN_PAGE_CONFIG: LoginPageConfig = {
  template_id: "command-orbit",
  template_name: "Command Orbit",
  content: {
    brand_subtitle: "Orbital access concept",
    hero_title: "进入你的创意工作台",
    hero_description: "从灵感编排、图像会话到素材沉淀，Inspiration One 将创作链路收束成一座私有控制台。",
  },
  assets: {},
};

const COMMAND_ORBIT_CARD_EFFECT: CommandOrbitPointerEffect = {
  xVar: "--auth-card-x",
  yVar: "--auth-card-y",
  tiltVar: "--auth-card-tilt",
  x: -5,
  y: -4,
  tilt: -0.45,
};
const COMMAND_ORBIT_PRIMARY_EFFECT: CommandOrbitPointerEffect = {
  xVar: "--primary-x",
  yVar: "--primary-y",
  tiltVar: "--primary-tilt",
  scaleVar: "--primary-scale",
  x: 9,
  y: 7,
  tilt: -1.1,
  scale: 1.045,
};
const COMMAND_ORBIT_LOGIN_CHIP_EFFECT: CommandOrbitPointerEffect = {
  xVar: "--login-chip-x",
  yVar: "--login-chip-y",
  tiltVar: "--login-chip-tilt",
  scaleVar: "--login-chip-scale",
  x: 9,
  y: 6,
  tilt: -2.3,
  scale: 1.09,
};
const COMMAND_ORBIT_SETKEY_CHIP_EFFECT: CommandOrbitPointerEffect = {
  xVar: "--setkey-chip-x",
  yVar: "--setkey-chip-y",
  tiltVar: "--setkey-chip-tilt",
  scaleVar: "--setkey-chip-scale",
  x: 9,
  y: 6,
  tilt: 2.3,
  scale: 1.09,
};

function canUseCommandOrbitPointerMotion() {
  return (
    window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function applyCommandOrbitPointerEffect(event: PointerEvent<HTMLElement>, effect: CommandOrbitPointerEffect) {
  if (!canUseCommandOrbitPointerMotion()) {
    return;
  }
  const target = event.currentTarget;
  const rect = target.getBoundingClientRect();
  const nextX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
  const nextY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  target.style.setProperty(effect.xVar, `${nextX * effect.x}px`);
  target.style.setProperty(effect.yVar, `${nextY * effect.y}px`);
  if (effect.tiltVar && effect.tilt !== undefined) {
    target.style.setProperty(effect.tiltVar, `${nextX * effect.tilt}deg`);
  }
  if (effect.scaleVar && effect.scale !== undefined) {
    target.style.setProperty(effect.scaleVar, `${effect.scale}`);
  }
}

function clearCommandOrbitPointerEffect(event: PointerEvent<HTMLElement>, effect: CommandOrbitPointerEffect) {
  const target = event.currentTarget;
  target.style.removeProperty(effect.xVar);
  target.style.removeProperty(effect.yVar);
  if (effect.tiltVar) {
    target.style.removeProperty(effect.tiltVar);
  }
  if (effect.scaleVar) {
    target.style.removeProperty(effect.scaleVar);
  }
}

export function LoginPage({ authenticated, authenticatedRedirectPath, templateId }: LoginPageProps) {
  const { t } = useI18n();
  useLoginMotionLifecycle();
  const [mode, setModeState] = useState<"login" | "password">("login");
  const [username, setUsername] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (authenticated) {
      navigate(authenticatedRedirectPath, { replace: true });
    }
  }, [authenticated, authenticatedRedirectPath, navigate]);

  const loginPageConfigQuery = useQuery({
    queryKey: ["public-login-page-config", templateId ?? "selected"],
    queryFn: () => api.getLoginPageConfig(templateId),
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: (payload: { username: string; password: string; setupToken: string; mode: "login" | "password" }) =>
      payload.mode === "login"
        ? api.login(payload.username, payload.password)
        : api.setPassword(payload.username, payload.password, payload.setupToken),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
    onError: (mutationError) => {
      if (mutationError instanceof ApiError) {
        setError(mutationError.detail);
        return;
      }
      setError(t("login.error"));
    },
  });

  const setMode = (nextMode: "login" | "password") => {
    setModeState(nextMode);
    setError("");
    if (nextMode === "login") {
      setSetupToken("");
      setConfirmPassword("");
    }
  };

  const handleLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError(t("login.missingFields"));
      return;
    }
    if (mode === "password") {
      if (!setupToken.trim()) {
        setError(t("login.missingSetupToken"));
        return;
      }
      if (password.length < 6) {
        setError(t("login.passwordTooShort"));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("login.passwordMismatch"));
        return;
      }
    }
    loginMutation.mutate({ username: username.trim(), password, setupToken: setupToken.trim(), mode });
  };

  const formModel: LoginFormModel = {
    mode,
    username,
    setupToken,
    password,
    confirmPassword,
    error,
    pending: loginMutation.isPending,
    setMode,
    setUsername,
    setSetupToken,
    setPassword,
    setConfirmPassword,
    onSubmit: handleLogin,
  };

  const config = loginPageConfigQuery.data ?? DEFAULT_LOGIN_PAGE_CONFIG;
  if (config.template_id === "fluid-mist") {
    return <FluidMistLogin config={config} form={formModel} />;
  }
  if (config.template_id === "image-lab") {
    return <ImageLabLogin config={config} form={formModel} />;
  }
  return <CommandOrbitLogin config={config} form={formModel} />;
}

function CommandOrbitLogin({ config, form }: { config: LoginPageConfig; form: LoginFormModel }) {
  const brandSubtitle = textOrDefault(config.content.brand_subtitle, "Orbital access concept");
  const heroTitle = textOrDefault(config.content.hero_title, "进入你的创意工作台");
  const heroDescription = textOrDefault(
    config.content.hero_description,
    "从灵感编排、图像会话到素材沉淀，Inspiration One 将创作链路收束成一座私有控制台。",
  );

  return (
    <div className={`pf-login-orbit ${form.mode === "password" ? "is-setup" : "is-login"}`}>
      <div className="pointer-glow" aria-hidden="true" />
      <main className="stage">
        <div className="brand">
          <div>
            <strong>Inspiration One</strong>
            <small>{brandSubtitle}</small>
          </div>
        </div>

        <div className="vertical-title" aria-hidden="true">
          ACCESS
          <br />
          ORBIT
        </div>
        <div className="orbit" aria-hidden="true" />

        <section className="headline" aria-label="概念说明">
          <span className="eyebrow">ORBITAL LOGIN</span>
          <h1>{heroTitle}</h1>
          <p>{heroDescription}</p>
        </section>

        <section
          className="auth-shell"
          aria-label="登录表单静态稿 C"
          onPointerMove={(event) => applyCommandOrbitPointerEffect(event, COMMAND_ORBIT_CARD_EFFECT)}
          onPointerLeave={(event) => clearCommandOrbitPointerEffect(event, COMMAND_ORBIT_CARD_EFFECT)}
        >
          <div className="auth-core">
            <div className="auth-head">
              <div className="access-row">
                <span className="access-label">CORE ACCESS</span>
                <span className="console-index">
                  No.<strong>9527</strong>
                </span>
              </div>
              <h2>INSPIRATION START</h2>
              <p>使用账号密码进入私有创意空间。</p>
            </div>

            <div className="switch-shell">
              <div className="switch-core" role="tablist" aria-label="登录模式">
                <button
                  type="button"
                  className={form.mode === "login" ? "active" : ""}
                  role="tab"
                  aria-selected={form.mode === "login"}
                  onClick={() => form.setMode("login")}
                >
                  登录
                </button>
                <button
                  type="button"
                  className={form.mode === "password" ? "active" : ""}
                  role="tab"
                  aria-selected={form.mode === "password"}
                  onClick={() => form.setMode("password")}
                >
                  设置密码
                </button>
              </div>
            </div>

            <form className="form" onSubmit={form.onSubmit}>
              <div className="field">
                <label htmlFor="orbit-username">账号</label>
                <div className="field-shell">
                  <input
                    className="field-core"
                    id="orbit-username"
                    type="text"
                    value={form.username}
                    placeholder="请输入账号"
                    autoComplete="username"
                    onChange={(event) => form.setUsername(event.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="orbit-password">{form.mode === "login" ? "密码" : "新密码"}</label>
                <div className="field-shell">
                  <input
                    className="field-core"
                    id="orbit-password"
                    type="password"
                    value={form.password}
                    placeholder={form.mode === "login" ? "请输入密码" : "请输入新密码"}
                    autoComplete={form.mode === "login" ? "current-password" : "new-password"}
                    onChange={(event) => form.setPassword(event.target.value)}
                  />
                </div>
              </div>

              {form.mode === "password" ? (
                <>
                  <div className="field setup-only">
                    <label htmlFor="orbit-setup-token">设密凭据</label>
                    <div className="field-shell">
                      <input
                        className="field-core"
                        id="orbit-setup-token"
                        type="password"
                        value={form.setupToken}
                        placeholder="输入管理员提供的一次性凭据"
                        autoComplete="one-time-code"
                        onChange={(event) => form.setSetupToken(event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="field setup-only">
                    <label htmlFor="orbit-confirm-password">确认密码</label>
                    <div className="field-shell">
                      <input
                        className="field-core"
                        id="orbit-confirm-password"
                        type="password"
                        value={form.confirmPassword}
                        placeholder="再次输入密码"
                        autoComplete="new-password"
                        onChange={(event) => form.setConfirmPassword(event.target.value)}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              <div
                className={`notice ${form.error ? "" : "notice-placeholder"}`}
                role={form.error ? "alert" : undefined}
                aria-hidden={!form.error}
              >
                {form.error || "错误状态示例：请填写账号和密码。"}
              </div>

              <button
                className="primary"
                type="submit"
                disabled={form.pending}
                onPointerMove={(event) => {
                  event.stopPropagation();
                  applyCommandOrbitPointerEffect(event, COMMAND_ORBIT_PRIMARY_EFFECT);
                }}
                onPointerLeave={(event) => {
                  event.stopPropagation();
                  clearCommandOrbitPointerEffect(event, COMMAND_ORBIT_PRIMARY_EFFECT);
                }}
              >
                <span>{form.pending ? "校验中..." : form.mode === "login" ? "进入工作台" : "完成设置"}</span>
                <span aria-hidden="true">↗</span>
              </button>
            </form>
          </div>
        </section>

        <div className="satellite satellite-a" aria-hidden="true">
          <div className="satellite-inner">
            {Array.from({ length: 10 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
        </div>

        <div className="satellite satellite-b" aria-hidden="true">
          <div className="satellite-inner">
            <small>CONTROL SURFACE</small>
            <strong>
              Creative
              <br />
              command orbit
            </strong>
          </div>
        </div>

        <div className="mode-rail" aria-hidden="true">
          <span
            className={`rail-chip rail-chip-login ${form.mode === "login" ? "active" : ""}`}
            onPointerMove={(event) => applyCommandOrbitPointerEffect(event, COMMAND_ORBIT_LOGIN_CHIP_EFFECT)}
            onPointerLeave={(event) => clearCommandOrbitPointerEffect(event, COMMAND_ORBIT_LOGIN_CHIP_EFFECT)}
          >
            Login
          </span>
          <span
            className={`rail-chip rail-chip-setkey ${form.mode === "password" ? "active" : ""}`}
            onPointerMove={(event) => applyCommandOrbitPointerEffect(event, COMMAND_ORBIT_SETKEY_CHIP_EFFECT)}
            onPointerLeave={(event) => clearCommandOrbitPointerEffect(event, COMMAND_ORBIT_SETKEY_CHIP_EFFECT)}
          >
            Set key
          </span>
        </div>
      </main>
    </div>
  );
}

function FluidMistLogin({ config, form }: { config: LoginPageConfig; form: LoginFormModel }) {
  const [showPassword, setShowPassword] = useState(false);
  const mistRootRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const greetingTitle = textOrDefault(config.content.greeting_title, "欢迎回来，继续创作");
  const greetingDescription = textOrDefault(config.content.greeting_description, "登录你的工作台，开启灵感之旅");

  useEffect(() => {
    const root = mistRootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }

    const blobs = Array.from(root.querySelectorAll<HTMLElement>(".mesh-blob"));
    const sparkles = Array.from(root.querySelectorAll<HTMLElement>(".sparkle-dot"));
    let pointer: { x: number; y: number } | null = null;
    let motionFrame = 0;
    let blobTargets: Array<{
      el: HTMLElement;
      factor: number;
      radius: number;
      centerX: number;
      centerY: number;
    }> = [];
    let sparkleTargets: Array<{
      el: HTMLElement;
      factor: number;
      radius: number;
      scale: number;
      centerX: number;
      centerY: number;
    }> = [];

    const measureTargets = () => {
      blobTargets = blobs.map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          factor: 0.62 - index * 0.04,
          radius: 1180,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      });
      sparkleTargets = sparkles.map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          el,
          factor: 0.46 + (index % 3) * 0.03,
          radius: 80 + (index % 2) * 8,
          scale: 0.12 + (index % 2) * 0.04,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        };
      });
    };

    const applyPointerMotion = () => {
      motionFrame = 0;
      const activePointer = pointer;
      if (!activePointer) {
        blobTargets.forEach((target) => {
          target.el.style.setProperty("--blob-pointer-x", "0px");
          target.el.style.setProperty("--blob-pointer-y", "0px");
          target.el.style.setProperty("--blob-pointer-scale", "0");
          target.el.style.setProperty("--blob-pointer-glow", "0");
        });
        sparkleTargets.forEach((target) => {
          target.el.style.setProperty("--spark-pointer-x", "0px");
          target.el.style.setProperty("--spark-pointer-y", "0px");
          target.el.style.setProperty("--spark-pointer-scale", "0");
          target.el.style.setProperty("--spark-pointer-glow", "0");
        });
        return;
      }
      blobTargets.forEach((target) => {
        const distance = Math.hypot(activePointer.x - target.centerX, activePointer.y - target.centerY);
        const influence = Math.max(0, 1 - distance / target.radius);
        const deltaX = (activePointer.x - target.centerX) * target.factor * influence;
        const deltaY = (activePointer.y - target.centerY) * target.factor * influence;
        target.el.style.setProperty("--blob-pointer-x", `${deltaX}px`);
        target.el.style.setProperty("--blob-pointer-y", `${deltaY}px`);
        target.el.style.setProperty("--blob-pointer-scale", `${influence * 0.09}`);
        target.el.style.setProperty("--blob-pointer-glow", `${influence * 0.16}`);
      });
      let closestSparkle: (typeof sparkleTargets)[number] | null = null;
      let closestSparkleDistance = Number.POSITIVE_INFINITY;
      sparkleTargets.forEach((target) => {
        const distanceX = activePointer.x - target.centerX;
        const distanceY = activePointer.y - target.centerY;
        const distance = Math.hypot(distanceX, distanceY);
        if (distance <= target.radius && distance < closestSparkleDistance) {
          closestSparkle = target;
          closestSparkleDistance = distance;
        }
      });
      sparkleTargets.forEach((target) => {
        if (target !== closestSparkle) {
          target.el.style.setProperty("--spark-pointer-x", "0px");
          target.el.style.setProperty("--spark-pointer-y", "0px");
          target.el.style.setProperty("--spark-pointer-scale", "0");
          target.el.style.setProperty("--spark-pointer-glow", "0");
          return;
        }
        const distanceX = activePointer.x - target.centerX;
        const distanceY = activePointer.y - target.centerY;
        const distance = closestSparkleDistance;
        const influence = Math.max(0, 1 - distance / target.radius);
        const easedInfluence = influence * influence;
        const deltaX = distanceX * target.factor * easedInfluence;
        const deltaY = distanceY * target.factor * easedInfluence;
        target.el.style.setProperty("--spark-pointer-x", `${deltaX}px`);
        target.el.style.setProperty("--spark-pointer-y", `${deltaY}px`);
        target.el.style.setProperty("--spark-pointer-scale", `${easedInfluence * target.scale}`);
        target.el.style.setProperty("--spark-pointer-glow", `${easedInfluence * 0.26}`);
      });
    };

    const requestPointerMotion = () => {
      if (!motionFrame) {
        motionFrame = window.requestAnimationFrame(applyPointerMotion);
      }
    };

    const setPointer = (clientX: number, clientY: number) => {
      pointer = { x: clientX, y: clientY };
      requestPointerMotion();
    };

    const clearSparklePointer = () => {
      pointer = null;
      requestPointerMotion();
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => setPointer(event.clientX, event.clientY);

    const handleTouchMove = (event: globalThis.TouchEvent) => {
      const touch = event.touches.item(0);
      if (touch) {
        setPointer(touch.clientX, touch.clientY);
      }
    };

    const handleResize = () => {
      measureTargets();
      requestPointerMotion();
    };

    measureTargets();
    document.addEventListener("pointerdown", handlePointerMove, { passive: true });
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerleave", clearSparklePointer, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", clearSparklePointer, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      document.removeEventListener("pointerdown", handlePointerMove);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerleave", clearSparklePointer);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", clearSparklePointer);
      window.removeEventListener("resize", handleResize);
      if (motionFrame) {
        window.cancelAnimationFrame(motionFrame);
      }
      blobs.forEach((blob) => {
        blob.style.removeProperty("--blob-pointer-x");
        blob.style.removeProperty("--blob-pointer-y");
        blob.style.removeProperty("--blob-pointer-scale");
        blob.style.removeProperty("--blob-pointer-glow");
      });
      sparkles.forEach((sparkle) => {
        sparkle.style.removeProperty("--spark-pointer-x");
        sparkle.style.removeProperty("--spark-pointer-y");
        sparkle.style.removeProperty("--spark-pointer-scale");
        sparkle.style.removeProperty("--spark-pointer-glow");
      });
    };
  }, []);

  const handleCardPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rotateX = ((y - rect.height / 2) / (rect.height / 2)) * -15;
    const rotateY = ((x - rect.width / 2) / (rect.width / 2)) * 15;
    card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px) scale(1.03)`;
  };

  const handleCardPointerLeave = () => {
    if (cardRef.current) {
      cardRef.current.style.transform = "perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0) scale(1)";
    }
  };

  return (
    <div ref={mistRootRef} className="pf-login-mist text-ink antialiased relative">
      <div aria-hidden="true" className="background-layer">
        <div className="mesh-blob blob-1" />
        <div className="mesh-blob blob-2" />
        <div className="mesh-blob blob-3" />
        <div className="mesh-blob blob-4" />
      </div>

      <main className="mist-main">
        <div aria-hidden="true" className="sparkle-dot dot-1" />
        <div aria-hidden="true" className="sparkle-dot dot-2" />
        <div aria-hidden="true" className="sparkle-dot dot-3" />
        <div aria-hidden="true" className="sparkle-dot dot-4" />
        <div aria-hidden="true" className="sparkle-dot dot-5" />
        <div aria-hidden="true" className="sparkle-dot dot-6" />
        <div aria-hidden="true" className="sparkle-dot dot-7" />
        <div aria-hidden="true" className="sparkle-dot dot-8" />
        <div aria-hidden="true" className="sparkle-dot dot-9" />
        <div aria-hidden="true" className="sparkle-dot dot-10" />

        <div
          ref={cardRef}
          className="main-card"
          onPointerMove={handleCardPointerMove}
          onPointerLeave={handleCardPointerLeave}
        >
          <div className="brand-block">
            <h1>Inspiration One</h1>
            <p>Visual Studio</p>
          </div>

          <div className="greeting">
            <h2>{greetingTitle}</h2>
            <p>{greetingDescription}</p>
          </div>

          <form className="mist-form" onSubmit={form.onSubmit} noValidate>
            <div className="field-block">
              <label htmlFor="mist-account">账号</label>
              <input
                id="mist-account"
                type="text"
                autoComplete="username"
                placeholder="name@studio.com"
                value={form.username}
                onChange={(event) => form.setUsername(event.target.value)}
              />
            </div>

            <div className="field-block">
              <label htmlFor="mist-password">密码</label>
              <div className="password-wrap">
                <input
                  id="mist-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="输入密码"
                  value={form.password}
                  onChange={(event) => form.setPassword(event.target.value)}
                />
                <button type="button" aria-label="显示密码" onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {form.error ? (
                <p className="pw-error">
                  <ErrorCircleIcon />
                  <span>{form.error}</span>
                </p>
              ) : null}
            </div>

            <button type="submit" className="submit-btn btn-magnetic" disabled={form.pending}>
              {form.pending ? (
                <span className="btn-loading">
                  <SpinnerIcon />
                  登录中…
                </span>
              ) : (
                <span className="btn-label">
                  开始创作
                  <ChevronIcon />
                </span>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function ImageLabLogin({ config, form }: { config: LoginPageConfig; form: LoginFormModel }) {
  const heroDescription = textOrDefault(
    config.content.hero_description,
    "登录页像一张摄影棚邀请函，先给情绪和记忆点，再承载最短的进入路径。",
  );
  const heroImage = useMemo(() => api.toApiUrl(config.assets.hero_image || "/hero.png"), [config.assets.hero_image]);

  return (
    <div className="pf-login-lab">
      <main className="page">
        <a className="brand" href="/login" aria-label="Inspiration One" onClick={(event) => event.preventDefault()}>
          Inspiration One
        </a>

        <section className="gallery" aria-label="视觉概念">
          <article className="art-frame">
            <img src={heroImage} alt="视觉创作海报" />
            <div className="rail-text">studio access</div>
            <div className="caption">
              <code>ACCESS / INVITATION ONLY</code>
              <h1>Enter the image lab</h1>
              <p>{heroDescription}</p>
            </div>
          </article>
        </section>

        <section className="login-panel" aria-label="登录表单">
          <div className="entry-frame">
            <div className="panel-kicker">
              <span>PRIVATE ENTRY</span>
              <h2>
                验证身份，
                <br />
                进入创作现场
              </h2>
            </div>

            <section className="scan-card" aria-label="身份扫描登录模块">
              <div className="scan-head">
                <div>
                  <span>identity scanner</span>
                  <strong>身份信号校准完成</strong>
                </div>
                <div className="scan-code">IO-SCAN-9527</div>
              </div>

              <div className="scan-body">
                <div className="scanner" aria-hidden="true">
                  <span className="scan-line" />
                  <span className="scanner-core">Access</span>
                </div>

                <div className="meter" aria-label="校验状态">
                  <div className="meter-row" style={{ "--meter": "72%" } as CSSProperties}>
                    <span>KEY</span>
                    <i />
                    <b>72</b>
                  </div>
                  <div className="meter-row" style={{ "--meter": "84%" } as CSSProperties}>
                    <span>PAIR</span>
                    <i />
                    <b>84</b>
                  </div>
                  <div className="meter-row" style={{ "--meter": "63%" } as CSSProperties}>
                    <span>SYNC</span>
                    <i />
                    <b>63</b>
                  </div>
                </div>
              </div>

              <div className="mode-switch" role="tablist" aria-label="登录模式">
                <button
                  className={form.mode === "login" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={form.mode === "login"}
                  onClick={() => form.setMode("login")}
                >
                  登录
                </button>
                <button
                  className={form.mode === "password" ? "active" : ""}
                  type="button"
                  role="tab"
                  aria-selected={form.mode === "password"}
                  onClick={() => form.setMode("password")}
                >
                  设置密码
                </button>
              </div>

              <form onSubmit={form.onSubmit}>
                <div className="field">
                  <label htmlFor="lab-username">账号</label>
                  <div className="input-wrap">
                    <span className="input-index">01</span>
                    <input
                      id="lab-username"
                      type="text"
                      placeholder="输入授权账号"
                      autoComplete="username"
                      value={form.username}
                      onChange={(event) => form.setUsername(event.target.value)}
                    />
                  </div>
                  <div className="helper">授权账号用于确认进入权限。</div>
                </div>

                <div className="field">
                  <label htmlFor="lab-password">{form.mode === "login" ? "密码" : "新密码"}</label>
                  <div className="input-wrap">
                    <span className="input-index">02</span>
                    <input
                      id="lab-password"
                      type="password"
                      placeholder={form.mode === "login" ? "输入当前密码" : "输入新密码"}
                      autoComplete={form.mode === "login" ? "current-password" : "new-password"}
                      value={form.password}
                      onChange={(event) => form.setPassword(event.target.value)}
                    />
                  </div>
                  <div className="helper">首次进入或重置后可切换到设置密码。</div>
                </div>

                {form.mode === "password" ? (
                  <>
                    <div className="field">
                      <label htmlFor="lab-setup-token">设密凭据</label>
                      <div className="input-wrap">
                        <span className="input-index">03</span>
                        <input
                          id="lab-setup-token"
                          type="password"
                          placeholder="输入一次性凭据"
                          autoComplete="one-time-code"
                          value={form.setupToken}
                          onChange={(event) => form.setSetupToken(event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor="lab-confirm-password">确认密码</label>
                      <div className="input-wrap">
                        <span className="input-index">04</span>
                        <input
                          id="lab-confirm-password"
                          type="password"
                          placeholder="再次输入新密码"
                          autoComplete="new-password"
                          value={form.confirmPassword}
                          onChange={(event) => form.setConfirmPassword(event.target.value)}
                        />
                      </div>
                    </div>
                  </>
                ) : null}

                <div
                  className={`error-message ${form.error ? "" : "error-placeholder"}`}
                  role={form.error ? "alert" : undefined}
                  aria-hidden={!form.error}
                >
                  <span className="error-dot" aria-hidden="true" />
                  <span>{form.error || "身份信号未匹配，请检查账号或密码后重新校准。"}</span>
                </div>

                <div className="submit-row">
                  <button className="primary-button" type="submit" disabled={form.pending}>
                    {form.pending ? "校准中..." : form.mode === "login" ? "确认进入" : "完成设置"}
                    <ArrowIcon />
                  </button>
                  <button className="icon-button" type="button" aria-label="查看安全状态">
                    <ShieldIcon />
                  </button>
                </div>
              </form>
            </section>
          </div>

          <div className="states" aria-label="状态示例">
            <div className="state-card">
              <span>loading</span>
              <strong>会话校验中</strong>
              <div className="load-lines" aria-hidden="true">
                <i />
                <i />
              </div>
            </div>
            <div className="state-card">
              <span>empty</span>
              <strong>设置密码后进入</strong>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.2 3.8M6.3 8.3A15.9 15.9 0 0 0 2.5 12S6 18 12 18a9.4 9.4 0 0 0 3.4-.6" />
    </svg>
  );
}

function ErrorCircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-6.2-8.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m13 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 6v5.2c0 4.3-2.78 7.34-7 9.3-4.22-1.96-7-5-7-9.3V6l7-2.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function textOrDefault(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized || fallback;
}
