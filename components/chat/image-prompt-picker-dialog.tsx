"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Image as ImageIcon, Loader2, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ImagePrompt } from "@/lib/image-prompts";
import { cn } from "@/lib/utils";

export function ImagePromptPickerDialog({
  open,
  onClose,
  onPick,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (prompt: ImagePrompt) => void;
  busy: boolean;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ImagePrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setFetchError(null);
    setLoading(true);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/image-prompts");
        const data = (await res.json()) as { error?: string; prompts?: ImagePrompt[] };
        if (!res.ok) {
          throw new Error(data.error || "Failed to load prompts");
        }
        if (!cancelled) {
          setItems(data.prompts ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : "Failed to load prompts");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((p) => {
      const hay = `${p.name}\n${p.prompt}`.toLowerCase();
      return hay.includes(term);
    });
  }, [items, q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose image prompt"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Analyze image</p>
              <p className="truncate text-xs text-muted-foreground">
                Choose a saved prompt
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-4 space-y-3">
          <Input
            placeholder="Search prompts…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={busy || loading}
          />

          {fetchError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {fetchError}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 && !fetchError ? (
            <div className="rounded-lg border border-border/70 bg-muted/20 p-4 text-sm">
              <p className="text-muted-foreground">
                No prompts found. Create one first.
              </p>
              <div className="mt-3">
                <Button asChild variant="outline" className="gap-2">
                  <Link href="/protected/image-prompts">
                    <ImageIcon className="h-4 w-4" />
                    Manage image prompts
                  </Link>
                </Button>
              </div>
            </div>
          ) : !fetchError ? (
            <ul className="max-h-[55vh] overflow-y-auto space-y-2">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onPick(p)}
                    className={cn(
                      "w-full text-left rounded-lg border border-border/70 bg-background p-3 transition-colors",
                      "hover:bg-muted/40 disabled:opacity-60 disabled:cursor-not-allowed",
                    )}
                  >
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                      {p.prompt}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
