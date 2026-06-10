import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  type Locale,
  type TranslationKey,
  type TranslationParams,
  resolveLocale,
  translate,
} from "./i18n";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
  applyThemeToRoot,
  resolveTheme,
  resolveThemePreference,
} from "./theme";
import {
  DEFAULT_WORKSPACE_APPEARANCE,
  WORKSPACE_APPEARANCE_STORAGE_KEY,
  type WorkspaceAppearance,
  applyWorkspaceAppearanceToRoot,
  resolveWorkspaceAppearance,
} from "./workspaceAppearance";

export type TranslateFunction = ((key: TranslationKey, params?: TranslationParams) => string) & { locale?: Locale };

interface PreferencesContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFunction;
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
  resolvedTheme: ResolvedTheme;
  workspaceAppearance: WorkspaceAppearance;
  setWorkspaceAppearance: (appearance: WorkspaceAppearance) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readStorage(key: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(key);
}

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocale(readStorage(LOCALE_STORAGE_KEY)));
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(() =>
    resolveThemePreference(readStorage(THEME_STORAGE_KEY)),
  );
  const [workspaceAppearance, setWorkspaceAppearanceState] = useState<WorkspaceAppearance>(() =>
    resolveWorkspaceAppearance(readStorage(WORKSPACE_APPEARANCE_STORAGE_KEY)),
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemPrefersDark(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  const resolvedTheme = resolveTheme(themePreference, systemPrefersDark);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    applyThemeToRoot(document.documentElement, resolvedTheme, themePreference);
    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    applyWorkspaceAppearanceToRoot(document.documentElement, workspaceAppearance);
    window.localStorage.setItem(WORKSPACE_APPEARANCE_STORAGE_KEY, workspaceAppearance);
  }, [workspaceAppearance]);

  const value = useMemo<PreferencesContextValue>(
    () => {
      const t: TranslateFunction = (key, params) => translate(locale, key, params);
      t.locale = locale;
      return {
        locale,
        setLocale: (nextLocale) => setLocaleState(resolveLocale(nextLocale)),
        t,
        themePreference,
        setThemePreference: (nextTheme) => setThemePreferenceState(resolveThemePreference(nextTheme)),
        resolvedTheme,
        workspaceAppearance,
        setWorkspaceAppearance: (nextAppearance) => setWorkspaceAppearanceState(resolveWorkspaceAppearance(nextAppearance)),
      };
    },
    [locale, resolvedTheme, themePreference, workspaceAppearance],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) {
    const t: TranslateFunction = (key, params) => translate(DEFAULT_LOCALE, key, params);
    t.locale = DEFAULT_LOCALE;
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => undefined,
      t,
      themePreference: DEFAULT_THEME_PREFERENCE,
      setThemePreference: () => undefined,
      resolvedTheme: resolveTheme(DEFAULT_THEME_PREFERENCE, false),
      workspaceAppearance: DEFAULT_WORKSPACE_APPEARANCE,
      setWorkspaceAppearance: () => undefined,
    };
  }
  return context;
}

export function useI18n() {
  const { locale, setLocale, t } = usePreferences();
  return { locale, setLocale, t };
}
