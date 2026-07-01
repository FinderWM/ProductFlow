import type {
  CopyPayloadV2,
  ImageToolOptionKey,
  InspirationDetail,
  InspirationInitialWorkflowEntry,
  WorkflowNode,
  WorkflowNodeType,
} from "../../lib/types";
import {
  DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS,
  compactImageToolOptions,
  imageToolOptionsFromUnknown,
} from "../../lib/imageToolOptions";
import { dynamicFieldsToRecord } from "../../lib/dynamicFields";
import type { NodeConfigDraft } from "./types";
import { defaultTitleForNodeType } from "./nodeDisplay";
import { configString, outputText } from "./utils";

const INSPIRATION_CONTEXT_ENTRY_TYPES: InspirationInitialWorkflowEntry[] = ["image", "copy", "tail", "blank"];
const DECK_SLIDE_SIZE_VALUES = new Set(["2048x1152", "1920x1080", "1280x720"]);

function outputStructuredPayload(node: WorkflowNode | null): CopyPayloadV2 | null {
  const payload = node?.output_json?.structured_payload;
  if (payload && typeof payload === "object" && "version" in payload && "content" in payload) {
    return payload as CopyPayloadV2;
  }
  return null;
}

function generationConfigModeFromNode(node: WorkflowNode | null): "auto" | "manual" {
  return configString(node, "generation_config_mode") === "manual" ? "manual" : "auto";
}

function generationConfigIdFromNode(node: WorkflowNode | null): string | null {
  const generationConfigId = configString(node, "generation_config_id");
  return generationConfigId || null;
}

