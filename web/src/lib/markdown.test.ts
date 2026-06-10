import { describe, expect, it } from "vitest";

import {
  isMermaidCodeLanguage,
  markdownCodeLanguage,
  markdownHasVisibleContent,
  markdownImageResourceUrl,
} from "./markdown";

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

  it("detects safe markdown image resource URLs", () => {
    expect(markdownImageResourceUrl(" https://example.com/a.png?x=1 ")).toBe("https://example.com/a.png?x=1");
    expect(markdownImageResourceUrl("/api/posters/poster-1/download?variant=preview")).toBe(
      "/api/posters/poster-1/download?variant=preview",
    );
    expect(markdownImageResourceUrl("/api/resource-library/assets/asset-1/download")).toBe(
      "/api/resource-library/assets/asset-1/download",
    );
    expect(markdownImageResourceUrl("data:image/png;base64,aGVsbG8=")).toBe("data:image/png;base64,aGVsbG8=");
    expect(markdownImageResourceUrl("javascript:alert(1).png")).toBeNull();
    expect(markdownImageResourceUrl("https://example.com/page")).toBeNull();
  });
});
