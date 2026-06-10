import type { TranslationKey } from "./i18n";
import type { UserUiPreferencesUpdateRequest } from "./types";

export const UI_LAYOUT_SCHEMES = ["classic", "workspace"] as const;
export type UiLayoutScheme = (typeof UI_LAYOUT_SCHEMES)[number];
export const DEFAULT_UI_LAYOUT_SCHEME: UiLayoutScheme = "classic";

export interface UiLayoutSchemeMeta {
  id: UiLayoutScheme;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  supported: boolean;
}

export const UI_LAYOUT_SCHEME_METADATA: readonly UiLayoutSchemeMeta[] = [
  {
    id: "classic",
    labelKey: "layout.scheme.classic.label",
    descriptionKey: "layout.scheme.classic.description",
    supported: true,
  },
  {
    id: "workspace",
    labelKey: "layout.scheme.workspace.label",
    descriptionKey: "layout.scheme.workspace.description",
    supported: true,
  },
];

const UI_LAYOUT_SCHEME_SET: ReadonlySet<string> = new Set(UI_LAYOUT_SCHEMES);

export interface UiLayoutSchemePreferenceLike {
  ui_layout_scheme?: string | null;
}

export function isUiLayoutScheme(value: string | null | undefined): value is UiLayoutScheme {
  return typeof value === "string" && UI_LAYOUT_SCHEME_SET.has(value);
}

export function resolveUiLayoutScheme(value: string | null | undefined): UiLayoutScheme {
  return isUiLayoutScheme(value) ? value : DEFAULT_UI_LAYOUT_SCHEME;
}

export function resolveUiLayoutSchemePreference(
  preferences: UiLayoutSchemePreferenceLike | null | undefined,
): UiLayoutScheme {
  return resolveUiLayoutScheme(preferences?.ui_layout_scheme);
}

export function uiLayoutSchemePreferenceUpdate(scheme: UiLayoutScheme): UserUiPreferencesUpdateRequest {
  return { ui_layout_scheme: scheme };
}
