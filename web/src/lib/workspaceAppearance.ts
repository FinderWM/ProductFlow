import type { TranslationKey } from "./i18n";
import type { ThemePreference } from "./theme";

export const WORKSPACE_APPEARANCES = ["mist", "sage", "dusk"] as const;
export type WorkspaceAppearance = (typeof WORKSPACE_APPEARANCES)[number];

export const DEFAULT_WORKSPACE_APPEARANCE: WorkspaceAppearance = "mist";
export const WORKSPACE_APPEARANCE_STORAGE_KEY = "inspiration-one.workspace-appearance";

export interface WorkspaceAppearanceMeta {
  id: WorkspaceAppearance;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  resolvedTheme: Extract<ThemePreference, "light" | "dark">;
  swatch: string;
}

export const WORKSPACE_APPEARANCE_METADATA: readonly WorkspaceAppearanceMeta[] = [
  {
    id: "mist",
    labelKey: "workspaceAppearance.mist.label",
    descriptionKey: "workspaceAppearance.mist.description",
    resolvedTheme: "light",
    swatch: "#f5f8fb",
  },
  {
    id: "sage",
    labelKey: "workspaceAppearance.sage.label",
    descriptionKey: "workspaceAppearance.sage.description",
    resolvedTheme: "light",
    swatch: "#e4f0dd",
  },
  {
    id: "dusk",
    labelKey: "workspaceAppearance.dusk.label",
    descriptionKey: "workspaceAppearance.dusk.description",
    resolvedTheme: "dark",
    swatch: "#20231b",
  },
];

const WORKSPACE_APPEARANCE_SET: ReadonlySet<string> = new Set(WORKSPACE_APPEARANCES);

export function isWorkspaceAppearance(value: string | null | undefined): value is WorkspaceAppearance {
  return typeof value === "string" && WORKSPACE_APPEARANCE_SET.has(value);
}

export function resolveWorkspaceAppearance(value: string | null | undefined): WorkspaceAppearance {
  return isWorkspaceAppearance(value) ? value : DEFAULT_WORKSPACE_APPEARANCE;
}

export function workspaceAppearanceResolvedTheme(
  appearance: WorkspaceAppearance,
): Extract<ThemePreference, "light" | "dark"> {
  return WORKSPACE_APPEARANCE_METADATA.find((item) => item.id === appearance)?.resolvedTheme ?? "light";
}

export function applyWorkspaceAppearanceToRoot(root: HTMLElement, appearance: WorkspaceAppearance): void {
  root.dataset.workspaceAppearance = resolveWorkspaceAppearance(appearance);
}
