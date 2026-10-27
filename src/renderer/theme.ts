import { useEffect } from "react";

export type ThemePreference = "light" | "dark" | "system";
export const THEME_STORAGE_KEY = "callme-theme";

const valid = (value: unknown): value is ThemePreference => value === "light" || value === "dark" || value === "system";
export const resolveTheme = (theme: ThemePreference) => theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "system" ? "light" : theme;

export function applyTheme(theme: ThemePreference, persist = false) {
  const preference = valid(theme) ? theme : "system";
  document.documentElement.dataset.theme = resolveTheme(preference);
  document.documentElement.dataset.themePreference = preference;
  if (persist) { try { localStorage.setItem(THEME_STORAGE_KEY, preference); } catch {} }
}

export function cachedTheme(): ThemePreference {
  try { const value = localStorage.getItem(THEME_STORAGE_KEY); return valid(value) ? value : "system"; }
  catch { return "system"; }
}

export function useTheme(theme: ThemePreference) {
  useEffect(() => {
    applyTheme(theme, true);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => { if (document.documentElement.dataset.themePreference === "system") applyTheme("system"); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
}
