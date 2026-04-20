"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  DEFAULT_DARK_COLORS,
  DEFAULT_LIGHT_COLORS,
  THEME_COLOR_KEYS,
  mergeThemeColors,
  type ThemeColorMap,
} from "@/lib/theme-color-defaults";

function applyCssVars(merged: ThemeColorMap) {
  const root = document.documentElement;
  for (const key of THEME_COLOR_KEYS) {
    const v = merged[key];
    if (v) root.style.setProperty(`--${key}`, v);
  }
}

function clearCssVars() {
  const root = document.documentElement;
  for (const key of THEME_COLOR_KEYS) {
    root.style.removeProperty(`--${key}`);
  }
}

export function CustomThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [custom, setCustom] = useState<{
    light: ThemeColorMap;
    dark: ThemeColorMap;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/theme/preferences", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        theme_custom_colors?: { light?: ThemeColorMap; dark?: ThemeColorMap } | null;
      };
      const tc = data.theme_custom_colors;
      if (!tc || (Object.keys(tc.light ?? {}).length === 0 && Object.keys(tc.dark ?? {}).length === 0)) {
        setCustom(null);
        return;
      }
      setCustom({
        light: tc.light ?? {},
        dark: tc.dark ?? {},
      });
    } catch {
      setCustom(null);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    void load();
  }, [load]);

  useEffect(() => {
    const onUpdated = () => void load();
    window.addEventListener("wachat-theme-colors-updated", onUpdated);
    return () => window.removeEventListener("wachat-theme-colors-updated", onUpdated);
  }, [load]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!mounted || !resolvedTheme) return;
    if (!custom) {
      clearCssVars();
      return;
    }
    const def = resolvedTheme === "dark" ? DEFAULT_DARK_COLORS : DEFAULT_LIGHT_COLORS;
    const over = resolvedTheme === "dark" ? custom.dark : custom.light;
    const merged = mergeThemeColors(def, over);
    applyCssVars(merged);
  }, [mounted, resolvedTheme, custom]);

  return <>{children}</>;
}
