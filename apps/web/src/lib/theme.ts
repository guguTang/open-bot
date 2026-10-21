import { useSyncExternalStore } from "react";

/** 外观偏好：跟随系统 / 浅色 / 深色。持久化在 localStorage，作用于 <html> 的 data-theme 与 .dark。 */
export type ThemePreference = "system" | "light" | "dark";

const KEY = "open-bot.theme";
const listeners = new Set<() => void>();

function media(): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
}

export function getThemePreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePreference = getThemePreference()): "light" | "dark" {
  if (pref !== "system") return pref;
  return media()?.matches ? "dark" : "light";
}

export function applyTheme(): void {
  if (typeof document === "undefined") return;
  const mode = resolveTheme();
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.classList.toggle("dark", mode === "dark");
  root.classList.toggle("light", mode === "light");
  root.style.colorScheme = mode;
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* 隐私模式等：只在本次会话生效 */
  }
  applyTheme();
  for (const l of listeners) l();
}

/** 启动时调用一次：应用主题并跟随系统切换。 */
export function initTheme(): void {
  applyTheme();
  media()?.addEventListener?.("change", () => {
    if (getThemePreference() === "system") {
      applyTheme();
      for (const l of listeners) l();
    }
  });
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getThemePreference,
    () => "system",
  );
}
