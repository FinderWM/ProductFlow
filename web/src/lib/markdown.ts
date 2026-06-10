export const INSPIRATION_CONTEXT_MARKDOWN_MAX_LENGTH = 50_000;

const IMAGE_FILE_EXTENSION_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i;
const KNOWN_API_IMAGE_DOWNLOAD_PATTERN = /^\/api\/(?:source-assets|posters|image-session-assets)\/[^?#/]+\/download(?:[?#].*)?$/i;
const KNOWN_API_RESOURCE_LIBRARY_IMAGE_DOWNLOAD_PATTERN =
  /^\/api\/resource-library\/assets\/[^?#/]+\/download(?:[?#].*)?$/i;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

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

export function markdownImageResourceUrl(value: string | null | undefined): string | null {
  const url = value?.trim();
  if (!url) {
    return null;
  }
  if (IMAGE_DATA_URL_PATTERN.test(url) || url.toLowerCase().startsWith("blob:")) {
    return url;
  }
  if (
    KNOWN_API_IMAGE_DOWNLOAD_PATTERN.test(url) ||
    KNOWN_API_RESOURCE_LIBRARY_IMAGE_DOWNLOAD_PATTERN.test(url) ||
    IMAGE_FILE_EXTENSION_PATTERN.test(url)
  ) {
    return URL_SCHEME_PATTERN.test(url) && !/^https?:/i.test(url) ? null : url;
  }
  return null;
}
