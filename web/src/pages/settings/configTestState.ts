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
  purpose: string;
  channel: string;
  tone: string;
  outputMode: "freeform" | "blocks" | "layout_brief";
  requestedSlotsText: string;
  referenceAssetIds: string[];
}

export interface TextConfigTestPreset {
  id: string;
  label: string;
  description: string;
  draft: TextConfigTestDraft;
}

export interface TextConfigTestDraftState {
  selectedPresetId: string;
  draft: TextConfigTestDraft;
  presets: Record<string, TextConfigTestDraft>;
}

export interface TextConfigTestRecord {
  testing: boolean;
  result: TextGenerationConfigTestResponse | null;
  error: string;
}

export interface TextConfigTestState {
  selectedPresetId: string;
  draft: TextConfigTestDraft;
  presets: Record<string, TextConfigTestDraft>;
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

export interface ImageConfigTestPreset {
  id: string;
  label: string;
  description: string;
  draft: ImageConfigTestDraft;
}

export interface ImageConfigTestDraftState {
  selectedPresetId: string;
  draft: ImageConfigTestDraft;
  presets: Record<string, ImageConfigTestDraft>;
}

export interface ImageConfigTestRecord {
  testing: boolean;
  result: ImageGenerationConfigTestResponse | null;
  error: string;
}

export interface ImageConfigTestState {
  selectedPresetId: string;
  draft: ImageConfigTestDraft;
  presets: Record<string, ImageConfigTestDraft>;
  latestKey: string | null;
  records: Record<string, ImageConfigTestRecord>;
}

const EMPTY_REQUESTED_SLOTS_JSON = "[]";

function textConfigDraft({
  inspirationName,
  category,
  sourceNote,
  instruction,
  purpose = "visual_creation",
  channel = "视觉创作",
  tone = "克制、诗意、具象",
  outputMode = "blocks",
}: {
  inspirationName: string;
  category: string;
  sourceNote: string;
  instruction: string;
  purpose?: string;
  channel?: string;
  tone?: string;
  outputMode?: TextConfigTestDraft["outputMode"];
  price?: string;
  requestedSlotsText?: string;
}): TextConfigTestDraft {
  return {
    inspirationName,
    category,
    price: "",
    sourceNote,
    instruction,
    purpose,
    channel,
    tone,
    outputMode,
    requestedSlotsText: EMPTY_REQUESTED_SLOTS_JSON,
    referenceAssetIds: [],
  };
}

export const DEFAULT_TEXT_CONFIG_TEST_PRESETS: TextConfigTestPreset[] = [
  {
    id: "rain-valley-village",
    label: "雨后山谷与古村石桥",
    description: "人文与自然景观",
    draft: textConfigDraft({
      inspirationName: "雨后山谷与古村石桥",
      category: "人文与自然景观创作",
      sourceNote:
        "雨后的山谷云雾缓慢升起，远处有青瓦古村、石桥和溪流，画面融合自然景观与人文生活痕迹，氛围安静、湿润、带有旅行纪实感。",
      instruction: "围绕雨后山谷、古村石桥和人与自然共处的氛围，生成适合视觉创作参考的中文文案。",
    }),
  },
  {
    id: "coastal-lighthouse-traveler",
    label: "海边灯塔与独行旅人",
    description: "旅行纪实与情绪风景",
    draft: textConfigDraft({
      inspirationName: "海边灯塔与独行旅人",
      category: "旅行纪实与情绪风景",
      sourceNote:
        "黄昏海边有一座白色灯塔，远处浪线平缓，一位旅人背着包沿着湿润礁石前行，画面有风、海盐气息和轻微孤独感。",
      instruction: "生成围绕海边灯塔、旅人背影和黄昏海风的视觉文案，强调情绪、空间和画面层次。",
      tone: "安静、电影感、留白",
    }),
  },
  {
    id: "morning-old-street-breakfast",
    label: "老街清晨与早点摊",
    description: "城市人文纪实",
    draft: textConfigDraft({
      inspirationName: "老街清晨与早点摊",
      category: "城市人文纪实",
      sourceNote:
        "清晨的老街还带着潮气，早点摊冒着热气，摊主递出刚蒸好的食物，街边有骑车上学的孩子和慢慢打开的旧木门。",
      instruction: "围绕老街清晨、早点摊和日常生活的温度，生成具有人文观察感的中文文案。",
      tone: "温暖、细腻、纪实",
    }),
  },
  {
    id: "snow-mountain-camp-stargazing",
    label: "雪山营地与星空观测",
    description: "户外探索与自然景观",
    draft: textConfigDraft({
      inspirationName: "雪山营地与星空观测",
      category: "户外探索与自然景观",
      sourceNote:
        "高海拔雪山脚下有一处小型营地，帐篷透出暖光，夜空星河清晰，人物正在调整望远镜，冷冽环境中有微弱但坚定的探索感。",
      instruction: "生成适合雪山营地、星空观测和户外探索主题的中文视觉文案。",
      tone: "开阔、冷静、探索感",
    }),
  },
  {
    id: "museum-restoration-room",
    label: "博物馆修复室与古画细节",
    description: "文化艺术与手工修复",
    draft: textConfigDraft({
      inspirationName: "博物馆修复室与古画细节",
      category: "文化艺术与手工修复",
      sourceNote:
        "安静的博物馆修复室里，修复师戴着手套，在柔和灯光下处理一幅古画的边缘裂痕，桌面有毛笔、放大镜和记录纸。",
      instruction: "围绕古画修复、手工细节和文化时间感，生成克制、准确、有画面感的中文文案。",
      tone: "沉稳、专业、细节丰富",
      outputMode: "layout_brief",
    }),
  },
  {
    id: "near-future-rain-station",
    label: "近未来雨夜车站",
    description: "科幻城市视觉创作",
    draft: textConfigDraft({
      inspirationName: "近未来雨夜车站",
      category: "科幻城市视觉创作",
      sourceNote:
        "雨夜中的近未来车站有半透明电子屏、湿润地面反光和等待列车的人群，冷色霓虹与暖色室内灯交错，氛围疏离但有秩序。",
      instruction: "生成围绕近未来车站、雨夜反光、霓虹光影和人群秩序感的中文视觉文案。",
      tone: "冷静、未来感、视觉密度高",
      outputMode: "layout_brief",
    }),
  },
];

export const DEFAULT_TEXT_CONFIG_TEST_DRAFT = DEFAULT_TEXT_CONFIG_TEST_PRESETS[0].draft;
const DEFAULT_TEXT_CONFIG_TEST_PRESET_ID = DEFAULT_TEXT_CONFIG_TEST_PRESETS[0].id;

const PREVIOUS_DEFAULT_TEXT_CONFIG_TEST_DRAFT: TextConfigTestDraft = {
  inspirationName: "蓝天白云青草地",
  category: "自然风景场景",
  price: "",
  sourceNote: "画面包含明亮蓝天、轻盈白云和连片青草地，氛围清新开阔，适合表达户外自然与舒展感。",
  instruction: "围绕蓝天白云青草地生成清晰、自然、适合画面展示的短文案。",
  purpose: "visual_creation",
  channel: "视觉创作",
  tone: "克制、诗意、具象",
  outputMode: "blocks",
  requestedSlotsText: EMPTY_REQUESTED_SLOTS_JSON,
  referenceAssetIds: [],
};
const LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT: TextConfigTestDraft = {
  inspirationName: "测试灵感产物",
  category: "电商灵感产物",
  price: "",
  sourceNote: "用于验证当前文案生成配置的测试输入。",
  instruction: "输出适合主图的短文案。",
  purpose: "main_image",
  channel: "电商",
  tone: "清晰直接",
  outputMode: "blocks",
  requestedSlotsText: EMPTY_REQUESTED_SLOTS_JSON,
  referenceAssetIds: [],
};

const TEXT_CONFIG_TEST_STORAGE_KEY = "inspiration-one.settings.text-config-test";
const IMAGE_CONFIG_TEST_STORAGE_KEY = "inspiration-one.settings.image-config-test";

function imageConfigDraft({
  size = "1024x1024",
  prompt,
}: {
  size?: string;
  prompt: string;
}): ImageConfigTestDraft {
  return { size, prompt };
}

function imageConfigPreset(id: string, draft: ImageConfigTestDraft): ImageConfigTestPreset {
  const textPreset = DEFAULT_TEXT_CONFIG_TEST_PRESETS.find((preset) => preset.id === id);
  if (!textPreset) {
    return { id, label: id, description: "", draft };
  }
  return {
    id: textPreset.id,
    label: textPreset.label,
    description: textPreset.description,
    draft,
  };
}

export const DEFAULT_IMAGE_CONFIG_TEST_PRESETS: ImageConfigTestPreset[] = [
  imageConfigPreset(
    "rain-valley-village",
    imageConfigDraft({
      size: "1536x1024",
      prompt:
        "雨后的山谷云雾从溪流边升起，青瓦古村依山而建，一座旧石桥横跨清澈溪水，湿润石阶、苔藓、远山和少量行人形成安静的人文自然风景，写实摄影感，柔和散射光。",
    }),
  ),
  imageConfigPreset(
    "coastal-lighthouse-traveler",
    imageConfigDraft({
      size: "1024x1536",
      prompt:
        "黄昏海边的白色灯塔立在礁石尽头，独行旅人背着包沿湿润礁石前行，海浪线平缓，天空有淡橙与灰蓝层次，画面有海风、盐雾和孤独的电影感。",
    }),
  ),
  imageConfigPreset(
    "morning-old-street-breakfast",
    imageConfigDraft({
      size: "1536x1152",
      prompt:
        "清晨老街带着潮气，早点摊蒸汽升起，摊主把刚出锅的早餐递给路人，旧木门、骑车上学的孩子、斑驳招牌和暖色晨光构成城市人文纪实画面。",
    }),
  ),
  imageConfigPreset(
    "snow-mountain-camp-stargazing",
    imageConfigDraft({
      size: "1792x768",
      prompt:
        "高海拔雪山脚下的小型营地，几顶帐篷透出暖光，银河清晰横跨夜空，人物正在调整望远镜，冷冽蓝色雪地与温暖营灯形成对比，宽幅户外探索场景。",
    }),
  ),
  imageConfigPreset(
    "museum-restoration-room",
    imageConfigDraft({
      size: "1024x1280",
      prompt:
        "安静的博物馆修复室，修复师戴白色手套在柔和台灯下处理古画边缘裂痕，桌面有毛笔、放大镜、记录纸和细小颜料盘，画面克制、专业、细节清晰。",
    }),
  ),
  imageConfigPreset(
    "near-future-rain-station",
    imageConfigDraft({
      size: "1024x1536",
      prompt:
        "近未来雨夜车站，半透明电子屏悬在站台上方，湿润地面映出冷色霓虹和暖色室内灯，等待列车的人群有秩序地站立，城市科幻氛围疏离而清晰。",
    }),
  ),
];

export const DEFAULT_IMAGE_CONFIG_TEST_DRAFT = DEFAULT_IMAGE_CONFIG_TEST_PRESETS[0].draft;
const DEFAULT_IMAGE_CONFIG_TEST_PRESET_ID = DEFAULT_IMAGE_CONFIG_TEST_PRESETS[0].id;
const PREVIOUS_DEFAULT_IMAGE_CONFIG_TEST_DRAFT: ImageConfigTestDraft = {
  size: "1024x1024",
  prompt: "蓝天白云下，一片开阔柔软的青草地延伸到远处，阳光明亮，画面清新自然，空气通透，构图干净。",
};
const LEGACY_DEFAULT_IMAGE_CONFIG_TEST_DRAFT: ImageConfigTestDraft = {
  size: "1024x1024",
  prompt: "生成一张干净的产品展示图，主体清晰，背景简洁，适合验证当前图片生成配置。",
};

function isLegacyDefaultTextConfigTestDraft(record: Record<string, unknown>): boolean {
  return [LEGACY_DEFAULT_TEXT_CONFIG_TEST_DRAFT, PREVIOUS_DEFAULT_TEXT_CONFIG_TEST_DRAFT].some(
    (draft) =>
      record.inspirationName === draft.inspirationName &&
      record.category === draft.category &&
      record.price === draft.price &&
      record.sourceNote === draft.sourceNote &&
      record.instruction === draft.instruction,
  );
}

function cloneTextConfigTestDraft(draft: TextConfigTestDraft): TextConfigTestDraft {
  return { ...draft, referenceAssetIds: [...draft.referenceAssetIds] };
}

function defaultTextConfigTestPresetDrafts(): Record<string, TextConfigTestDraft> {
  return Object.fromEntries(
    DEFAULT_TEXT_CONFIG_TEST_PRESETS.map((preset) => [preset.id, cloneTextConfigTestDraft(preset.draft)]),
  );
}

function cloneImageConfigTestDraft(draft: ImageConfigTestDraft): ImageConfigTestDraft {
  return { ...draft };
}

function defaultImageConfigTestPresetDrafts(): Record<string, ImageConfigTestDraft> {
  return Object.fromEntries(
    DEFAULT_IMAGE_CONFIG_TEST_PRESETS.map((preset) => [preset.id, cloneImageConfigTestDraft(preset.draft)]),
  );
}

function isOutputMode(value: unknown): value is TextConfigTestDraft["outputMode"] {
  return value === "freeform" || value === "blocks" || value === "layout_brief";
}

export function normalizeTextConfigTestDraft(
  value: unknown,
  fallback: TextConfigTestDraft = DEFAULT_TEXT_CONFIG_TEST_DRAFT,
): TextConfigTestDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneTextConfigTestDraft(fallback);
  }
  const record = value as Record<string, unknown>;
  if (isLegacyDefaultTextConfigTestDraft(record)) {
    return cloneTextConfigTestDraft(DEFAULT_TEXT_CONFIG_TEST_DRAFT);
  }
  return {
    inspirationName:
      typeof record.inspirationName === "string" ? record.inspirationName : fallback.inspirationName,
    category: typeof record.category === "string" ? record.category : fallback.category,
    price: typeof record.price === "string" ? record.price : fallback.price,
    sourceNote: typeof record.sourceNote === "string" ? record.sourceNote : fallback.sourceNote,
    instruction: typeof record.instruction === "string" ? record.instruction : fallback.instruction,
    purpose: typeof record.purpose === "string" ? record.purpose : fallback.purpose,
    channel: typeof record.channel === "string" ? record.channel : fallback.channel,
    tone: typeof record.tone === "string" ? record.tone : fallback.tone,
    outputMode: isOutputMode(record.outputMode) ? record.outputMode : fallback.outputMode,
    requestedSlotsText:
      typeof record.requestedSlotsText === "string" ? record.requestedSlotsText : fallback.requestedSlotsText,
    referenceAssetIds: Array.isArray(record.referenceAssetIds)
      ? record.referenceAssetIds
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item, index, array) => item && array.indexOf(item) === index)
      : [...fallback.referenceAssetIds],
  };
}

