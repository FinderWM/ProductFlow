import type {
  CopyPayloadV2,
  ImageToolOptionKey,
  ProductDetail,
  ProductInitialWorkflowEntry,
  WorkflowNode,
  WorkflowNodeType,
} from "../../lib/types";
import {
  DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS,
  compactImageToolOptions,
  imageToolOptionsFromUnknown,
} from "../../lib/imageToolOptions";
import type { NodeConfigDraft } from "./types";
import { defaultTitleForNodeType } from "./nodeDisplay";
import { configString, outputText } from "./utils";

const PRODUCT_CONTEXT_ENTRY_TYPES: ProductInitialWorkflowEntry[] = ["image", "copy", "tail", "blank"];

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

function recordString(record: Record<string, unknown> | null | undefined, key: string, fallback = ""): string {
  const value = record?.[key];
  return typeof value === "string" ? value : fallback;
}

function configOrOutputString(node: WorkflowNode | null, key: string, fallback = ""): string {
  return recordString(node?.config_json, key, recordString(node?.output_json, key, fallback));
}

function entryTypeFromNode(
  node: WorkflowNode | null,
  workflowInitialEntry: ProductInitialWorkflowEntry = "image",
): ProductInitialWorkflowEntry {
  const raw = configOrOutputString(node, "entry_type", workflowInitialEntry);
  return PRODUCT_CONTEXT_ENTRY_TYPES.includes(raw as ProductInitialWorkflowEntry)
    ? (raw as ProductInitialWorkflowEntry)
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

function parseDynamicScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (trimmed && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return value;
}

function dynamicFieldsToConfig(fields: NodeConfigDraft["dynamicFields"]): Record<string, string | number | boolean | null> {
  return fields.reduce<Record<string, string | number | boolean | null>>((result, field) => {
    const key = field.key.trim();
    if (!key) {
      return result;
    }
    result[key] = parseDynamicScalar(field.value);
    return result;
  }, {});
}

export function draftFromNode(
  node: WorkflowNode | null,
  product?: ProductDetail | null,
  workflowInitialEntry: ProductInitialWorkflowEntry = "image",
): NodeConfigDraft {
  const copySetId = node?.output_json
    ? outputText(node.output_json, "copy_set_id")
    : null;
  const copySet = copySetId
    ? product?.copy_sets.find((item) => item.id === copySetId)
    : null;
  return {
    title: node?.title ?? "",
    productName: configString(node, "name", product?.name ?? ""),
    ownerId: configOrOutputString(node, "owner_id", product?.id ?? ""),
    entryType: entryTypeFromNode(node, workflowInitialEntry),
    category: configString(node, "category", product?.category ?? ""),
    price: configString(node, "price", product?.price ?? ""),
    sourceNote:
      node?.node_type === "tail_splitter"
        ? configString(node, "source_text")
        : configString(node, "source_note", product?.source_note ?? ""),
    longText: configOrOutputString(
      node,
      "long_text",
      configOrOutputString(node, "source_note", product?.source_note ?? ""),
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
    generationConfigMode: generationConfigModeFromNode(node),
    generationConfigId: generationConfigIdFromNode(node),
    copyStructuredPayload: copySet?.structured_payload ?? outputStructuredPayload(node),
  };
}

export function nodeConfigFromDraft(
  node: WorkflowNode,
  draft: NodeConfigDraft,
  imageToolAllowedFields: readonly ImageToolOptionKey[] = DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS,
): Record<string, unknown> {
  const base = { ...node.config_json };
  if (node.node_type === "product_context") {
    const longText = draft.longText;
    return {
      ...base,
      name: draft.productName,
      owner_id: draft.ownerId,
      entry_type: draft.entryType,
      category: draft.category,
      price: draft.price,
      long_text: longText,
      source_note: longText,
      image_source_asset_id: draft.imageSourceAssetId || null,
      document_source_asset_id: draft.documentSourceAssetId || null,
      document_filename: draft.documentFilename || null,
      document_mime_type: draft.documentMimeType || null,
      document_text: draft.documentText || null,
      dynamic_fields: dynamicFieldsToConfig(draft.dynamicFields),
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
      generation_config_mode: draft.generationConfigMode,
      generation_config_id: draft.generationConfigMode === "manual" ? draft.generationConfigId : null,
    };
  }
  if (node.node_type === "image_generation") {
    const toolOptions = compactImageToolOptions(draft.toolOptions, imageToolAllowedFields);
    return {
      ...base,
      instruction: draft.instruction,
      size: draft.size,
      generation_config_mode: draft.generationConfigMode,
      generation_config_id: draft.generationConfigMode === "manual" ? draft.generationConfigId : null,
      ...(toolOptions ? { tool_options: toolOptions } : { tool_options: null }),
    };
  }
  if (node.node_type === "tail_splitter") {
    const parsedMaxItems = Number.parseInt(draft.channel || "8", 10);
    return {
      ...base,
      description: draft.instruction,
      source_text: draft.sourceNote,
      max_items: Number.isFinite(parsedMaxItems) ? parsedMaxItems : 8,
      generation_config_mode: draft.generationConfigMode,
      generation_config_id: draft.generationConfigMode === "manual" ? draft.generationConfigId : null,
      document_source:
        base.document_source && typeof base.document_source === "object" ? base.document_source : null,
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
      generation_config_mode: "auto",
      generation_config_id: null,
    };
  }
  if (type === "image_generation") {
    return {
      instruction: "描述你想生成的图片",
      size: "1024x1024",
      generation_config_mode: "auto",
      generation_config_id: null,
      tool_options: null,
    };
  }
  if (type === "tail_splitter") {
    return {
      description: "",
      source_text: "",
      max_items: 8,
      generation_config_mode: "auto",
      generation_config_id: null,
      document_source: null,
    };
  }
  return {};
}

export function defaultTitleForType(type: WorkflowNodeType, index: number): string {
  return defaultTitleForNodeType(type, index);
}
