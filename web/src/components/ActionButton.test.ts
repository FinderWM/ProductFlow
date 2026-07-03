import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActionButton,
  actionButtonClassName,
  actionSurfaceClassName,
  actionButtonToneStyle,
  type ActionButtonToneVars,
} from "./ActionButton";

describe("ActionButton helpers", () => {
  it("builds class names from preset, size and width", () => {
    expect(
      actionButtonClassName({
        preset: "danger",
        size: "icon-sm",
        fullWidth: true,
        className: "extra-class",
      }),
    ).toBe("pf-action-button pf-action-button--danger pf-action-button--icon-sm w-full extra-class");
  });

  it("merges tone vars with inline styles", () => {
    const toneVars: ActionButtonToneVars = {
      "--pf-action-bg": "linear-gradient(red, blue)",
      "--pf-action-text": "#fff",
    };

    expect(
      actionButtonToneStyle(toneVars, {
        opacity: 0.8,
      }),
    ).toMatchObject({
      "--pf-action-bg": "linear-gradient(red, blue)",
      "--pf-action-text": "#fff",
      opacity: 0.8,
    });
  });

  it("builds shared surface class names for non-button interactions", () => {
    expect(
      actionSurfaceClassName({
        preset: "secondary",
        focusWithin: true,
        className: "pf-action-surface--dashed extra-class",
      }),
    ).toBe("pf-action-surface pf-action-surface--secondary pf-action-surface-focus pf-action-surface--dashed extra-class");
  });

  it("disables the rendered button while loading", () => {
    const element = createElement(ActionButton, {
      children: "Create",
      loading: true,
      preset: "primary",
      type: "submit",
    });

    expect(isValidElement(element)).toBe(true);
    if (!isValidElement<{ type?: string; disabled?: boolean; className?: string }>(element)) {
      throw new Error("Expected ActionButton to render a valid React element");
    }

    const markup = renderToStaticMarkup(element);

    expect(markup).toContain('type="submit"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("pf-action-button--primary");
  });
});