export function normalizeTextConfigTestDraftState(value: unknown): TextConfigTestDraftState {
  const presets = defaultTextConfigTestPresetDrafts();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      selectedPresetId: DEFAULT_TEXT_CONFIG_TEST_PRESET_ID,
      draft: cloneTextConfigTestDraft(DEFAULT_TEXT_CONFIG_TEST_DRAFT),
      presets,
    };
  }
  const record = value as Record<string, unknown>;
  const rawPresets = record.presets;
  if (rawPresets && typeof rawPresets === "object" && !Array.isArray(rawPresets)) {
    const rawPresetRecord = rawPresets as Record<string, unknown>;
    for (const preset of DEFAULT_TEXT_CONFIG_TEST_PRESETS) {
      presets[preset.id] = normalizeTextConfigTestDraft(rawPresetRecord[preset.id], preset.draft);
    }
    const selectedPresetId =
      typeof record.selectedPresetId === "string" && presets[record.selectedPresetId]
        ? record.selectedPresetId
        : DEFAULT_TEXT_CONFIG_TEST_PRESET_ID;
    return {
      selectedPresetId,
      draft: cloneTextConfigTestDraft(presets[selectedPresetId]),
      presets,
    };
  }
  if (isLegacyDefaultTextConfigTestDraft(record)) {
    return {
      selectedPresetId: DEFAULT_TEXT_CONFIG_TEST_PRESET_ID,
      draft: cloneTextConfigTestDraft(DEFAULT_TEXT_CONFIG_TEST_DRAFT),
      presets,
    };
  }
  const draft = normalizeTextConfigTestDraft(record, DEFAULT_TEXT_CONFIG_TEST_DRAFT);
  presets[DEFAULT_TEXT_CONFIG_TEST_PRESET_ID] = draft;
  return {
    selectedPresetId: DEFAULT_TEXT_CONFIG_TEST_PRESET_ID,
    draft: cloneTextConfigTestDraft(draft),
    presets,
  };
}

