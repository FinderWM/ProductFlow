import { describe, expect, it } from "vitest";

import { contextDocumentFileForSubmit } from "./ProductCreatePage";

describe("contextDocumentFileForSubmit", () => {
  it("submits the original selected document file without rewriting preview text", () => {
    const original = new File(["old"], "brief.md", { type: "text/markdown", lastModified: 123 });

    const nextFile = contextDocumentFileForSubmit(original);

    expect(nextFile).toBe(original);
  });

  it("omits the context document when no document is selected", () => {
    expect(contextDocumentFileForSubmit(null)).toBeUndefined();
  });
});
