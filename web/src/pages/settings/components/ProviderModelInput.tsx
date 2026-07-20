// 供应商模型输入框：可输入 + 下拉模型列表（组合框、键盘导航、刷新）。从 SettingsPage.tsx 抽出，行为不变。

import { useEffect, useId, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2, RefreshCw } from "lucide-react";

import { ClassicTextInput } from "../../../components/classicInputs";
import { FloatingSurface } from "../../../components/FloatingSurface";
import { ParameterHelpLabel } from "../../../components/ParameterHelp";
import { WorkspaceTextInput } from "../../../components/workspaceInputs";
import { api } from "../../../lib/api";
import { asyncViewPhase, asyncViewStateFromQuery } from "../../../lib/asyncViewState";
import type { ParameterHelpKey } from "../../../lib/parameterHelp";
import { useI18n } from "../../../lib/preferences";
import type { ProviderModel } from "../../../lib/types";
import {
  canFetchProviderModels,
  filterProviderModels,
  PROVIDER_MODELS_QUERY_GC_TIME_MS,
  PROVIDER_MODELS_QUERY_STALE_TIME_MS,
  providerModelsQueryKey,
  providerModelsStatusText,
  shouldEnableProviderModelsQuery,
} from "../providerModels";
import type { ProviderModelKind } from "../types";
import { useSettingsActionClassNames } from "./styles";

interface ProviderModelInputProps {
  idPrefix: string;
  label: string;
  value: string;
  placeholder: string;
  providerKind: ProviderModelKind;
  providerProfileId: string;
  disabled?: boolean;
  helpKey?: ParameterHelpKey;
  workspaceSubpage?: boolean;
  onChange: (value: string) => void;
}

