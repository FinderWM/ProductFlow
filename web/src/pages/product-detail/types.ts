import type { CopyPayloadV2, GenerationConfigSelectionMode, ImageToolOptions } from "../../lib/types";

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasInteractionMode = "browse" | "edit" | "select";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export type NodeConfigDraft = {
  title: string;
  productName: string;
  category: string;
  price: string;
  sourceNote: string;
  instruction: string;
  role: string;
  label: string;
  tone: string;
  channel: string;
  size: string;
  toolOptions: ImageToolOptions;
  generationConfigMode: GenerationConfigSelectionMode;
  generationConfigId: string | null;
  copyStructuredPayload: CopyPayloadV2 | null;
};
