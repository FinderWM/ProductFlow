import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Download, Eye, Image as ImageIcon, Trees, X } from "lucide-react";

import { api } from "../../lib/api";
import { asyncViewPhase, asyncViewStateFromQuery } from "../../lib/asyncViewState";
import { formatDateTime } from "../../lib/format";
import { useI18n } from "../../lib/preferences";
import type { ResourceLibraryAsset, ResourceLibraryGroup } from "../../lib/types";
import type { ActionButtonPreset } from "../ActionButton";
import { GalleryImagePreviewDialog } from "../GalleryImagePreviewDialog";
import {
  actionButtonClassNameForAppearance,
  actionButtonComponentForAppearance,
} from "../layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../loading/AsyncContent";
import { Skeleton, SkeletonCards } from "../loading/Skeleton";
import { MediaPreviewTrigger } from "../MediaPreviewTrigger";
import { ModalShell } from "../ModalShell";
import { ResourceBlockedNotice, ResourceMetaBadges, isResourceBlocked } from "../ResourceGovernance";

type ResourceLibraryModalAppearance = "classic" | "workspace";

interface ResourceLibraryModalProps {
  open: boolean;
  onClose: () => void;
  canRead: boolean;
  appearance?: ResourceLibraryModalAppearance;
  onSelectAsset?: (asset: ResourceLibraryAsset) => void;
  selectLabel?: string;
  selectDisabled?: boolean;
  selectDisabledTitle?: string | null;
  selectingAssetId?: string | null;
  isAssetSelectable?: (asset: ResourceLibraryAsset) => boolean;
  assetSelectDisabledTitle?: string | null;
  selectButtonPreset?: ActionButtonPreset;
  footer?: ReactNode;
}

const EMPTY_RESOURCE_LIBRARY_GROUPS: ResourceLibraryGroup[] = [];
const EMPTY_RESOURCE_LIBRARY_ASSETS: ResourceLibraryAsset[] = [];

