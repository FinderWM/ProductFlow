// 配置测试草稿与测试记录状态机：文案/图片/JSON 响应格式测试的草稿规范化、本地存储读写、记录状态变更。
// 从 SettingsPage.tsx 抽出的纯逻辑（仅 localStorage 副作用），SettingsPage import 使用并 re-export 测试锁定的函数/类型。

import type {
  ImageGenerationConfigTestResponse,
  TextGenerationConfigJsonResponseFormatTestResponse,
  TextGenerationConfigTestResponse,
} from "../../lib/types";

export interface TextConfigTestDraft {
  inspirationName: string;
  category: string;
  price: string;
  sourceNote: string;
  instruction: string;
}

export interface TextConfigTestRecord {
  testing: boolean;
  result: TextGenerationConfigTestResponse | null;
  error: string;
}

export interface TextConfigTestState {
  draft: TextConfigTestDraft;
  latestKey: string | null;
  records: Record<string, TextConfigTestRecord>;
}

export interface TextConfigJsonResponseFormatTestRecord {
  testing: boolean;
  result: TextGenerationConfigJsonResponseFormatTestResponse | null;
  error: string;
}

export interface TextConfigJsonResponseFormatTestState {
  latestKey: string | null;
  records: Record<string, TextConfigJsonResponseFormatTestRecord>;
}

export interface ImageConfigTestDraft {
  size: string;
  prompt: string;
}

export interface ImageConfigTestRecord {
  testing: boolean;
  result: ImageGenerationConfigTestResponse | null;
  error: string;
}

export interface ImageConfigTestState {
  draft: ImageConfigTestDraft;
  latestKey: string | null;
  records: Record<string, ImageConfigTestRecord>;
}

export const DEFAULT_TEXT_CONFIG_TEST_DRAFT: TextConfigTestDraft = {
  inspirationName: "蓝天白云青草地",
  category: "自然风景场景",
  price: "",
  sourceNote: "画面包含明亮蓝天、轻盈白云和连片青草地，氛围清新开阔，适合表达户外自然与舒展感。",
  instruction: "围绕蓝天白云青草地生成清晰、自然、适合画面展示的短文案。",
};
const LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT: TextConfigTestDraft = {
  inspirationName: "测试灵感产物",
  category: "电商灵感产物",
  price: "",
  sourceNote: "用于验证当前文案生成配置的测试输入。",
  instruction: "输出适合主图的短文案。",
};

const TEXT_CONFIG_TEST_STORAGE_KEY = "inspiration-one.settings.text-config-test";
const IMAGE_CONFIG_TEST_STORAGE_KEY = "inspiration-one.settings.image-config-test";
export const DEFAULT_IMAGE_CONFIG_TEST_DRAFT: ImageConfigTestDraft = {
  size: "1024x1024",
  prompt: "蓝天白云下，一片开阔柔软的青草地延伸到远处，阳光明亮，画面清新自然，空气通透，构图干净。",
};
const LEGACY_DEFAULT_IMAGE_CONFIG_TEST_DRAFT: ImageConfigTestDraft = {
  size: "1024x1024",
  prompt: "生成一张干净的产品展示图，主体清晰，背景简洁，适合验证当前图片生成配置。",
};

function isLegacyDefaultTextConfigTestDraft(record: Record<string, unknown>): boolean {
  return (
    record.inspirationName === LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT.inspirationName &&
    record.category === LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT.category &&
    record.price === LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT.price &&
    record.sourceNote === LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT.sourceNote &&
    record.instruction === LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT.instruction
  );
}

export function normalizeTextConfigTestDraft(value: unknown): TextConfigTestDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_TEXT_CONFIG_TEST_DRAFT;
  }
  const record = value as Record<string, unknown>;
  if (isLegacyDefaultTextConfigTestDraft(record)) {
    return DEFAULT_TEXT_CONFIG_TEST_DRAFT;
  }
  return {
    inspirationName:
      typeof record.inspirationName === "string"
        ? record.inspirationName
        : DEFAULT_TEXT_CONFIG_TEST_DRAFT.inspirationName,
    category: typeof record.category === "string" ? record.category : DEFAULT_TEXT_CONFIG_TEST_DRAFT.category,
    price: typeof record.price === "string" ? record.price : DEFAULT_TEXT_CONFIG_TEST_DRAFT.price,
    sourceNote:
      typeof record.sourceNote === "string" ? record.sourceNote : DEFAULT_TEXT_CONFIG_TEST_DRAFT.sourceNote,
    instruction:
      typeof record.instruction === "string" ? record.instruction : DEFAULT_TEXT_CONFIG_TEST_DRAFT.instruction,
  };
}

export function readTextConfigTestDraft(): TextConfigTestDraft {
  if (typeof window === "undefined") {
    return DEFAULT_TEXT_CONFIG_TEST_DRAFT;
  }
  try {
    return normalizeTextConfigTestDraft(JSON.parse(window.localStorage.getItem(TEXT_CONFIG_TEST_STORAGE_KEY) || "null"));
  } catch {
    return DEFAULT_TEXT_CONFIG_TEST_DRAFT;
  }
}

export function writeTextConfigTestDraft(draft: TextConfigTestDraft): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(TEXT_CONFIG_TEST_STORAGE_KEY, JSON.stringify(normalizeTextConfigTestDraft(draft)));
  } catch {
    // Local storage may be unavailable in private or restricted browser contexts.
  }
}

