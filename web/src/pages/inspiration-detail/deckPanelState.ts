import type { DeckSlide } from "../../lib/types";

export interface DeckWorkflowSourceState {
  workflow_node_id: string | null;
  workflow_node_exists: boolean | null;
}

export interface DeckFrontendExportState {
  generated_slide_count: number;
  slides: Array<Pick<DeckSlide, "image_url">>;
}

export type DeckHistoryAccessoryKind = "openWorkflowNode" | "workflowDeleted" | "workflowHint" | "delete";

export function isWorkflowDeck(deck: DeckWorkflowSourceState | null | undefined): deck is DeckWorkflowSourceState & {
  workflow_node_id: string;
} {
  return Boolean(deck?.workflow_node_id);
}

export function canOpenWorkflowDeckNode(deck: DeckWorkflowSourceState | null | undefined): deck is DeckWorkflowSourceState & {
  workflow_node_id: string;
} {
  return isWorkflowDeck(deck) && deck.workflow_node_exists !== false;
}

export function hasDeletedWorkflowDeckNode(deck: DeckWorkflowSourceState | null | undefined): boolean {
  return isWorkflowDeck(deck) && deck.workflow_node_exists === false;
}

export function deckAllowsLegacyMutation(deck: DeckWorkflowSourceState | null | undefined): boolean {
  return !isWorkflowDeck(deck);
}

export function deckHistoryAccessoryKind(
  deck: DeckWorkflowSourceState | null | undefined,
  hasOpenWorkflowNodeHandler: boolean,
): DeckHistoryAccessoryKind {
  if (canOpenWorkflowDeckNode(deck) && hasOpenWorkflowNodeHandler) {
    return "openWorkflowNode";
  }
  if (hasDeletedWorkflowDeckNode(deck)) {
    return "workflowDeleted";
  }
  if (isWorkflowDeck(deck)) {
    return "workflowHint";
  }
  return "delete";
}

export function deckSupportsFrontendPptxExport(deck: DeckFrontendExportState | null | undefined): boolean {
  return Boolean(deck && (deck.generated_slide_count > 0 || deck.slides.some((slide) => Boolean(slide.image_url))));
}
