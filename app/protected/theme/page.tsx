"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Palette, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hexToHslTriplet, hslTripletToHex } from "@/lib/color-convert";
import { readResponseJson } from "@/lib/read-response-json";
import {
  DEFAULT_DARK_COLORS,
  DEFAULT_LIGHT_COLORS,
  THEME_COLOR_KEYS,
  mergeThemeColors,
  type ThemeColorKey,
  type ThemeColorMap,
} from "@/lib/theme-color-defaults";

const GENERAL_THEME_KEYS = THEME_COLOR_KEYS.filter(
  (k): k is ThemeColorKey => !k.startsWith("chat-"),
);
const CHAT_THEME_KEYS = THEME_COLOR_KEYS.filter(
  (k): k is ThemeColorKey => k.startsWith("chat-"),
);

const THEME_KEY_LABELS: Record<string, string> = {
  "chat-you": "“You” label (sidebar)",
  "chat-menu": "Menu bar background",
  "chat-menu-hover": "Menu bar buttons (hover)",
  "chat-menu-fg": "Menu bar text & icons",
  "chat-bubble-sent": "Your message bubble",
  "chat-bubble-sent-fg": "Your message text",
  "chat-bubble-sent-ring": "Your bubble ring",
  "chat-bubble-received": "Their message bubble",
  "chat-bubble-received-fg": "Their message text",
  "chat-ticks-sent": "Delivered ✓✓ (sent)",
  "chat-ticks-read": "Seen ✓✓ (read)",
};

function labelForKey(key: string): string {
  if (THEME_KEY_LABELS[key]) return THEME_KEY_LABELS[key];
  return key
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function ColorRow({
  token,
  value,
  onChange,
}: {
  token: string;
  value: string;
  onChange: (triplet: string) => void;
}) {
  const hex = value ? hslTripletToHex(value) : "#808080";
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <Label htmlFor={`color-${token}`} className="shrink-0 text-sm font-normal sm:min-w-[140px]">
        {labelForKey(token)}
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={`color-${token}`}
          type="color"
          value={hex}
          onChange={(e) => onChange(hexToHslTriplet(e.target.value))}
          className="h-9 w-14 cursor-pointer rounded border border-input bg-background p-0.5"
          title={value}
        />
        <span className="font-mono text-[11px] text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}

export default function ThemeToolPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [light, setLight] = useState<ThemeColorMap>(DEFAULT_LIGHT_COLORS);
  const [dark, setDark] = useState<ThemeColorMap>(DEFAULT_DARK_COLORS);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/theme/preferences", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await readResponseJson<{
        theme_custom_colors?: { light?: ThemeColorMap; dark?: ThemeColorMap } | null;
        warning?: string;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to load");
      if (data.warning) setWarning(data.warning);
      const tc = data.theme_custom_colors;
      setLight(mergeThemeColors(DEFAULT_LIGHT_COLORS, tc?.light));
      setDark(mergeThemeColors(DEFAULT_DARK_COLORS, tc?.dark));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setLight(DEFAULT_LIGHT_COLORS);
      setDark(DEFAULT_DARK_COLORS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/theme/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ light, dark }),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to save");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("wachat-theme-colors-updated"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/theme/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to reset");
      setLight(DEFAULT_LIGHT_COLORS);
      setDark(DEFAULT_DARK_COLORS);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("wachat-theme-colors-updated"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset");
    } finally {
      setResetting(false);
    }
  };

  const renderTab = (
    tabId: string,
    map: ThemeColorMap,
    setMap: Dispatch<SetStateAction<ThemeColorMap>>,
  ) => (
    <div className="grid max-h-[min(70vh,560px)] gap-3 overflow-y-auto pr-1">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">General UI</h3>
        <div className="grid gap-3">
          {GENERAL_THEME_KEYS.map((key) => (
            <ColorRow
              key={`${tabId}-${key}`}
              token={key}
              value={map[key] ?? ""}
              onChange={(triplet) => {
                setMap((prev) => ({ ...prev, [key]: triplet }));
              }}
            />
          ))}
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">Chat &amp; messages</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          “You” preview, green menu bar, your/their bubbles and text, delivered and seen ticks.
        </p>
        <div className="grid gap-3">
          {CHAT_THEME_KEYS.map((key) => (
            <ColorRow
              key={`${tabId}-${key}`}
              token={key}
              value={map[key] ?? ""}
              onChange={(triplet) => {
                setMap((prev) => ({ ...prev, [key]: triplet }));
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-col gap-6 p-4 md:p-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/protected" aria-label="Back to chat">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Palette className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight">Theme & colors</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>App colors</CardTitle>
          <CardDescription>
            Adjust design tokens (background, text, borders) and WhatsApp-specific accents: sidebar
            menu, “You” preview, message bubbles, text in bubbles, and seen/delivered ticks. Light and
            dark are separate. Save to apply; Reset restores built-in defaults.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : (
            <>
              {warning && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
                  {warning}
                </p>
              )}
              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Tabs defaultValue="light" className="w-full">
                <TabsList className="grid w-full max-w-md grid-cols-2">
                  <TabsTrigger value="light">Light mode</TabsTrigger>
                  <TabsTrigger value="dark">Dark mode</TabsTrigger>
                </TabsList>
                <TabsContent value="light" className="mt-4">
                  {renderTab("light", light, setLight)}
                </TabsContent>
                <TabsContent value="dark" className="mt-4">
                  {renderTab("dark", dark, setDark)}
                </TabsContent>
              </Tabs>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void resetToDefaults()}
                  disabled={resetting}
                >
                  {resetting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resetting…
                    </>
                  ) : (
                    <>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Reset to defaults
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