export function readTextConfigTestDraftState(): TextConfigTestDraftState {
  if (typeof window === "undefined") {
    return normalizeTextConfigTestDraftState(null);
  }
  try {
    return normalizeTextConfigTestDraftState(JSON.parse(window.localStorage.getItem(TEXT_CONFIG_TEST_STORAGE_KEY) || "null"));
  } catch {
    return normalizeTextConfigTestDraftState(null);
  }
}

export function readTextConfigTestDraft(): TextConfigTestDraft {
  return readTextConfigTestDraftState().draft;
}

export function writeTextConfigTestDraftState(state: TextConfigTestDraftState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const normalized = normalizeTextConfigTestDraftState(state);
    window.localStorage.setItem(
      TEXT_CONFIG_TEST_STORAGE_KEY,
      JSON.stringify({
        selectedPresetId: normalized.selectedPresetId,
        presets: normalized.presets,
      }),
    );
  } catch {
    // Local storage may be unavailable in private or restricted browser contexts.
  }
}

export function writeTextConfigTestDraft(draft: TextConfigTestDraft): void {
  const current = readTextConfigTestDraftState();
  const normalizedDraft = normalizeTextConfigTestDraft(draft, current.presets[current.selectedPresetId]);
  writeTextConfigTestDraftState({
    selectedPresetId: current.selectedPresetId,
    draft: normalizedDraft,
    presets: {
      ...current.presets,
      [current.selectedPresetId]: normalizedDraft,
    },
  });
}

