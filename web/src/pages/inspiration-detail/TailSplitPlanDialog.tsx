import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";

import { ImageGenerationSettingsPanel } from "../../components/ImageGenerationSettingsPanel";
import { SelectField } from "../../components/SelectField";
import {
  generationConfigOptionLabel,
  generationConfigOptionsForPurpose,
} from "../../lib/generationConfigs";
import { compactImageToolOptions } from "../../lib/imageToolOptions";
import type { ImageSizeOption } from "../../lib/imageSizes";
import { useI18n } from "../../lib/preferences";
import type {
  ApplyTailSplitPlanImageGenerationConfigInput,
  ApplyTailSplitPlanItemInput,
  ApplyTailSplitPlanReuseOptions,
  GenerationConfigOption,
  GenerationConfigSelectionMode,
  GenerationResourceGroup,
  ImageToolOptionKey,
  ImageToolOptions,
  TailSplitPlan,
} from "../../lib/types";

interface TailSplitPlanDialogProps {
  open: boolean;
  nodeTitle: string;
  plan: TailSplitPlan | null;
  busy: boolean;
  imageSizeOptions: ImageSizeOption[];
  imageGenerationMaxDimension: number;
  imageToolAllowedFields: readonly ImageToolOptionKey[];
  resourceGroups: GenerationResourceGroup[];
  generationConfigOptions: GenerationConfigOption[];
  canReusePublicCopyNode: boolean;
  canReusePublicReferenceNode: boolean;
  onClose: () => void;
  onConfirm: (
    items: ApplyTailSplitPlanItemInput[],
    imageGenerationConfig: ApplyTailSplitPlanImageGenerationConfigInput,
    reuseOptions: ApplyTailSplitPlanReuseOptions,
  ) => void;
}