export function ResourceLibraryModal({
  open,
  onClose,
  canRead,
  appearance = "classic",
  onSelectAsset,
  selectLabel,
  selectDisabled = false,
  selectDisabledTitle = null,
  selectingAssetId = null,
  isAssetSelectable,
  assetSelectDisabledTitle = null,
  selectButtonPreset = "primary",
  footer = null,
}: ResourceLibraryModalProps) {
  const { t } = useI18n();
  const ActionButtonComponent = actionButtonComponentForAppearance(appearance);
  const iconActionClassName = actionButtonClassNameForAppearance(appearance, { preset: "secondary", size: "icon-sm" });
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [previewAsset, setPreviewAsset] = useState<ResourceLibraryAsset | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["resource-library-groups"],
    queryFn: api.listResourceLibraryGroups,
    enabled: open && canRead,
  });
  const assetsQuery = useQuery({
    queryKey: ["resource-library-assets", selectedGroupId || "all"],
    queryFn: () => api.listResourceLibraryAssets({ group_id: selectedGroupId || null }),
    enabled: open && canRead,
  });
  const groupsState = asyncViewStateFromQuery({
    active: open && canRead,
    data: groupsQuery.data,
    dataUpdatedAt: groupsQuery.dataUpdatedAt,
    isSuccess: groupsQuery.isSuccess,
    isError: groupsQuery.isError,
    fetchStatus: groupsQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const assetsState = asyncViewStateFromQuery({
    active: open && canRead,
    data: assetsQuery.data,
    dataUpdatedAt: assetsQuery.dataUpdatedAt,
    isSuccess: assetsQuery.isSuccess,
    isError: assetsQuery.isError,
    fetchStatus: assetsQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const assetsPhase = asyncViewPhase(assetsState);
  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const assets = assetsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_ASSETS;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

  useEffect(() => {
    if (!open) {
      setPreviewAsset(null);
    }
  }, [open]);

  useEffect(() => {
    if (selectedGroupId && groupsQuery.isSuccess && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId("");
    }
  }, [groups, groupsQuery.isSuccess, selectedGroupId]);

  const assetCountLabel = useMemo(() => {
    if (assetsPhase === "loading") {
      return t("resourceLibrary.loading");
    }
    if (assetsPhase === "paused") {
      return t("app.requestPaused.title");
    }
    if (assetsPhase === "initial-error" || assetsPhase === "initial-idle") {
      return t("resourceLibrary.loadFailed");
    }
    return `${t("resourceLibrary.assets")} · ${assets.length}`;
  }, [assets.length, assetsPhase, t]);

  if (!open) {
    return null;
  }

  return (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        closeDisabled={Boolean(selectingAssetId)}
        ariaLabel={t("resourceLibrary.title")}
        overlayClassName="pf-settings-workspace z-[75] bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:px-6"
        panelClassName="flex h-[min(880px,calc(100dvh-2rem))] w-full max-w-6xl min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
      >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                <Trees size={18} className="text-emerald-600 dark:text-emerald-300" />
                <span>{t("resourceLibrary.title")}</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {selectedGroup ? selectedGroup.name : t("resourceLibrary.allGroups")} · {assetCountLabel}
              </div>
            </div>
            <ActionButtonComponent
              preset="secondary"
              size="icon-md"
              onClick={onClose}
              disabled={Boolean(selectingAssetId)}
              aria-label={t("resourceLibrary.close")}
              title={t("resourceLibrary.close")}
              leadingIcon={<X size={18} />}
            >
            </ActionButtonComponent>
          </div>

          {!canRead ? (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-slate-500 dark:text-slate-400">
              {t("resourceLibrary.permissionReadRequired")}
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-1">
              <aside className="min-h-0 border-b border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/35 lg:border-b-0 lg:border-r">
                <div className="mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                  {t("resourceLibrary.groups")}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
                  <button
                    type="button"
                    onClick={() => setSelectedGroupId("")}
                    className={`inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors lg:w-full ${
                      !selectedGroupId
                        ? "bg-slate-950 text-white dark:bg-violet-500/25 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40"
                        : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="min-w-0 whitespace-normal break-words leading-5">{t("resourceLibrary.allGroups")}</span>
                  </button>
                  <AsyncContent
                    state={groupsState}
                    refreshIntent="background"
                    loadingLabel={t("resourceLibrary.loading")}
                    skeleton={(
                      <>
                        {[1, 2, 3].map((item) => (
                          <Skeleton key={item} className="min-h-9 min-w-[160px] shrink-0 lg:w-full lg:min-w-0" rounded="lg" />
                        ))}
                      </>
                    )}
                    initialError={(
                      <AsyncErrorState
                        className="min-w-52 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100 lg:min-w-0"
                        title={t("resourceLibrary.loadFailed")}
                        retryLabel={t("common.retry")}
                        retryingLabel={t("resourceLibrary.loading")}
                        retrying={groupsState.fetch === "fetching"}
                        onRetry={() => void groupsQuery.refetch()}
                      />
                    )}
                    paused={(
                      <AsyncPausedState
                        className="min-w-52 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100 lg:min-w-0"
                        title={t("app.requestPaused.title")}
                        retryLabel={t("common.retry")}
                        onRetry={() => void groupsQuery.refetch()}
                      />
                    )}
                    inactive={null}
                    empty={null}
                    refreshFeedback={
                      groupsState.error === "refresh" ? (
                        <button
                          type="button"
                          className="min-h-9 min-w-[160px] rounded-lg border border-amber-300/60 px-3 text-xs font-semibold text-amber-800 dark:border-amber-300/30 dark:text-amber-100 lg:w-full lg:min-w-0"
                          onClick={() => void groupsQuery.refetch()}
                        >
                          {t("common.retry")}
                        </button>
                      ) : null
                    }
                    className="contents"
                  >
                    {groups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedGroupId(group.id)}
                        className={`inline-flex min-h-9 min-w-[160px] shrink-0 items-center rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full lg:min-w-0 ${
                          selectedGroupId === group.id
                            ? "bg-slate-950 text-white dark:bg-violet-500/25 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40"
                            : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span className="min-w-0 whitespace-normal break-words leading-5">{group.name}</span>
                      </button>
                    ))}
                  </AsyncContent>
                </div>
              </aside>

              <main className="min-h-0 overflow-y-auto p-3 sm:p-4">
                <AsyncContent
                  state={assetsState}
                  refreshIntent="parameter-change"
                  loadingLabel={t("resourceLibrary.loading")}
                  skeleton={<SkeletonCards count={8} className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-4" />}
                  initialError={(
                    <AsyncErrorState
                      title={t("resourceLibrary.loadFailed")}
                      retryLabel={t("common.retry")}
                      retryingLabel={t("resourceLibrary.loading")}
                      retrying={assetsState.fetch === "fetching"}
                      onRetry={() => void assetsQuery.refetch()}
                    />
                  )}
                  paused={(
                    <AsyncPausedState
                      title={t("app.requestPaused.title")}
                      message={t("app.requestPaused.message")}
                      retryLabel={t("common.retry")}
                      onRetry={() => void assetsQuery.refetch()}
                    />
                  )}
                  inactive={null}
                  empty={(
                    <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-400">
                      <ImageIcon size={22} className="text-indigo-500 dark:text-violet-300" />
                      <div>{t("resourceLibrary.empty")}</div>
                    </div>
                  )}
                  refreshFeedback={
                    assetsState.error === "refresh" ? (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                        <span>{t("resourceLibrary.loadFailed")}</span>
                        <button type="button" className="font-semibold underline" onClick={() => void assetsQuery.refetch()}>
                          {t("common.retry")}
                        </button>
                      </div>
                    ) : null
                  }
                >
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                    {assets.map((asset) => {
                      const assetBlocked = isResourceBlocked(asset);
                      const selectedBusy = selectingAssetId === asset.id;
                      const assetSelectable = isAssetSelectable ? isAssetSelectable(asset) : true;
                      const actionDisabled = selectDisabled || assetBlocked || selectedBusy || !assetSelectable;
                      const actionTitle = !assetSelectable
                        ? assetSelectDisabledTitle ?? selectDisabledTitle ?? selectLabel ?? t("resourceLibrary.select")
                        : selectDisabledTitle ?? selectLabel ?? t("resourceLibrary.select");
                      return (
                        <div
                          key={asset.id}
                          className="group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-950/60"
                        >
                          <MediaPreviewTrigger
                            onPreview={() => setPreviewAsset(asset)}
                            className="block w-full bg-slate-100 dark:bg-slate-900"
                            aria-label={t("detail.previewImage", { alt: asset.original_filename })}
                            title={t("common.preview")}
                          >
                            <img
                              src={api.toApiUrl(asset.thumbnail_url)}
                              alt={asset.original_filename}
                              loading="lazy"
                              decoding="async"
                              className="aspect-square w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                            />
                          </MediaPreviewTrigger>
                          <div className="space-y-2 border-t border-slate-100 p-2 dark:border-slate-800">
                            <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {asset.original_filename}
                            </div>
                            <ResourceMetaBadges resource={asset} showReason />
                            <div className="flex flex-wrap gap-1">
                              {asset.groups.map((group) => (
                                <span
                                  key={group.id}
                                  className="max-w-full truncate rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-violet-400/30 dark:bg-violet-500/12 dark:text-violet-100"
                                >
                                  {group.name}
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center gap-1">
                              <ActionButtonComponent
                                preset="secondary"
                                size="icon-sm"
                                onClick={() => setPreviewAsset(asset)}
                                aria-label={t("common.preview")}
                                title={t("common.preview")}
                                leadingIcon={<Eye size={14} />}
                              >
                              </ActionButtonComponent>
                              <a
                                href={api.toApiUrl(asset.download_url)}
                                target="_blank"
                                rel="noreferrer"
                                className={iconActionClassName}
                                aria-label={t("common.download")}
                                title={t("common.download")}
                              >
                                <Download size={14} />
                              </a>
                              {onSelectAsset ? (
                                <ActionButtonComponent
                                  preset={selectButtonPreset}
                                  size="sm"
                                  onClick={() => onSelectAsset(asset)}
                                  disabled={actionDisabled}
                                  title={actionTitle}
                                  loading={selectedBusy}
                                  leadingIcon={<Check size={13} />}
                                  className="ml-auto min-w-0 max-w-full [&_.pf-action-button__label]:truncate"
                                >
                                  {selectLabel ?? t("resourceLibrary.select")}
                                </ActionButtonComponent>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AsyncContent>
                {footer ? <div className="mt-4">{footer}</div> : null}
              </main>
            </div>
          )}
      </ModalShell>

      {previewAsset ? (
        <GalleryImagePreviewDialog
          appearance={appearance}
          ariaLabel={t("detail.previewImage", { alt: previewAsset.original_filename })}
          imageUrl={api.toApiUrl(previewAsset.preview_url)}
          imageAlt={previewAsset.original_filename}
          title={t("resourceLibrary.title")}
          subtitle={previewAsset.original_filename}
          body={
            <div className="space-y-3">
              <ResourceBlockedNotice resource={previewAsset} />
              <div>{previewAsset.original_filename}</div>
              <div className="flex flex-wrap gap-1">
                {previewAsset.groups.map((group) => (
                  <span
                    key={group.id}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600"
                  >
                    {group.name}
                  </span>
                ))}
              </div>
            </div>
          }
          metadataRows={[
            { label: t("resourceLibrary.groups"), value: previewAsset.groups.map((group) => group.name).join(" / ") },
            { label: t("chat.generatedAt"), value: formatDateTime(previewAsset.created_at) },
          ]}
          providerNotesTitle={t("gallery.providerNotes")}
          downloadUrl={previewAsset.download_url}
          downloadLabel={t("common.download")}
          closeLabel={t("resourceLibrary.close")}
          onClose={() => setPreviewAsset(null)}
        />
      ) : null}
    </>
  );
}