export function normalizeImageConfigTestDraft(value: unknown): ImageConfigTestDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_IMAGE_CONFIG_TEST_DRAFT;
  }
  const record = value as Record<string, unknown>;
  const size =
    typeof record.size === "string" && record.size.trim()
      ? record.size.trim()
      : DEFAULT_IMAGE_CONFIG_TEST_DRAFT.size;
  const prompt =
    typeof record.prompt === "string"
      ? record.prompt === LEGACY_DEFAULT_IMAGE_CONFIG_TEST_DRAFT.prompt
        ? DEFAULT_IMAGE_CONFIG_TEST_DRAFT.prompt
        : record.prompt
      : DEFAULT_IMAGE_CONFIG_TEST_DRAFT.prompt;
  return { size, prompt };
}

export function readImageConfigTestDraft(): ImageConfigTestDraft {
  if (typeof window === "undefined") {
    return DEFAULT_IMAGE_CONFIG_TEST_DRAFT;
  }
  try {
    return normalizeImageConfigTestDraft(JSON.parse(window.localStorage.getItem(IMAGE_CONFIG_TEST_STORAGE_KEY) || "null"));
  } catch {
    return DEFAULT_IMAGE_CONFIG_TEST_DRAFT;
  }
}

export function writeImageConfigTestDraft(draft: ImageConfigTestDraft): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(IMAGE_CONFIG_TEST_STORAGE_KEY, JSON.stringify(normalizeImageConfigTestDraft(draft)));
  } catch {
    // Local storage may be unavailable in private or restricted browser contexts.
  }
}

export function textConfigTestRecordForKey(
  state: TextConfigTestState | undefined,
  key: string,
): TextConfigTestRecord | null {
  return state?.records[key] ?? null;
}

export function markTextConfigTestStarted(state: TextConfigTestState, key: string): TextConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: true, result: null, error: "" },
    },
  };
}

export function markTextConfigTestSucceeded(
  state: TextConfigTestState,
  key: string,
  result: TextGenerationConfigTestResponse,
): TextConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result, error: "" },
    },
  };
}

export function markTextConfigTestFailed(
  state: TextConfigTestState,
  key: string,
  error: string,
): TextConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result: null, error },
    },
  };
}

export function clearTextConfigTestRecord(state: TextConfigTestState, key: string): TextConfigTestState {
  if (!state.records[key] && state.latestKey !== key) {
    return state;
  }
  const records = { ...state.records };
  delete records[key];
  return {
    ...state,
    latestKey: state.latestKey === key ? null : state.latestKey,
    records,
  };
}

export function imageConfigTestRecordForKey(
  state: ImageConfigTestState | undefined,
  key: string,
): ImageConfigTestRecord | null {
  return state?.records[key] ?? null;
}

export function markImageConfigTestStarted(state: ImageConfigTestState, key: string): ImageConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: true, result: null, error: "" },
    },
  };
}

export function markImageConfigTestSucceeded(
  state: ImageConfigTestState,
  key: string,
  result: ImageGenerationConfigTestResponse,
): ImageConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result, error: "" },
    },
  };
}

export function markImageConfigTestFailed(
  state: ImageConfigTestState,
  key: string,
  error: string,
): ImageConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result: null, error },
    },
  };
}

export function markImageConfigTestAssetSaved(
  state: ImageConfigTestState,
  assetId: string,
  result: ImageGenerationConfigTestResponse,
): ImageConfigTestState {
  const records = Object.fromEntries(
    Object.entries(state.records).map(([key, record]) => [
      key,
      record.result?.generated_asset.id === assetId ? { ...record, result } : record,
    ]),
  );
  return { ...state, records };
}

export function clearImageConfigTestRecord(state: ImageConfigTestState, key: string): ImageConfigTestState {
  if (!state.records[key] && state.latestKey !== key) {
    return state;
  }
  const records = { ...state.records };
  delete records[key];
  return {
    ...state,
    latestKey: state.latestKey === key ? null : state.latestKey,
    records,
  };
}

export function textConfigJsonResponseFormatTestRecordForKey(
  state: TextConfigJsonResponseFormatTestState | undefined,
  key: string,
): TextConfigJsonResponseFormatTestRecord | null {
  return state?.records[key] ?? null;
}

export function markTextConfigJsonResponseFormatTestStarted(
  state: TextConfigJsonResponseFormatTestState,
  key: string,
): TextConfigJsonResponseFormatTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: true, result: null, error: "" },
    },
  };
}

export function markTextConfigJsonResponseFormatTestSucceeded(
  state: TextConfigJsonResponseFormatTestState,
  key: string,
  result: TextGenerationConfigJsonResponseFormatTestResponse,
): TextConfigJsonResponseFormatTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result, error: "" },
    },
  };
}

export function markTextConfigJsonResponseFormatTestFailed(
  state: TextConfigJsonResponseFormatTestState,
  key: string,
  error: string,
): TextConfigJsonResponseFormatTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result: null, error },
    },
  };
}

export function clearTextConfigJsonResponseFormatTestRecord(
  state: TextConfigJsonResponseFormatTestState,
  key: string,
): TextConfigJsonResponseFormatTestState {
  if (!state.records[key] && state.latestKey !== key) {
    return state;
  }
  const records = { ...state.records };
  delete records[key];
  return {
    ...state,
    latestKey: state.latestKey === key ? null : state.latestKey,
    records,
  };
}