function configNumber(node: WorkflowNode | null, key: string, fallback: number): number {
  const value = node?.config_json?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function configRecordNumber(node: WorkflowNode | null, recordKey: string, key: string, fallback: number): number {
  const record = node?.config_json?.[recordKey];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return fallback;
  }
  const value = (record as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function configBoolean(node: WorkflowNode | null, key: string, fallback = false): boolean {
  const value = node?.config_json?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function configStringArray(node: WorkflowNode | null, key: string): string[] {
  const value = node?.config_json?.[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function generationConfigFromDraft(draft: NodeConfigDraft): {
  generation_config_mode: "auto" | "manual";
  generation_config_id: string | null;
} {
  const mode = draft.generationConfigMode === "manual" ? "manual" : "auto";
  return {
    generation_config_mode: mode,
    generation_config_id: mode === "manual" ? draft.generationConfigId : null,
  };
}

function deckGenerationConfigFromDraft(
  mode: NodeConfigDraft["deckTextGenerationConfigMode"],
  generationConfigId: string | null,
): {
  generation_config_mode: "auto" | "manual";
  generation_config_id: string | null;
} {
  const resolvedMode = mode === "manual" ? "manual" : "auto";
  return {
    generation_config_mode: resolvedMode,
    generation_config_id: resolvedMode === "manual" ? generationConfigId : null,
  };
}

function deckGenerationConfigModeFromNode(
  node: WorkflowNode | null,
  modeKey: string,
): "auto" | "manual" {
  return configString(node, modeKey) === "manual" ? "manual" : "auto";
}

function deckGenerationConfigIdFromNode(node: WorkflowNode | null, idKey: string): string | null {
  return configString(node, idKey) || null;
}

function deckSlideSizeFromNode(node: WorkflowNode | null): string | null {
  const value = configString(node, "deck_slide_size");
  return DECK_SLIDE_SIZE_VALUES.has(value) ? value : null;
}

function recordString(record: Record<string, unknown> | null | undefined, key: string, fallback = ""): string {
  const value = record?.[key];
  if (typeof value !== "string") {
    return fallback;
  }
  const normalizedValue = value.trim();
  return normalizedValue || fallback;
}

function configOrOutputString(node: WorkflowNode | null, key: string, fallback = ""): string {
  return recordString(node?.config_json, key, recordString(node?.output_json, key, fallback));
}

function entryTypeFromNode(
  node: WorkflowNode | null,
  workflowInitialEntry: InspirationInitialWorkflowEntry = "image",
): InspirationInitialWorkflowEntry {
  const raw = configOrOutputString(node, "entry_type", workflowInitialEntry);
  return INSPIRATION_CONTEXT_ENTRY_TYPES.includes(raw as InspirationInitialWorkflowEntry)
    ? (raw as InspirationInitialWorkflowEntry)
    : workflowInitialEntry;
}

function dynamicFieldValueToDraft(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function dynamicFieldsFromNode(node: WorkflowNode | null): NodeConfigDraft["dynamicFields"] {
  const raw =
    node?.config_json.dynamic_fields && typeof node.config_json.dynamic_fields === "object"
      ? node.config_json.dynamic_fields
      : node?.output_json?.dynamic_fields;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  return Object.entries(raw).map(([key, value], index) => ({
    id: `dynamic-${index}-${key}`,
    key,
    value: dynamicFieldValueToDraft(value),
  }));
}

export function draftFromNode(
  node: WorkflowNode | null,
  inspiration?: InspirationDetail | null,
  workflowInitialEntry: InspirationInitialWorkflowEntry = "image",
): NodeConfigDraft {
  const copySetId = node?.output_json
    ? outputText(node.output_json, "copy_set_id")
    : null;
  const copySet = copySetId
    ? inspiration?.copy_sets.find((item) => item.id === copySetId)
    : null;
  return {
    title: node?.title ?? "",
    inspirationName: configString(node, "name", inspiration?.name ?? ""),
    ownerId: configOrOutputString(node, "owner_id", inspiration?.id ?? ""),
    entryType: entryTypeFromNode(node, workflowInitialEntry),
    sourceNote:
      node?.node_type === "tail_splitter"
        ? configOrOutputString(node, "source_text")
        : configOrOutputString(node, "source_note", inspiration?.source_note ?? ""),
    longText: configOrOutputString(
      node,
      "long_text",
      configOrOutputString(node, "source_note", inspiration?.source_note ?? ""),
    ),
    imageSourceAssetId: configOrOutputString(
      node,
      "image_source_asset_id",
      configOrOutputString(node, "source_asset_id"),
    ),
    documentSourceAssetId: configOrOutputString(node, "document_source_asset_id"),
    documentFilename: configOrOutputString(node, "document_filename"),
    documentMimeType: configOrOutputString(node, "document_mime_type"),
    documentText: configOrOutputString(node, "document_text"),
    dynamicFields: dynamicFieldsFromNode(node),
    instruction:
      node?.node_type === "tail_splitter"
        ? configString(node, "description")
        : configString(node, "instruction"),
    role: configString(node, "role", "reference"),
    label: configString(node, "label"),
    tone: configString(node, "tone", "转化清晰"),
    channel:
      node?.node_type === "tail_splitter"
        ? String(node?.config_json?.max_items ?? 8)
        : configString(node, "channel", "灵感主图"),
    size: configString(node, "size", "1024x1024"),
    toolOptions: imageToolOptionsFromUnknown(node?.config_json?.tool_options),
    imageEnhanceStrategy: configString(node, "strategy", "direct") === "tiled" ? "tiled" : "direct",
    imageEnhanceTargetWidth: String(configRecordNumber(node, "params", "target_width", 1024)),
    imageEnhanceTargetHeight: String(configRecordNumber(node, "params", "target_height", 1024)),
    imageEnhanceScale: String(configRecordNumber(node, "params", "scale", 2)),
    imageEnhanceTileBaseSize: String(configRecordNumber(node, "params", "tile_base_size", 1024)),
    resourceGroupId: configString(node, "resource_group_id") || null,
    generationConfigMode: generationConfigModeFromNode(node),
    generationConfigId: generationConfigIdFromNode(node),
    deckTextGenerationConfigMode: deckGenerationConfigModeFromNode(node, "text_generation_config_mode"),
    deckTextGenerationConfigId: deckGenerationConfigIdFromNode(node, "text_generation_config_id"),
    deckImageGenerationConfigMode: deckGenerationConfigModeFromNode(node, "image_generation_config_mode"),
    deckImageGenerationConfigId: deckGenerationConfigIdFromNode(node, "image_generation_config_id"),
    deckSlideSize: deckSlideSizeFromNode(node),
    copyStructuredPayload: copySet?.structured_payload ?? outputStructuredPayload(node),
    deckStyleKey: configString(node, "style_key", "clean_business"),
    deckSourceInput: configString(node, "source_input"),
    deckMaxSlides: configNumber(node, "target_slide_count", 8),
    deckIncludeTransitiveInputs: configBoolean(node, "include_transitive_inputs"),
    deckPlanningStrategy:
      configString(node, "planning_strategy", "hybrid") === "copy_led"
        ? "copy_led"
        : configString(node, "planning_strategy", "hybrid") === "image_led"
          ? "image_led"
          : "hybrid",
    deckSlideCountMode: configString(node, "slide_count_mode", "auto") === "target" ? "target" : "auto",
    deckGroupBy: configString(node, "group_by", "tail_item") === "source_node" ? "source_node" : "tail_item",
    deckSectionPages: configBoolean(node, "section_pages", true),
    deckPerGroupImageCap: configNumber(node, "per_group_image_cap", 3),
    deckExcludedSourceItemIds: configStringArray(node, "excluded_source_item_ids"),
    deckSourceOrder: configStringArray(node, "source_order"),
  };
}

export function nodeConfigFromDraft(
  node: WorkflowNode,
  draft: NodeConfigDraft,
  imageToolAllowedFields: readonly ImageToolOptionKey[] = DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS,
): Record<string, unknown> {
  const base = { ...node.config_json };
  if (node.node_type === "inspiration_context") {
    const longText = draft.longText;
    const inspirationContextBase = { ...base };
    delete inspirationContextBase.category;
    delete inspirationContextBase.price;
    return {
      ...inspirationContextBase,
      name: draft.inspirationName,
      owner_id: inspirationContextBase.owner_id ?? draft.ownerId,
      entry_type: inspirationContextBase.entry_type ?? draft.entryType,
      long_text: longText,
      source_note: longText,
      image_source_asset_id: draft.imageSourceAssetId || null,
      document_source_asset_id: draft.documentSourceAssetId || null,
      document_filename: draft.documentFilename || null,
      document_mime_type: draft.documentMimeType || null,
      document_text: draft.documentText || null,
      dynamic_fields: dynamicFieldsToRecord(draft.dynamicFields),
    };
  }
  if (node.node_type === "reference_image") {
    return { ...base, role: draft.role, label: draft.label };
  }
  if (node.node_type === "copy_generation") {
    return {
      ...base,
      version: 2,
      instruction: draft.instruction,
      tone: draft.tone,
      channel: draft.channel,
      purpose: configString(node, "purpose"),
      output_mode: configString(node, "output_mode", "blocks"),
      resource_group_id: draft.resourceGroupId,
      ...generationConfigFromDraft(draft),
    };
  }
  if (node.node_type === "image_generation") {
    const toolOptions = compactImageToolOptions(draft.toolOptions, imageToolAllowedFields);
    return {
      ...base,
      instruction: draft.instruction,
      size: draft.size,
      resource_group_id: draft.resourceGroupId,
      ...generationConfigFromDraft(draft),
      ...(toolOptions ? { tool_options: toolOptions } : { tool_options: null }),
    };
  }
  if (node.node_type === "image_enhance") {
    const targetWidth = Number.parseInt(draft.imageEnhanceTargetWidth || "1024", 10);
    const targetHeight = Number.parseInt(draft.imageEnhanceTargetHeight || "1024", 10);
    const scale = Number.parseInt(draft.imageEnhanceScale || "2", 10);
    const tileBaseSize = Number.parseInt(draft.imageEnhanceTileBaseSize || "1024", 10);
    return {
      ...base,
      strategy: draft.imageEnhanceStrategy,
      params:
        draft.imageEnhanceStrategy === "direct"
          ? {
              target_width: Number.isFinite(targetWidth) ? targetWidth : 1024,
              target_height: Number.isFinite(targetHeight) ? targetHeight : 1024,
            }
          : {
              scale: Number.isFinite(scale) ? Math.max(2, Math.min(4, scale)) : 2,
              tile_base_size: Number.isFinite(tileBaseSize) ? Math.max(256, Math.min(2048, tileBaseSize)) : 1024,
              overlap_pct: 10,
            },
      resource_group_id: draft.resourceGroupId,
      ...generationConfigFromDraft(draft),
    };
  }
  if (node.node_type === "tail_splitter") {
    const parsedMaxItems = Number.parseInt(draft.channel || "8", 10);
    return {
      ...base,
      description: draft.instruction,
      source_text: draft.sourceNote,
      max_items: Number.isFinite(parsedMaxItems) ? parsedMaxItems : 8,
      resource_group_id: draft.resourceGroupId,
      ...generationConfigFromDraft(draft),
      document_source:
        base.document_source && typeof base.document_source === "object" ? base.document_source : null,
    };
  }
  if (node.node_type === "deck_generation") {
    const textConfig = deckGenerationConfigFromDraft(
      draft.deckTextGenerationConfigMode,
      draft.deckTextGenerationConfigId,
    );
    const imageConfig = deckGenerationConfigFromDraft(
      draft.deckImageGenerationConfigMode,
      draft.deckImageGenerationConfigId,
    );
    return {
      ...base,
      title: draft.title,
      resource_group_id: draft.resourceGroupId,
      text_generation_config_mode: textConfig.generation_config_mode,
      text_generation_config_id: textConfig.generation_config_id,
      image_generation_config_mode: imageConfig.generation_config_mode,
      image_generation_config_id: imageConfig.generation_config_id,
      deck_slide_size: draft.deckSlideSize,
      style_key: draft.deckStyleKey || null,
      source_input: draft.deckSourceInput,
      target_slide_count: Math.max(1, Math.min(50, Math.trunc(draft.deckMaxSlides || 8))),
      include_transitive_inputs: draft.deckIncludeTransitiveInputs,
      planning_strategy: draft.deckPlanningStrategy,
      slide_count_mode: draft.deckSlideCountMode,
      group_by: draft.deckGroupBy,
      section_pages: draft.deckSectionPages,
      per_group_image_cap: Math.max(1, Math.min(12, Math.trunc(draft.deckPerGroupImageCap || 3))),
      excluded_source_item_ids: Array.from(new Set(draft.deckExcludedSourceItemIds)),
      source_order: Array.from(new Set(draft.deckSourceOrder)),
    };
  }
  return base;
}

export function defaultConfigForType(type: WorkflowNodeType): Record<string, unknown> {
  if (type === "reference_image") {
    return { role: "reference", label: "" };
  }
  if (type === "copy_generation") {
    return {
      version: 2,
      instruction: "生成灵感文案",
      tone: "清晰可信",
      channel: "灵感图",
      output_mode: "blocks",
      resource_group_id: null,
      generation_config_mode: "auto",
      generation_config_id: null,
    };
  }
  if (type === "image_generation") {
    return {
      instruction: "描述你想生成的图片",
      size: "1024x1024",
      resource_group_id: null,
      generation_config_mode: "auto",
      generation_config_id: null,
      tool_options: null,
    };
  }
  if (type === "image_enhance") {
    return {
      strategy: "direct",
      params: {
        target_width: 1024,
        target_height: 1024,
      },
      resource_group_id: null,
      generation_config_mode: "auto",
      generation_config_id: null,
    };
  }
  if (type === "tail_splitter") {
    return {
      description: "",
      source_text: "",
      max_items: 8,
      resource_group_id: null,
      generation_config_mode: "auto",
      generation_config_id: null,
      document_source: null,
    };
  }
  if (type === "deck_generation") {
    return {
      resource_group_id: null,
      text_generation_config_mode: "auto",
      text_generation_config_id: null,
      image_generation_config_mode: "auto",
      image_generation_config_id: null,
      deck_slide_size: null,
      style_key: "clean_business",
      source_input: "",
      target_slide_count: 8,
      include_transitive_inputs: false,
      planning_strategy: "hybrid",
      slide_count_mode: "auto",
      group_by: "tail_item",
      section_pages: true,
      per_group_image_cap: 3,
      excluded_source_item_ids: [],
      source_order: [],
    };
  }
  return {};
}

export function defaultTitleForType(type: WorkflowNodeType, index: number): string {
  return defaultTitleForNodeType(type, index);
}
