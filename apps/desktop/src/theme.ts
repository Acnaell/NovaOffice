// Tema claro/escuro. "system" segue o sistema operacional pela media query do
// CSS; "light" e "dark" fixam o tema com `data-theme` na raiz.

import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load, store } from "./storage";

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const STORAGE_KEY = "nova.theme";

export function parseThemeMode(value: string | null): ThemeMode {
  return THEME_MODES.find((m) => m === value) ?? "system";
}

export function useTheme(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>(() => parseThemeMode(load(STORAGE_KEY)));

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "system") delete root.dataset.theme;
    else root.dataset.theme = mode;
    // A barra de título nativa acompanha o tema (null = seguir o sistema).
    getCurrentWindow()
      .setTheme(mode === "system" ? null : mode)
      .catch(() => {});
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    store(STORAGE_KEY, next);
  }, []);

  return [mode, setMode];
}
