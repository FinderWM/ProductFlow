import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";

import { ClassicCheckbox, ClassicSelectField, ClassicTextarea } from "../../components/classicInputs";
import { ImageGenerationSettingsPanel } from "../../components/ImageGenerationSettingsPanel";
import {
  actionButtonComponentForAppearance,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import { ModalShell } from "../../components/ModalShell";
import {
  WorkspaceCheckbox,
  WorkspaceSelectField as SelectField,
  WorkspaceTextarea,
} from "../../components/workspaceInputs";
import {
  generationConfigOptionLabel,
  generationConfigOptionsForPurpose,
  generationConfigSelectionMaxDimension,
} from "../../lib/generationConfigs";
import { compactImageToolOptions } from "../../lib/imageToolOptions";
import { buildImageSizeOptions } from "../../lib/imageSizes";
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
  workspaceSubpage?: boolean;
  globalImageGenerationMaxDimension: number;
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
  workspaceSubpage = false,
  globalImageGenerationMaxDimension,
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
  const actionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const ActionButton = actionButtonComponentForAppearance(actionAppearance);
  const LayoutCheckbox = workspaceSubpage ? WorkspaceCheckbox : ClassicCheckbox;
  const LayoutSelectField = workspaceSubpage ? SelectField : ClassicSelectField;
  const LayoutTextarea = workspaceSubpage ? WorkspaceTextarea : ClassicTextarea;

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
  const selectedResourceGroup = useMemo(
    () => resourceGroups.find((group) => group.id === resourceGroupId) ?? null,
    [resourceGroupId, resourceGroups],
  );
  const imageGenerationMaxDimension = useMemo(
    () =>
      generationConfigSelectionMaxDimension({
        mode: generationConfigMode,
        generationConfigId,
        resourceGroupId,
        resourceGroupMaxDimension: selectedResourceGroup?.image_max_dimension,
        options: imageGenerationConfigOptions,
        globalMaxDimension: globalImageGenerationMaxDimension,
      }),
    [
      generationConfigId,
      generationConfigMode,
      globalImageGenerationMaxDimension,
      imageGenerationConfigOptions,
      resourceGroupId,
      selectedResourceGroup,
    ],
  );
  const imageSizeOptions = useMemo(
    () => buildImageSizeOptions(imageGenerationMaxDimension),
    [imageGenerationMaxDimension],
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
    <ModalShell
      onClose={onClose}
      closeDisabled={busy}
      ariaLabel={t("detail.tailPlan.title", { title: nodeTitle })}
      overlayClassName="z-[90] bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      panelClassName="flex max-h-[min(88vh,960px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-[#0f1726]"
    >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-white">
              <Sparkles size={16} className="text-fuchsia-600 dark:text-fuchsia-300" />
              <span>{t("detail.tailPlan.title", { title: nodeTitle })}</span>
            </div>
            <div className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("detail.tailPlan.subtitle")}</div>
          </div>
          <ActionButton
            onClick={onClose}
            disabled={busy}
            preset="secondary"
            size="icon-md"
            aria-label={t("common.cancel")}
            leadingIcon={<X size={16} />}
          />
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
                    <LayoutCheckbox
                      checked={reusePublicCopyNode}
                      onChange={(event) => setReusePublicCopyNode(event.target.checked)}
                      disabled={busy}
                      variant="card"
                      wrapperClassName="text-sm text-slate-700 dark:text-slate-200"
                      label={t("detail.tailPlan.reusePublicCopy")}
                      description={t("detail.tailPlan.reusePublicCopyHint")}
                    />
                  ) : null}
                  {canReusePublicReferenceNode ? (
                    <LayoutCheckbox
                      checked={reusePublicReferenceNode}
                      onChange={(event) => setReusePublicReferenceNode(event.target.checked)}
                      disabled={busy}
                      variant="card"
                      wrapperClassName="text-sm text-slate-700 dark:text-slate-200"
                      label={t("detail.tailPlan.reusePublicReference")}
                      description={t("detail.tailPlan.reusePublicReferenceHint")}
                    />
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
                <LayoutSelectField
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
                  size="compact"
                />
              </div>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {t("detail.inspector.imageGenerationConfig")}
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                  <LayoutSelectField
                    value={generationConfigMode}
                    options={[
                      { value: "auto", label: t("detail.inspector.generationConfigAuto") },
                      { value: "manual", label: t("detail.inspector.generationConfigManual") },
                    ]}
                    onChange={(value) => setGenerationConfigMode(value === "manual" ? "manual" : "auto")}
                    ariaLabel={t("detail.inspector.imageGenerationConfig")}
                    size="compact"
                  />
                  <LayoutSelectField
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
                    size="compact"
                    disabled={generationConfigMode !== "manual"}
                  />
                </div>
              </div>
              <ImageGenerationSettingsPanel
                surface="plain"
                appearance={workspaceSubpage ? "workspace" : "classic"}
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
                    <ActionButton
                      onClick={() =>
                        setSelectedItemIds((current) =>
                          selected ? current.filter((itemId) => itemId !== item.id) : [...current, item.id],
                        )
                      }
                      preset="secondary"
                      size="sm"
                      className="shrink-0 text-xs"
                      aria-pressed={selected}
                      leadingIcon={selected ? <Check size={12} /> : undefined}
                    >
                      {selected ? t("detail.tailPlan.remove") : t("detail.tailPlan.keep")}
                    </ActionButton>
                  </div>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                        {t("detail.tailPlan.instruction")}
                      </div>
                      <LayoutTextarea
                        value={instructionDrafts[item.id] ?? item.instruction}
                        onChange={(event) =>
                          setInstructionDrafts((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        disabled={busy || !selected}
                        minRows={4}
                        className="mt-1"
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
            <ActionButton
              onClick={onClose}
              disabled={busy}
              preset="secondary"
              size="md"
            >
              {t("common.cancel")}
            </ActionButton>
            <ActionButton
              onClick={() => onConfirm(selectedItems, imageGenerationConfig, reuseOptions)}
              disabled={
                busy ||
                !selectedCount ||
                hasBlankSelectedInstruction ||
                requiresResourceGroup ||
                requiresGenerationConfig
              }
              preset="primary"
              size="md"
            >
              {t("detail.tailPlan.confirm")}
            </ActionButton>
          </div>
        </div>
    </ModalShell>
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
