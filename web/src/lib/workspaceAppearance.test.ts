import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_APPEARANCE,
  WORKSPACE_APPEARANCE_METADATA,
  applyWorkspaceAppearanceToRoot,
  resolveWorkspaceAppearance,
  workspaceAppearanceResolvedTheme,
} from "./workspaceAppearance";

describe("workspace appearance helpers", () => {
  it("resolves supported appearances and falls back to mist", () => {
    expect(resolveWorkspaceAppearance("mist")).toBe("mist");
    expect(resolveWorkspaceAppearance("sage")).toBe("sage");
    expect(resolveWorkspaceAppearance("dusk")).toBe("dusk");
    expect(resolveWorkspaceAppearance("sepia")).toBe(DEFAULT_WORKSPACE_APPEARANCE);
    expect(resolveWorkspaceAppearance(null)).toBe(DEFAULT_WORKSPACE_APPEARANCE);
  });

  it("keeps dusk as a dark reading theme and light presets distinct", () => {
    expect(workspaceAppearanceResolvedTheme("mist")).toBe("light");
    expect(workspaceAppearanceResolvedTheme("sage")).toBe("light");
    expect(workspaceAppearanceResolvedTheme("dusk")).toBe("dark");
    expect(new Set(WORKSPACE_APPEARANCE_METADATA.map((item) => item.swatch)).size).toBe(3);
  });

  it("writes the root appearance attribute", () => {
    const root = { dataset: {} } as HTMLElement;
    applyWorkspaceAppearanceToRoot(root, "sage");
    expect(root.dataset.workspaceAppearance).toBe("sage");
  });
});
