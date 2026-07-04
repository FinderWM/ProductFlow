import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../lib/uiLayoutSchemePreference");
});

async function loadWorkspaceInputs(activeScheme: "classic" | "workspace") {
  vi.resetModules();
  vi.doMock("../lib/uiLayoutSchemePreference", () => ({
    useUiLayoutScheme: () => ({ activeScheme }),
  }));
  return import("./workspaceInputs");
}

describe("workspace input adapters", () => {
  it("renders classic text input chrome outside workspace scheme", async () => {
    const { WorkspaceTextInput } = await loadWorkspaceInputs("classic");
    const html = renderToStaticMarkup(
      createElement(WorkspaceTextInput, {
        value: "",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("input-premium");
    expect(html).not.toContain("pf-workspace-field");
  });

  it("renders workspace text input chrome when workspace scheme is active", async () => {
    const { WorkspaceTextInput } = await loadWorkspaceInputs("workspace");
    const html = renderToStaticMarkup(
      createElement(WorkspaceTextInput, {
        value: "",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("pf-workspace-field");
    expect(html).not.toContain("input-premium");
  });

  it("renders classic textarea chrome outside workspace scheme", async () => {
    const { WorkspaceTextarea } = await loadWorkspaceInputs("classic");
    const html = renderToStaticMarkup(
      createElement(WorkspaceTextarea, {
        value: "",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("textarea-premium");
    expect(html).not.toContain("pf-workspace-textarea");
  });

  it("renders workspace textarea chrome when workspace scheme is active", async () => {
    const { WorkspaceTextarea } = await loadWorkspaceInputs("workspace");
    const html = renderToStaticMarkup(
      createElement(WorkspaceTextarea, {
        value: "",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain("pf-workspace-field");
    expect(html).toContain("pf-workspace-textarea");
    expect(html).not.toContain("textarea-premium");
  });

  it("routes option toggle visuals through classic or workspace layers", async () => {
    const { WorkspaceOptionToggle: ClassicSchemeToggle } = await loadWorkspaceInputs("classic");
    const classicHtml = renderToStaticMarkup(
      createElement(ClassicSchemeToggle, {
        checked: true,
        onChange: () => undefined,
        children: "Classic option",
      }),
    );

    const { WorkspaceOptionToggle: WorkspaceSchemeToggle } = await loadWorkspaceInputs("workspace");
    const workspaceHtml = renderToStaticMarkup(
      createElement(WorkspaceSchemeToggle, {
        checked: true,
        onChange: () => undefined,
        children: "Workspace option",
      }),
    );

    expect(classicHtml).toContain("pf-settings-option-toggle");
    expect(classicHtml).not.toContain("pf-workspace-input-scope");
    expect(workspaceHtml).toContain("pf-settings-option-toggle");
    expect(workspaceHtml).toContain("pf-workspace-input-scope");
  });
});