export function TailSplitPlanDialog({
  open,
  nodeTitle,
  plan,
  busy,
  imageSizeOptions,
  imageGenerationMaxDimension,
  imageToolAllowedFields,
  resourceGroups,
  generationConfigOptions,
  canReusePublicCopyNode,
  canReusePublicReferenceNode,
  onClose,
  onConfirm,
}: TailSplitPlanDialogProps) {
  const { t } = useI18n();
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, string>>({});
  const [imageSize, setImageSize] = useState("1024x1024");
  const [resourceGroupId, setResourceGroupId] = useState<string | null>(null);
  const [generationConfigMode, setGenerationConfigMode] = useState<GenerationConfigSelectionMode>("auto");
  const [generationConfigId, setGenerationConfigId] = useState<string | null>(null);
  const [toolOptions, setToolOptions] = useState<ImageToolOptions>({});
  const [reusePublicCopyNode, setReusePublicCopyNode] = useState(false);
  const [reusePublicReferenceNode, setReusePublicReferenceNode] = useState(false);

  useEffect(() => {
    if (!open || !plan) {
      return;
    }
    setSelectedItemIds(plan.items.map((item) => item.id));
    setInstructionDrafts(Object.fromEntries(plan.items.map((item) => [item.id, item.instruction])));
    setImageSize("1024x1024");
    setResourceGroupId(resourceGroups.find((group) => group.enabled && !group.archived_at)?.id ?? null);
    setGenerationConfigMode("auto");
    setGenerationConfigId(null);
    setToolOptions({});
    setReusePublicCopyNode(canReusePublicCopyNode);
    setReusePublicReferenceNode(canReusePublicReferenceNode);
  }, [canReusePublicCopyNode, canReusePublicReferenceNode, open, plan, resourceGroups]);

  useEffect(() => {
    if (
      resourceGroupId &&
      !resourceGroups.some((group) => group.id === resourceGroupId && group.enabled && !group.archived_at)
    ) {
      setResourceGroupId(null);
      setGenerationConfigMode("auto");
      setGenerationConfigId(null);
    }
  }, [resourceGroupId, resourceGroups]);

  const imageGenerationConfigOptions = useMemo(
    () => generationConfigOptionsForPurpose(generationConfigOptions, "image", resourceGroupId),
    [generationConfigOptions, resourceGroupId],
  );

  useEffect(() => {
    if (generationConfigMode !== "manual") {
      if (generationConfigId) {
        setGenerationConfigId(null);
      }
      return;
    }
    if (generationConfigId && !imageGenerationConfigOptions.some((config) => config.id === generationConfigId)) {
      setGenerationConfigMode("auto");
      setGenerationConfigId(null);
    }
  }, [generationConfigId, generationConfigMode, imageGenerationConfigOptions]);

  const selectedCount = selectedItemIds.length;
  const selectedIdSet = useMemo(() => new Set(selectedItemIds), [selectedItemIds]);
  const selectedItems = useMemo(
    () =>
      plan?.items
        .filter((item) => selectedIdSet.has(item.id))
        .map((item) => ({
          id: item.id,
          instruction: (instructionDrafts[item.id] ?? item.instruction).trim(),
        })) ?? [],
    [instructionDrafts, plan, selectedIdSet],
  );
  const hasBlankSelectedInstruction = selectedItems.some((item) => !item.instruction);
  const requiresResourceGroup = !resourceGroupId;
  const requiresGenerationConfig = generationConfigMode === "manual" && !generationConfigId;
  const imageGenerationConfig = useMemo<ApplyTailSplitPlanImageGenerationConfigInput>(
    () => ({
      size: imageSize,
      resource_group_id: resourceGroupId,
      generation_config_mode: generationConfigMode,
      generation_config_id: generationConfigMode === "manual" ? generationConfigId : null,
      tool_options: compactImageToolOptions(toolOptions, imageToolAllowedFields) ?? null,
    }),
    [generationConfigId, generationConfigMode, imageSize, imageToolAllowedFields, resourceGroupId, toolOptions],
  );
  const reuseOptions = useMemo<ApplyTailSplitPlanReuseOptions>(
    () => ({
      reuse_public_copy_node: canReusePublicCopyNode && reusePublicCopyNode,
      reuse_public_reference_node: canReusePublicReferenceNode && reusePublicReferenceNode,
    }),
    [canReusePublicCopyNode, canReusePublicReferenceNode, reusePublicCopyNode, reusePublicReferenceNode],
  );
  const footerText = !selectedCount
    ? t("detail.tailPlan.footerEmpty")
    : hasBlankSelectedInstruction
      ? t("detail.tailPlan.instructionEmpty")
      : requiresResourceGroup
        ? t("detail.tailPlan.resourceGroupRequired")
        : requiresGenerationConfig
          ? t("detail.tailPlan.imageGenerationConfigRequired")
          : t("detail.tailPlan.footerReady");

  if (!open || !plan) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[min(88vh,960px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#0f1726]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
              <Sparkles size={16} className="text-fuchsia-600 dark:text-fuchsia-300" />
              <span>{t("detail.tailPlan.title", { title: nodeTitle })}</span>
            </div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("detail.tailPlan.subtitle")}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
            aria-label={t("common.cancel")}
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-[#0b1220]">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  {t("detail.tailPlan.summary")}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{plan.source_summary}</div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200">
                {t("detail.tailPlan.selectedCount", { count: selectedCount, total: plan.items.length })}
              </div>
            </div>
            {canReusePublicCopyNode || canReusePublicReferenceNode ? (
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-[#0b1220]">
                <div>
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">
                    {t("detail.tailPlan.reusePublicTitle")}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {t("detail.tailPlan.reusePublicDescription")}
                  </div>
                </div>
                <div className="space-y-2">
                  {canReusePublicCopyNode ? (
                    <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={reusePublicCopyNode}
                        onChange={(event) => setReusePublicCopyNode(event.target.checked)}
                        disabled={busy}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{t("detail.tailPlan.reusePublicCopy")}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {t("detail.tailPlan.reusePublicCopyHint")}
                        </span>
                      </span>
                    </label>
                  ) : null}
                  {canReusePublicReferenceNode ? (
                    <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={reusePublicReferenceNode}
                        onChange={(event) => setReusePublicReferenceNode(event.target.checked)}
                        disabled={busy}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{t("detail.tailPlan.reusePublicReference")}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {t("detail.tailPlan.reusePublicReferenceHint")}
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-[#0b1220]">
              <div>
                <div className="text-sm font-semibold text-slate-950 dark:text-white">
                  {t("detail.tailPlan.imageSettings")}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {t("detail.tailPlan.imageSettingsDescription")}
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t("detail.inspector.resourceGroup")}
                </div>
                <SelectField
                  value={resourceGroupId ?? ""}
                  options={[
                    {
                      value: "",
                      label: resourceGroups.length
                        ? t("detail.inspector.selectResourceGroup")
                        : t("detail.inspector.noResourceGroups"),
                      disabled: true,
                    },
                    ...resourceGroups.map((group) => ({
                      value: group.id,
                      label: resourceGroupLabel(group, t),
                      disabled: !group.enabled || Boolean(group.archived_at),
                    })),
                  ]}
                  onChange={(value) => {
                    setResourceGroupId(value || null);
                    setGenerationConfigMode("auto");
                    setGenerationConfigId(null);
                  }}
                  ariaLabel={t("detail.inspector.resourceGroup")}
                  radius="lg"
                  visualSize="sm"
                />
              </div>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t("detail.inspector.imageGenerationConfig")}
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <SelectField
                    value={generationConfigMode}
                    options={[
                      { value: "auto", label: t("detail.inspector.generationConfigAuto") },
                      { value: "manual", label: t("detail.inspector.generationConfigManual") },
                    ]}
                    onChange={(value) => setGenerationConfigMode(value === "manual" ? "manual" : "auto")}
                    ariaLabel={t("detail.inspector.imageGenerationConfig")}
                    radius="lg"
                    visualSize="sm"
                  />
                  <SelectField
                    value={generationConfigMode === "manual" ? (generationConfigId ?? "") : ""}
                    options={[
                      {
                        value: "",
                        label: imageGenerationConfigOptions.length
                          ? t("detail.inspector.selectGenerationConfig")
                          : t("detail.inspector.noGenerationConfigs"),
                        disabled: true,
                      },
                      ...imageGenerationConfigOptions.map((config) => ({
                        value: config.id,
                        label: generationConfigOptionLabel(
                          config,
                          t("detail.inspector.generationConfigDisabled"),
                          t("detail.inspector.generationConfigFrozen"),
                        ),
                        disabled: !config.enabled,
                      })),
                    ]}
                    onChange={(value) => setGenerationConfigId(value || null)}
                    ariaLabel={t("detail.inspector.imageGenerationConfig")}
                    radius="lg"
                    visualSize="sm"
                    disabled={generationConfigMode !== "manual"}
                  />
                </div>
              </div>
              <ImageGenerationSettingsPanel
                surface="plain"
                size={imageSize}
                sizeOptions={imageSizeOptions}
                maxDimension={imageGenerationMaxDimension}
                toolOptions={toolOptions}
                allowedToolFields={imageToolAllowedFields}
                onSizeChange={setImageSize}
                onToolOptionsChange={setToolOptions}
                helpUiType="inspirationDetail"
              />
            </div>
          </aside>

          <div className="space-y-3">
            {plan.items.map((item) => {
              const selected = selectedIdSet.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`rounded-2xl border p-4 transition-colors ${
                    selected
                      ? "border-fuchsia-200 bg-fuchsia-50/70 dark:border-fuchsia-400/35 dark:bg-fuchsia-500/10"
                      : "border-slate-200 bg-white/90 opacity-70 dark:border-slate-700 dark:bg-[#0b1220]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                        {t("detail.tailPlan.itemOrder", { order: item.order })}
                      </div>
                      <div className="mt-1 text-base font-semibold text-zinc-950 dark:text-white">{item.title}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedItemIds((current) =>
                          selected ? current.filter((itemId) => itemId !== item.id) : [...current, item.id],
                        )
                      }
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                        selected
                          ? "bg-white text-fuchsia-700 ring-1 ring-fuchsia-200 dark:bg-slate-950/80 dark:text-fuchsia-200 dark:ring-fuchsia-400/35"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      }`}
                    >
                      {selected ? <Check size={12} /> : null}
                      {selected ? t("detail.tailPlan.remove") : t("detail.tailPlan.keep")}
                    </button>
                  </div>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                        {t("detail.tailPlan.instruction")}
                      </div>
                      <textarea
                        value={instructionDrafts[item.id] ?? item.instruction}
                        onChange={(event) =>
                          setInstructionDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        disabled={busy || !selected}
                        rows={4}
                        className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-100 dark:focus:border-fuchsia-400 dark:focus:ring-fuchsia-400/15 dark:disabled:bg-slate-900/70"
                        aria-label={t("detail.tailPlan.instruction")}
                      />
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                        {t("detail.tailPlan.visualIntent")}
                      </div>
                      <div className="mt-1">{item.visual_intent}</div>
                    </div>
                    {item.source_refs.length ? (
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                          {t("detail.tailPlan.sourceRefs")}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {item.source_refs.map((sourceRef) => (
                            <span
                              key={`${item.id}-${sourceRef}`}
                              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-300"
                            >
                              {sourceRef}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {footerText}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-900/70"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(selectedItems, imageGenerationConfig, reuseOptions)}
              disabled={
                busy ||
                !selectedCount ||
                hasBlankSelectedInstruction ||
                requiresResourceGroup ||
                requiresGenerationConfig
              }
              className="inline-flex items-center rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fuchsia-500 disabled:opacity-60 dark:bg-gradient-to-r dark:from-fuchsia-500 dark:to-violet-500"
            >
              {t("detail.tailPlan.confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function resourceGroupLabel(
  group: GenerationResourceGroup,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const markers = [!group.enabled ? t("detail.inspector.resourceGroupDisabled") : ""].filter(Boolean);
  const suffix = markers.length ? ` (${markers.join(" · ")})` : "";
  return `${group.name}${suffix}`;
}