export function ProviderModelInput({
  idPrefix,
  label,
  value,
  placeholder,
  providerKind,
  providerProfileId,
  disabled = false,
  helpKey,
  workspaceSubpage = false,
  onChange,
}: ProviderModelInputProps) {
  const { t } = useI18n();
  const { SETTINGS_SQUARE_ACTION_CLASS } = useSettingsActionClassNames();
  const reactId = useId();
  const inputId = `${idPrefix}-${reactId}`;
  const listboxId = `${inputId}-models`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const modelTriggerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [open, setOpen] = useState(false);
  const [activeModelId, setActiveModelId] = useState(value);
  const [modelsQueryActivated, setModelsQueryActivated] = useState(false);
  const canFetchModels = canFetchProviderModels(providerProfileId, providerKind);
  const modelsQueryEnabled = shouldEnableProviderModelsQuery(providerProfileId, providerKind, modelsQueryActivated);
  const modelsQuery = useQuery({
    queryKey: providerModelsQueryKey(providerProfileId, providerKind),
    queryFn: () => api.listProviderModels(providerProfileId, providerKind),
    enabled: modelsQueryEnabled,
    staleTime: PROVIDER_MODELS_QUERY_STALE_TIME_MS,
    gcTime: PROVIDER_MODELS_QUERY_GC_TIME_MS,
    retry: false,
  });
  const modelsState = asyncViewStateFromQuery({
    active: modelsQueryEnabled,
    data: modelsQuery.data,
    dataUpdatedAt: modelsQuery.dataUpdatedAt,
    isSuccess: modelsQuery.isSuccess,
    isError: modelsQuery.isError,
    fetchStatus: modelsQuery.fetchStatus,
    isEmpty: (data) => data.models.length === 0,
  });
  const modelsPhase = asyncViewPhase(modelsState);
  const models = modelsQuery.data?.models ?? [];
  const filteredModels = filterProviderModels(models, value);
  const statusText =
    providerKind === "mock"
      ? ""
      : !providerProfileId
        ? t("settings.provider.modelSelectProfileFirst")
        : modelsPhase === "inactive"
          ? ""
          : modelsPhase === "loading"
            ? t("settings.provider.modelsLoading")
            : modelsPhase === "paused"
              ? t("app.requestPaused.title")
              : modelsPhase === "initial-idle"
                ? t("settings.provider.modelsLoadFailed")
                : modelsState.error !== "none"
                  ? providerModelsStatusText(models, modelsQuery.error, t)
                  : modelsQuery.isFetching
                    ? t("settings.provider.modelsLoading")
                    : providerModelsStatusText(models, null, t);
  const statusClassName = modelsState.error !== "none"
    ? "text-red-600 dark:text-red-300"
    : "text-slate-500 dark:text-slate-400";
  const canOpenModels = !disabled && canFetchModels && models.length > 0;
  const activeModel = filteredModels.find((model) => model.id === activeModelId) ?? filteredModels[0] ?? null;
  const modelOptionsOpen = open && canOpenModels && filteredModels.length > 0;

  useEffect(() => {
    if (!open) {
      setActiveModelId(value);
    }
  }, [open, value]);

  useEffect(() => {
    if (modelOptionsOpen && activeModel) {
      optionRefs.current[activeModel.id]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeModel, modelOptionsOpen]);

  useEffect(() => {
    if (!models.length) {
      setOpen(false);
    }
  }, [models.length]);

  useEffect(() => {
    if (!canFetchModels || modelsQueryActivated) {
      return;
    }
    const root = rootRef.current;
    if (!root) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setModelsQueryActivated(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setModelsQueryActivated(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: "240px 0px 240px 0px",
        threshold: 0.01,
      },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [canFetchModels, modelsQueryActivated]);

  function activateModelsQuery() {
    if (canFetchModels) {
      setModelsQueryActivated(true);
    }
  }

  function moveActiveModel(delta: number) {
    if (!filteredModels.length) {
      return;
    }
    const currentIndex = filteredModels.findIndex((model) => model.id === activeModelId);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : filteredModels.length - 1
        : (currentIndex + delta + filteredModels.length) % filteredModels.length;
    setActiveModelId(filteredModels[nextIndex].id);
  }

  function selectModel(model: ProviderModel) {
    onChange(model.id);
    setActiveModelId(model.id);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="space-y-2">
      <label htmlFor={inputId} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
        {helpKey ? <ParameterHelpLabel label={label} helpKey={helpKey} uiType="settings" /> : label}
      </label>
      <div className="flex gap-2">
        <div ref={modelTriggerRef} className="relative min-w-0 flex-1">
          {workspaceSubpage ? (
            <WorkspaceTextInput
              id={inputId}
              role="combobox"
              aria-expanded={modelOptionsOpen}
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={value}
              onChange={(event) => {
                activateModelsQuery();
                onChange(event.target.value);
                setActiveModelId(event.target.value);
                if (canOpenModels) {
                  setOpen(true);
                }
              }}
              onFocus={() => {
                activateModelsQuery();
                if (canOpenModels) {
                  setOpen(true);
                }
              }}
              onKeyDown={(event) => {
                if (!canOpenModels) {
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  moveActiveModel(1);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpen(true);
                  moveActiveModel(-1);
                  return;
                }
                if (event.key === "Enter" && modelOptionsOpen && activeModel) {
                  event.preventDefault();
                  selectModel(activeModel);
                  return;
                }
                if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
              className={canOpenModels ? "pr-11" : ""}
              placeholder={placeholder}
              disabled={disabled}
              size="tall"
            />
          ) : (
            <ClassicTextInput
              id={inputId}
              role="combobox"
              aria-expanded={modelOptionsOpen}
              aria-controls={listboxId}
              aria-autocomplete="list"
              value={value}
              onChange={(event) => {
                activateModelsQuery();
                onChange(event.target.value);
                setActiveModelId(event.target.value);
                if (canOpenModels) {
                  setOpen(true);
                }
              }}
              onFocus={() => {
                activateModelsQuery();
                if (canOpenModels) {
                  setOpen(true);
                }
              }}
              onKeyDown={(event) => {
                if (!canOpenModels) {
                  return;
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                  moveActiveModel(1);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setOpen(true);
                  moveActiveModel(-1);
                  return;
                }
                if (event.key === "Enter" && modelOptionsOpen && activeModel) {
                  event.preventDefault();
                  selectModel(activeModel);
                  return;
                }
                if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
              className={canOpenModels ? "pr-11" : ""}
              placeholder={placeholder}
              disabled={disabled}
              size="tall"
            />
          )}
          {canOpenModels ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={t("settings.provider.openModelOptions")}
              title={t("settings.provider.openModelOptions")}
            >
              <ChevronDown size={15} className={`transition-transform ${modelOptionsOpen ? "rotate-180" : ""}`} />
            </button>
          ) : null}
        </div>
        {providerKind !== "mock" ? (
          <button
            type="button"
            onClick={() => {
              activateModelsQuery();
              setOpen(false);
              void modelsQuery.refetch();
            }}
            disabled={disabled || !canFetchModels || modelsQuery.isFetching}
            className={SETTINGS_SQUARE_ACTION_CLASS}
            aria-label={t("settings.provider.refreshModels")}
            title={t("settings.provider.refreshModels")}
          >
            {modelsQuery.isFetching ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        ) : null}
      </div>
      <FloatingSurface
        open={modelOptionsOpen}
        triggerRef={modelTriggerRef}
        preferredPlacement="bottom-start"
        layer="modal"
        matchTriggerWidth
        onOpenChange={setOpen}
        className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl shadow-slate-950/12 ring-1 ring-slate-950/5 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45 dark:ring-white/10"
      >
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={inputId}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {filteredModels.map((model) => (
            <button
              key={model.id}
              ref={(element) => {
                optionRefs.current[model.id] = element;
              }}
              type="button"
              role="option"
              aria-selected={model.id === value}
              onClick={() => selectModel(model)}
              className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium outline-none transition-colors ${
                model.id === value
                  ? "bg-indigo-50 text-indigo-700 dark:bg-violet-500/18 dark:text-violet-100"
                  : model.id === activeModel?.id
                    ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{model.label || model.id}</span>
              {model.id === value ? <Check size={14} className="shrink-0" /> : null}
            </button>
          ))}
        </div>
      </FloatingSurface>
      {statusText ? <p className={`min-h-4 text-xs leading-5 ${statusClassName}`}>{statusText}</p> : null}
    </div>
  );
}
