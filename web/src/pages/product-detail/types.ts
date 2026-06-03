import type {
  CopyPayloadV2,
  GenerationConfigSelectionMode,
  ImageToolOptions,
  ProductInitialWorkflowEntry,
} from "../../lib/types";

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasInteractionMode = "browse" | "edit" | "select";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export type ProductContextDynamicFieldDraft = {
  id: string;
  key: string;
  value: string;
};

export type NodeConfigDraft = {
  title: string;
  productName: string;
  ownerId: string;
  entryType: ProductInitialWorkflowEntry;
  sourceNote: string;
  longText: string;
  imageSourceAssetId: string;
  documentSourceAssetId: string;
  documentFilename: string;
  documentMimeType: string;
  documentText: string;
  dynamicFields: ProductContextDynamicFieldDraft[];
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
