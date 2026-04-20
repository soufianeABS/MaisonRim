"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Globe, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TRANSLATION_LANGUAGES } from "@/lib/translation-languages";
import { readResponseJson } from "@/lib/read-response-json";

export default function TranslationToolPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [value, setValue] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setWarning(null);
    try {
      const res = await fetch("/api/translation/preferences", {
        credentials: "include",
        cache: "no-store",
      });
      const data = await readResponseJson<{
        translation_target_language?: string | null;
        warning?: string;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to load preferences");
      if (data.warning) setWarning(data.warning);
      setValue(data.translation_target_language || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setValue("");
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
      const res = await fetch("/api/translation/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translation_target_language: value || null,
        }),
      });
      const data = await readResponseJson<{
        translation_target_language?: string | null;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setValue(data.translation_target_language || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/protected" aria-label="Back to chat">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Globe className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
          <h1 className="text-xl font-semibold tracking-tight">Translation</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gemini translate language</CardTitle>
          <CardDescription>
            Choose the language messages should be translated into when you use
            translate in a conversation. Translations are generated with Gemini and
            saved per message so you do not have to translate the same text again.
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
              <div className="space-y-2">
                <Label htmlFor="translation-lang">Target language</Label>
                <select
                  id="translation-lang"
                  value={value}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setValue(e.target.value)}
                  className={cn(
                    "themed-native-select flex h-9 w-full max-w-md rounded-md border border-input px-3 py-1 text-sm shadow-sm",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                >
                  <option value="">None (disable translate)</option>
                  {TRANSLATION_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  In any chat, use the translate button next to a text bubble to show
                  the translation under the original message.
                </p>
              </div>
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
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
