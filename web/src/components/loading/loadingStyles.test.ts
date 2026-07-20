/// <reference types="node" />

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("loading skeleton styles", () => {
  it("delays shimmer without delaying geometry", () => {
    expect(css).toContain("animation: pf-skeleton-shimmer 1.8s ease-in-out 150ms infinite");
    expect(css).toContain("background-color: color-mix(in srgb, var(--pf-panel-soft)");
  });

  it("disables shimmer for reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.pf-skeleton::after[\s\S]*animation: none/);
  });

  it("styles shared error and paused surfaces with theme tokens", () => {
    expect(css).toMatch(/\.pf-async-error\s*\{[\s\S]*?var\(--pf-danger\)[\s\S]*?\}/);
    expect(css).toMatch(/\.pf-async-paused\s*\{[\s\S]*?var\(--pf-accent-2\)[\s\S]*?\}/);
  });
});
