import type { Ref } from "react";

export type InputFieldSize = "compact" | "default" | "tall";
export type InputTextareaVariant = "default" | "prompt";
export type InputOptionToggleLayout = "pill" | "card";
export type InputCheckboxVariant = "inline" | "card";
export type InputCheckboxSize = "sm" | "md";

export type InputRef<T> = Ref<T> | undefined;

export function inputClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function assignInputRef<T>(ref: InputRef<T>, value: T | null) {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  (ref as { current: T | null }).current = value;
}

export function parseInputPixelValue(value: string, fallback: number) {
  const next = Number.parseFloat(value);
  return Number.isFinite(next) ? next : fallback;
}

export function resizeTextareaToFit(textarea: HTMLTextAreaElement, minRows: number, maxRows?: number) {
  textarea.style.height = "auto";
  const computedStyle = window.getComputedStyle(textarea);
  const lineHeight = parseInputPixelValue(computedStyle.lineHeight, 24);
  const verticalPadding =
    parseInputPixelValue(computedStyle.paddingTop, 0) + parseInputPixelValue(computedStyle.paddingBottom, 0);
  const minHeight = minRows * lineHeight + verticalPadding;
  const maxHeight = maxRows === undefined ? Number.POSITIVE_INFINITY : maxRows * lineHeight + verticalPadding;
  const nextHeight = Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight));
  textarea.style.height = `${nextHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}
