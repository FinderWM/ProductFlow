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
    resourceGroupId: configString(node, "resource_group_id") || null,
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
  return {};
}

export function defaultTitleForType(type: WorkflowNodeType, index: number): string {
  return defaultTitleForNodeType(type, index);
}