function isDefaultImageConfigTestPrompt(prompt: string): boolean {
  return [LEGACY_DEFAULT_IMAGE_CONFIG_TEST_DRAFT, PREVIOUS_DEFAULT_IMAGE_CONFIG_TEST_DRAFT].some(
    (draft) => prompt === draft.prompt,
  );
}

export function normalizeImageConfigTestDraft(
  value: unknown,
  fallback: ImageConfigTestDraft = DEFAULT_IMAGE_CONFIG_TEST_DRAFT,
): ImageConfigTestDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneImageConfigTestDraft(fallback);
  }
  const record = value as Record<string, unknown>;
  const size =
    typeof record.size === "string" && record.size.trim()
      ? record.size.trim()
      : fallback.size;
  const prompt =
    typeof record.prompt === "string"
      ? isDefaultImageConfigTestPrompt(record.prompt)
        ? fallback.prompt
        : record.prompt
      : fallback.prompt;
  return { size, prompt };
}

export function normalizeImageConfigTestDraftState(value: unknown): ImageConfigTestDraftState {
  const presets = defaultImageConfigTestPresetDrafts();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      selectedPresetId: DEFAULT_IMAGE_CONFIG_TEST_PRESET_ID,
      draft: cloneImageConfigTestDraft(DEFAULT_IMAGE_CONFIG_TEST_DRAFT),
      presets,
    };
  }
  const record = value as Record<string, unknown>;
  const rawPresets = record.presets;
  if (rawPresets && typeof rawPresets === "object" && !Array.isArray(rawPresets)) {
    const rawPresetRecord = rawPresets as Record<string, unknown>;
    for (const preset of DEFAULT_IMAGE_CONFIG_TEST_PRESETS) {
      presets[preset.id] = normalizeImageConfigTestDraft(rawPresetRecord[preset.id], preset.draft);
    }
    const selectedPresetId =
      typeof record.selectedPresetId === "string" && presets[record.selectedPresetId]
        ? record.selectedPresetId
        : DEFAULT_IMAGE_CONFIG_TEST_PRESET_ID;
    return {
      selectedPresetId,
      draft: cloneImageConfigTestDraft(presets[selectedPresetId]),
      presets,
    };
  }
  const draft = normalizeImageConfigTestDraft(record, DEFAULT_IMAGE_CONFIG_TEST_DRAFT);
  presets[DEFAULT_IMAGE_CONFIG_TEST_PRESET_ID] = draft;
  return {
    selectedPresetId: DEFAULT_IMAGE_CONFIG_TEST_PRESET_ID,
    draft: cloneImageConfigTestDraft(draft),
    presets,
  };
}

