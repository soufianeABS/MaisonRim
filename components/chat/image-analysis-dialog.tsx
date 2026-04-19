"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCopy, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function toPrettyLabel(key: string) {
  const s = String(key || "").trim();
  if (!s) return "";
  return s
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function asStringValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function ImageAnalysisDialog({
  open,
  title,
  loading,
  error,
  data,
  onClose,
}: {
  open: boolean;
  title: string;
  loading: boolean;
  error: string | null;
  data: unknown;
  onClose: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setCopiedKey(null);
  }, [open]);

  const entries = useMemo(() => {
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data)) return [["Result", JSON.stringify(data, null, 2)] as const];
    return Object.entries(data as Record<string, unknown>);
  }, [data]);

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      // ignore
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {loading ? "Extracting…" : error ? "Failed" : "Done"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={onClose}
            aria-label="Close"
            disabled={loading}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Working…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data returned.</p>
          ) : (
            <div className="space-y-2">
              {entries.map(([key, raw]) => {
                const value = asStringValue(raw);
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-lg border border-border/70 bg-muted/20 p-3",
                      value ? "" : "opacity-75",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">
                          {toPrettyLabel(key)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                          {value || "—"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        title="Copy"
                        aria-label={`Copy ${key}`}
                        onClick={() => void copyValue(key, value)}
                        disabled={!value}
                      >
                        {copiedKey === key ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <ClipboardCopy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

