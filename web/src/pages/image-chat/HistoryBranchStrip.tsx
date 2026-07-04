import type { CSSProperties } from "react";
import { Check, History, Layers3, Loader2, Sparkles } from "lucide-react";

import {
  actionButtonToneStyle,
  actionSurfaceClassNameForAppearance,
  transparentActionToneVars,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import { SensitiveImageOverlay, sensitiveImageClassName } from "../../components/SensitiveImageMask";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { shouldMaskSensitiveImage } from "../../lib/sensitiveImages";
import type { PromptPreview } from "../../components/PromptPreviewDialog";
import type { ImageHistoryBranch, ImageHistoryCandidate } from "./branching";
import type { ImageChatTranslate } from "./display";
import { imageRoundSizeLabel, placeholderStatusClass, placeholderStatusLabel } from "./display";

interface HistoryBranchStripProps {
  branch: ImageHistoryBranch;
  selectedGeneratedAssetId: string | null;
  selectedTaskPlaceholderId: string | null;
  selectedBaseAssetIds: string[];
  variant?: "desktop" | "mobileDrawer";
  appearance?: LayoutActionAppearance;
  maskSensitiveImages: boolean;
  onSelectRound: (assetId: string) => void;
  onAddRoundToBase?: (assetId: string) => void;
  onSelectPlaceholder: (placeholderId: string) => void;
  onPreviewPrompt: (preview: PromptPreview) => void;
  t: ImageChatTranslate;
}

export function HistoryBranchStrip({
  branch,
  selectedGeneratedAssetId,
  selectedTaskPlaceholderId,
  selectedBaseAssetIds,
  variant = "desktop",
  appearance = "classic",
  maskSensitiveImages,
  onSelectRound,
  onAddRoundToBase,
  onSelectPlaceholder,
  onPreviewPrompt,
  t,
}: HistoryBranchStripProps) {
  const promptPreviewButtonClassName = actionSurfaceClassNameForAppearance(appearance, {
    preset: "secondary",
    focusWithin: true,
    className: "block w-full text-left",
  });
  const depthOffset = Math.min(branch.depth, 4) * 18;
  const branchIndex = branch.branch_index;
  const isBranch = branchIndex !== null;
  const branchLabel = isBranch ? t("chat.branch", { depth: branchIndex }) : t("chat.firstRound");
  const promptPreview = {
    title: isBranch ? t("chat.branchPrompt") : t("chat.firstPrompt"),
    text: branch.prompt,
    meta: `${t("chat.imageCount", { count: branch.candidates.length })} · ${formatDateTime(branch.created_at)}`,
  };

  if (variant === "mobileDrawer") {
    return (
      <div className="space-y-2">
        <div className="inline-flex min-h-7 max-w-full items-center gap-1 rounded-full border pf-hairline pf-surface px-2 text-[11px] font-semibold pf-ink shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]">
          {isBranch ? <Layers3 size={12} /> : <History size={12} />}
          <span className="truncate">{branchLabel}</span>
        </div>
        <button
          type="button"
          onClick={() => onPreviewPrompt(promptPreview)}
          title={branch.prompt}
          className={`${promptPreviewButtonClassName} rounded-xl px-2.5 py-2`}
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("chat.prompt")}
          </div>
          <div className="mt-1 line-clamp-4 text-[11px] leading-4 pf-ink-muted dark:text-[color:var(--pf-muted)]">{branch.prompt}</div>
        </button>
        <div className="flex flex-col gap-2">
          {branch.candidates.map((candidate) => (
            <HistoryCandidateCard
              key={candidate.id}
              candidate={candidate}
              selectedGeneratedAssetId={selectedGeneratedAssetId}
              selectedTaskPlaceholderId={selectedTaskPlaceholderId}
              selectedBaseAssetIds={selectedBaseAssetIds}
              variant="mobileDrawer"
              appearance={appearance}
              maskSensitiveImages={maskSensitiveImages}
              onSelectRound={onSelectRound}
              onAddRoundToBase={onAddRoundToBase}
              onSelectPlaceholder={onSelectPlaceholder}
              t={t}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex w-max shrink-0 snap-start flex-col gap-1 rounded-2xl lg:ml-[var(--branch-depth-offset)] lg:h-full lg:flex-row lg:gap-2 lg:border lg:border-[color:var(--pf-border-soft)] lg:bg-[color:var(--pf-panel-soft)] lg:p-2 lg:dark:border-[color:var(--pf-border)] lg:dark:bg-[#151f33]"
      style={{ "--branch-depth-offset": `${depthOffset}px` } as CSSProperties}
    >
      {branch.depth > 0 ? (
        <div className="pointer-events-none absolute -left-3 top-1/2 hidden h-px w-3 bg-[color:var(--pf-border-soft)] dark:bg-[color:var(--pf-border-soft)] lg:block" />
      ) : null}
      <div className="flex w-max items-center gap-1 px-0.5 text-[11px] pf-ink-muted dark:text-[color:var(--pf-muted)] lg:hidden">
        <div className="flex min-w-0 items-center gap-1 rounded-full border pf-hairline bg-[rgba(255,255,255,0.86)] px-1.5 py-0.5 shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]/88">
          <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border pf-hairline pf-surface px-1.5 font-semibold pf-ink-muted shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]">
            {isBranch ? <Layers3 size={12} /> : <History size={12} />}
            {branchLabel}
          </span>
          <span className="pr-1">{t("chat.imageCount", { count: branch.candidates.length })}</span>
        </div>
      </div>
      <div className="hidden w-28 shrink-0 flex-col justify-between rounded-xl pf-surface p-2 text-xs pf-ink-muted ring-1 ring-[color:var(--pf-border-soft)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)] dark:ring-[color:var(--pf-border)] lg:flex">
        <div>
          <div className="flex items-center gap-1.5 font-semibold pf-ink dark:text-[color:var(--pf-muted)]">
            {isBranch ? <Layers3 size={12} /> : <History size={12} />}
            {branchLabel}
          </div>
          <div className="mt-1">{t("chat.imageCount", { count: branch.candidates.length })}</div>
        </div>
        <button
          type="button"
          onClick={() => onPreviewPrompt(promptPreview)}
          title={branch.prompt}
          className={`${promptPreviewButtonClassName} hidden rounded-md border-0 bg-transparent px-0 py-0 text-[11px] leading-4 pf-ink-muted shadow-none dark:text-[color:var(--pf-muted)] lg:line-clamp-3`}
          style={actionButtonToneStyle(transparentActionToneVars)}
        >
          {branch.prompt}
        </button>
      </div>
      <div className="flex w-max shrink-0 gap-2 lg:min-h-0 lg:flex-1">
        {branch.candidates.map((candidate) => (
          <HistoryCandidateCard
            key={candidate.id}
            candidate={candidate}
            selectedGeneratedAssetId={selectedGeneratedAssetId}
            selectedTaskPlaceholderId={selectedTaskPlaceholderId}
            selectedBaseAssetIds={selectedBaseAssetIds}
            variant={variant}
            appearance={appearance}
            maskSensitiveImages={maskSensitiveImages}
            onSelectRound={onSelectRound}
            onAddRoundToBase={onAddRoundToBase}
            onSelectPlaceholder={onSelectPlaceholder}
            t={t}
          />
        ))}
      </div>
    </div>
  );
}

interface HistoryCandidateCardProps {
  candidate: ImageHistoryCandidate;
  selectedGeneratedAssetId: string | null;
  selectedTaskPlaceholderId: string | null;
  selectedBaseAssetIds: string[];
  variant?: "desktop" | "mobileDrawer";
  appearance?: LayoutActionAppearance;
  maskSensitiveImages: boolean;
  onSelectRound: (assetId: string) => void;
  onAddRoundToBase?: (assetId: string) => void;
  onSelectPlaceholder: (placeholderId: string) => void;
  t: ImageChatTranslate;
}

function HistoryCandidateCard({
  candidate,
  selectedGeneratedAssetId,
  selectedTaskPlaceholderId,
  selectedBaseAssetIds,
  variant = "desktop",
  appearance = "classic",
  maskSensitiveImages,
  onSelectRound,
  onAddRoundToBase,
  onSelectPlaceholder,
  t,
}: HistoryCandidateCardProps) {
  const candidateButtonClassName = actionSurfaceClassNameForAppearance(appearance, {
    preset: "secondary",
    focusWithin: true,
    className:
      variant === "mobileDrawer"
        ? "flex h-full w-full flex-col justify-between rounded-xl border-0 p-2 text-left shadow-none"
        : "block h-full w-full rounded-xl border-0 text-left shadow-none lg:rounded-2xl",
  });
  const cardClassName = (active: boolean, asBase = false) =>
    `group/card relative shrink-0 overflow-hidden rounded-xl border pf-surface transition-all dark:bg-[#0b1220] ${
      variant === "mobileDrawer"
        ? "aspect-square min-h-[5.75rem] w-full"
        : "h-[5.5rem] w-[5.5rem] lg:aspect-square lg:h-full lg:w-auto lg:min-w-[7rem] lg:rounded-2xl"
    } ${
      active
        ? "border-indigo-400 ring-2 ring-indigo-200 dark:border-violet-400 dark:ring-violet-400/45"
        : "pf-hairline hover:border-[color:var(--pf-border)] dark:border-[color:var(--pf-border)] dark:hover:border-violet-400/45"
    } ${asBase ? "shadow-md shadow-indigo-200/70 dark:shadow-violet-950/40" : ""}`;

  if (candidate.kind === "placeholder") {
    const active = candidate.id === selectedTaskPlaceholderId;
    const running = candidate.status === "queued" || candidate.status === "running";
    return (
      <div className={cardClassName(active)}>
        <button
          type="button"
          onClick={() => onSelectPlaceholder(candidate.id)}
          className={candidateButtonClassName}
          style={actionButtonToneStyle(transparentActionToneVars)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${placeholderStatusClass(candidate)}`}>
              {candidate.candidate_index}/{candidate.candidate_count}
            </span>
            {active ? <Check size={13} className="shrink-0 text-indigo-600" /> : null}
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl pf-surface-soft text-indigo-600 ring-1 ring-[color:var(--pf-border-soft)] dark:bg-violet-500/12 dark:text-violet-200 dark:ring-violet-400/30 lg:h-12 lg:w-12">
              {running ? <Loader2 size={19} className="animate-spin" /> : <Sparkles size={19} />}
            </div>
          </div>
          <div>
            <div className="truncate text-[11px] font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]">{placeholderStatusLabel(candidate, t)}</div>
            <div className="mt-0.5 hidden text-[10px] leading-3 pf-ink-muted dark:text-[color:var(--pf-muted)] lg:line-clamp-2">{candidate.prompt}</div>
          </div>
        </button>
      </div>
    );
  }

  const round = candidate.round;
  const active = round.generated_asset.id === selectedGeneratedAssetId;
  const asBase = selectedBaseAssetIds.includes(round.generated_asset.id);
  const imageMasked = shouldMaskSensitiveImage(maskSensitiveImages, round.resource_group);
  const candidateLabel =
    round.candidate_count > 1 ? `${round.candidate_index}/${round.candidate_count}` : imageRoundSizeLabel(round, t);
  return (
    <div className={`${cardClassName(active, asBase)} ${asBase ? "" : "shadow-sm shadow-slate-200/60 dark:shadow-slate-950/30"}`}>
      <button
        type="button"
        onClick={() => onSelectRound(round.generated_asset.id)}
        onDoubleClick={() => onAddRoundToBase?.(round.generated_asset.id)}
        className={candidateButtonClassName}
        style={actionButtonToneStyle(transparentActionToneVars)}
      >
        <img
          src={api.toApiUrl(round.generated_asset.thumbnail_url)}
          alt={variant === "mobileDrawer" ? candidateLabel : round.prompt}
          loading="lazy"
          decoding="async"
          className={sensitiveImageClassName(imageMasked, "h-full w-full object-cover")}
        />
        <SensitiveImageOverlay masked={imageMasked} label={t("common.sensitiveImageMasked")} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(15,23,42,0.8)] via-[rgba(15,23,42,0.24)] to-transparent px-1.5 pb-1 pt-5 text-[#fff] lg:p-1.5 lg:pt-8">
          <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
            <span className="min-w-0 truncate">{candidateLabel}</span>
            {active ? <Check size={13} className="shrink-0" /> : null}
          </div>
        </div>
      </button>
      {asBase ? (
        <div className="absolute left-1.5 top-1.5 max-w-[calc(100%-2.75rem)] truncate rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-[#fff] shadow-sm dark:bg-violet-500/85 dark:ring-1 dark:ring-violet-200/30">
          {t("chat.baseImage")}
        </div>
      ) : null}
    </div>
  );
}
