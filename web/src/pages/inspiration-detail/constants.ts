import type { WorkflowNodeType } from "../../lib/types";

export const NODE_WIDTH = 272;

export const ADD_NODE_OPTIONS: Array<{ type: WorkflowNodeType }> = [
  { type: "reference_image" },
  { type: "copy_generation" },
  { type: "tail_splitter" },
  { type: "image_generation" },
  { type: "deck_generation" },
];

export const MIN_INSPECTOR_WIDTH = 280;
export const MAX_INSPECTOR_WIDTH = 560;
export const DEFAULT_GENERATION_TAIL_SPLITTER_MAX_ITEMS = 36;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 1.6;
export const IMAGE_PREVIEW_SURFACE_CLASS_NAME =
  "bg-[linear-gradient(135deg,#fafafa_25%,#f4f4f5_25%,#f4f4f5_50%,#fafafa_50%,#fafafa_75%,#f4f4f5_75%,#f4f4f5_100%)] bg-[length:16px_16px]";
