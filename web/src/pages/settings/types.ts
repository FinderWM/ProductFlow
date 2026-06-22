// SettingsPage 内部共享的轻量类型，抽到 settings/ 下供页面与各子模块共用，避免子模块反向依赖 SettingsPage 造成循环。

import type { GenerationConfig, ProviderProfile } from "../../lib/types";

export type DraftValue = string | boolean | string[];

export type TextProviderKind = "mock" | "openai" | "openai_chat_completions";
export type ImageProviderKind =
  | "mock"
  | "openai_responses"
  | "openai_images"
  | "openai_chat_image"
  | "google_gemini_image";
export type TextStructuredOutputMode = "json_schema" | "json_object";
export type ProviderModelKind = TextProviderKind | ImageProviderKind;
export type GenerationConfigProviderKind = TextProviderKind | ImageProviderKind;

export interface PendingProviderDisable {
  profile: ProviderProfile;
  generationConfigs: GenerationConfig[];
}
