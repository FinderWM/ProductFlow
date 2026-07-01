import type {
  CopyPayloadV2,
  EnhanceStrategy,
  GenerationConfigSelectionMode,
  ImageToolOptions,
  InspirationInitialWorkflowEntry,
} from "../../lib/types";

export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasInteractionMode = "browse" | "edit" | "select";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export type InspirationContextDynamicFieldDraft = {
  id: string;
  key: string;
  value: string;
};

export type NodeConfigDraft = {
  title: string;
  inspirationName: string;
  ownerId: string;
  entryType: InspirationInitialWorkflowEntry;
  sourceNote: string;
  longText: string;
  imageSourceAssetId: string;
  documentSourceAssetId: string;
  documentFilename: string;
  documentMimeType: string;
  documentText: string;
  dynamicFields: InspirationContextDynamicFieldDraft[];
  instruction: string;
  role: string;
  label: string;
  tone: string;
  channel: string;
  size: string;
  toolOptions: ImageToolOptions;
  imageEnhanceStrategy: EnhanceStrategy;
  imageEnhanceTargetWidth: string;
  imageEnhanceTargetHeight: string;
  imageEnhanceScale: string;
  imageEnhanceTileBaseSize: string;
  resourceGroupId: string | null;
  generationConfigMode: GenerationConfigSelectionMode;
  generationConfigId: string | null;
  deckTextGenerationConfigMode: GenerationConfigSelectionMode;
  deckTextGenerationConfigId: string | null;
  deckImageGenerationConfigMode: GenerationConfigSelectionMode;
  deckImageGenerationConfigId: string | null;
  deckSlideSize: string | null;
  copyStructuredPayload: CopyPayloadV2 | null;
  deckStyleKey: string;
  deckSourceInput: string;
  deckMaxSlides: number;
  deckIncludeTransitiveInputs: boolean;
  deckPlanningStrategy: "hybrid" | "copy_led" | "image_led";
  deckSlideCountMode: "auto" | "target";
  deckGroupBy: "tail_item" | "source_node";
  deckSectionPages: boolean;
  deckPerGroupImageCap: number;
  deckExcludedSourceItemIds: string[];
  deckSourceOrder: string[];
};
