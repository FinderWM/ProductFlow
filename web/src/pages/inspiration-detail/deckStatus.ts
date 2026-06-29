import type { TranslationKey } from "../../lib/i18n";
import type { DeckStatus } from "../../lib/types";

export const DECK_STATUS_LABEL_KEYS: Record<DeckStatus, TranslationKey> = {
  draft: "detail.deck.status.draft",
  outline_confirmed: "detail.deck.status.outlineConfirmed",
  style_confirmed: "detail.deck.status.styleConfirmed",
  generating: "detail.deck.status.generating",
  completed: "detail.deck.status.completed",
  failed: "detail.deck.status.failed",
};

export function isDeckStatus(value: unknown): value is DeckStatus {
  return typeof value === "string" && value in DECK_STATUS_LABEL_KEYS;
}
