// 文案入口（F2）：语言文案已拆到 ./i18n/{zh,en,ja}.ts；此处编排 locale 类型、translations 与工具函数，对外契约不变。
export const LOCALES = ["zh-CN", "en-US", "ja-JP"] as const;

export type Locale = (typeof LOCALES)[number];
export type TranslationParams = Record<string, string | number>;

export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "inspiration-one.locale";

import { zhCN } from "./i18n/zh";
import { enUS } from "./i18n/en";
import { jaJP } from "./i18n/ja";

export { zhCN, enUS, jaJP };

export const translations = {
  "zh-CN": zhCN,
  "en-US": enUS,
  "ja-JP": jaJP,
} satisfies Record<Locale, Record<keyof typeof zhCN, string>>;

export type TranslationKey = keyof typeof zhCN;

export function isLocale(value: string | null | undefined): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function resolveLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function interpolate(template: string, params: TranslationParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export function translate(locale: Locale, key: TranslationKey, params?: TranslationParams): string {
  return interpolate(translations[locale][key] ?? translations[DEFAULT_LOCALE][key], params);
}
