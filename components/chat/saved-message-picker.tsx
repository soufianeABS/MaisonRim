"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, X } from "lucide-react";
import Link from "next/link";

import { readResponseJson } from "@/lib/read-response-json";

export type SavedChatMessageRow = {
  id: string;
  title: string;
  body: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

interface SavedMessagePickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Inserts text into the composer (does not send). */
  onInsert: (text: string) => void;
}

export function SavedMessagePicker({
  isOpen,
  onClose,
  onInsert,
}: SavedMessagePickerProps) {
  const [rows, setRows] = useState<SavedChatMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/saved-messages", {
          credentials: "include",
        });
        const data = await readResponseJson<{
          messages?: unknown;
          error?: string;
        }>(res);
        if (!res.ok) {
          throw new Error(data.error || "Failed to load");
        }
        if (!cancelled) {
          setRows(Array.isArray(data.messages) ? data.messages : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q),
    );
  }, [rows, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[min(560px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">Saved messages</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="border-b border-border px-4 py-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-9"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="px-2 py-6 text-center text-sm text-destructive">{error}</p>
          ) : filtered.length === 0 ? (
            <div className="space-y-3 px-3 py-8 text-center text-sm text-muted-foreground">
              <p>No saved messages yet.</p>
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href="/protected/saved-messages" onClick={onClose}>
                  Create saved messages
                </Link>
              </Button>
            </div>
          ) : (
            <ul className="space-y-1">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onInsert(r.body);
                      onClose();
                    }}
                    className="w-full rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-emerald-500/30 hover:bg-muted/80"
                  >
                    <div className="font-medium text-foreground">{r.title}</div>
                    <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {r.body}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
          <Link
            href="/protected/saved-messages"
            className="text-emerald-600 hover:underline dark:text-emerald-400"
            onClick={onClose}
          >
            Manage saved messages
          </Link>
        </div>
      </div>
    </div>
  );
}