export function readImageConfigTestDraftState(): ImageConfigTestDraftState {
  if (typeof window === "undefined") {
    return normalizeImageConfigTestDraftState(null);
  }
  try {
    return normalizeImageConfigTestDraftState(JSON.parse(window.localStorage.getItem(IMAGE_CONFIG_TEST_STORAGE_KEY) || "null"));
  } catch {
    return normalizeImageConfigTestDraftState(null);
  }
}

export function readImageConfigTestDraft(): ImageConfigTestDraft {
  return readImageConfigTestDraftState().draft;
}

export function writeImageConfigTestDraftState(state: ImageConfigTestDraftState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const normalized = normalizeImageConfigTestDraftState(state);
    window.localStorage.setItem(
      IMAGE_CONFIG_TEST_STORAGE_KEY,
      JSON.stringify({
        selectedPresetId: normalized.selectedPresetId,
        presets: normalized.presets,
      }),
    );
  } catch {
    // Local storage may be unavailable in private or restricted browser contexts.
  }
}

export function writeImageConfigTestDraft(draft: ImageConfigTestDraft): void {
  const current = readImageConfigTestDraftState();
  const normalizedDraft = normalizeImageConfigTestDraft(draft, current.presets[current.selectedPresetId]);
  writeImageConfigTestDraftState({
    selectedPresetId: current.selectedPresetId,
    draft: normalizedDraft,
    presets: {
      ...current.presets,
      [current.selectedPresetId]: normalizedDraft,
    },
  });
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
