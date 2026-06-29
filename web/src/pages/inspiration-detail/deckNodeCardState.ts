import type { TranslationKey } from "../../lib/i18n";
import type { WorkflowNode, WorkflowNodeStatus } from "../../lib/types";
import { DECK_STATUS_LABEL_KEYS, isDeckStatus } from "./deckStatus";

export interface DeckNodeCardState {
  badgeTone: WorkflowNodeStatus;
  badgeLabelKey: TranslationKey;
  slideCount: number | null;
  generatedSlideCount: number | null;
  sourceItemCount: number;
  sourceStale: boolean;
}

export function readDeckNodeCardState(
  node: Pick<WorkflowNode, "node_type" | "output_json">,
): DeckNodeCardState | null {
  if (node.node_type !== "deck_generation") {
    return null;
  }
  const output = recordOrNull(node.output_json);
  if (!output) {
    return {
      badgeTone: "idle",
      badgeLabelKey: "detail.nodeStatus.available",
      slideCount: null,
      generatedSlideCount: null,
      sourceItemCount: 0,
      sourceStale: false,
    };
  }

  const deckStatus = isDeckStatus(output.deck_status) ? output.deck_status : null;
  const slideCount = integerOrNull(output.slide_count);
  const generatedSlideCount = integerOrZero(output.generated_slide_count);
  const sourceManifest = recordOrNull(output.source_manifest);
  const sourceItemIds = stringArray(sourceManifest?.source_item_ids);
  const sourceStale = output.source_stale === true;

  return {
    badgeTone: deckStatusTone(deckStatus),
    badgeLabelKey: deckStatus ? DECK_STATUS_LABEL_KEYS[deckStatus] : "detail.nodeStatus.available",
    slideCount,
    generatedSlideCount: slideCount === null && generatedSlideCount === 0 ? null : generatedSlideCount,
    sourceItemCount: sourceItemIds.length,
    sourceStale,
  };
}

function deckStatusTone(deckStatus: string | null): WorkflowNodeStatus {
  if (deckStatus === "generating") {
    return "running";
  }
  if (deckStatus === "completed") {
    return "succeeded";
  }
  if (deckStatus === "failed") {
    return "failed";
  }
  return "idle";
}

function integerOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

function integerOrZero(value: unknown): number {
  return integerOrNull(value) ?? 0;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
