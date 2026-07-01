export function cssLengthToPixels(value: string, rootFontSize: number): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  if (trimmed.endsWith("rem")) {
    return (Number.parseFloat(trimmed) || 0) * rootFontSize;
  }
  return Number.parseFloat(trimmed) || 0;
}
