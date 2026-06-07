export const INSPIRATION_CONTEXT_MARKDOWN_MAX_LENGTH = 50_000;

export function markdownCodeLanguage(className?: string): string | null {
  if (!className) {
    return null;
  }
  const languageClass = className
    .split(/\s+/)
    .map((item) => item.trim())
    .find((item) => item.startsWith("language-"));
  if (!languageClass) {
    return null;
  }
  const language = languageClass.slice("language-".length).trim().toLowerCase();
  return language || null;
}

export function isMermaidCodeLanguage(className?: string): boolean {
  return markdownCodeLanguage(className) === "mermaid";
}

export function markdownHasVisibleContent(value: string): boolean {
  return value.trim().length > 0;
}
