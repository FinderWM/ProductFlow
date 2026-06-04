import { describe, expect, it } from "vitest";

import { isMermaidCodeLanguage, markdownCodeLanguage, markdownHasVisibleContent } from "./markdown";

describe("markdown helpers", () => {
  it("extracts lowercase markdown code languages from class names", () => {
    expect(markdownCodeLanguage("language-mermaid")).toBe("mermaid");
    expect(markdownCodeLanguage("hljs language-TypeScript")).toBe("typescript");
    expect(markdownCodeLanguage("")).toBeNull();
    expect(markdownCodeLanguage("code-block")).toBeNull();
  });

  it("detects mermaid code fences", () => {
    expect(isMermaidCodeLanguage("language-mermaid")).toBe(true);
    expect(isMermaidCodeLanguage("hljs language-MERMAID")).toBe(true);
    expect(isMermaidCodeLanguage("language-graphviz")).toBe(false);
  });

  it("detects visible markdown content", () => {
    expect(markdownHasVisibleContent("# 标题")).toBe(true);
    expect(markdownHasVisibleContent("  \n\t ")).toBe(false);
  });
});
