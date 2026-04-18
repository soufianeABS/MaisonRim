"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { SavedChatMessageRow } from "@/components/chat/saved-message-picker";
import { readResponseJson } from "@/lib/read-response-json";

const emptyForm = { title: "", body: "", sort_order: "0" };

export default function SavedMessagesPage() {
  const [rows, setRows] = useState<SavedChatMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/saved-messages", { credentials: "include" });
      const data = await readResponseJson<{ messages?: unknown; error?: string }>(
        res,
      );
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setRows(Array.isArray(data.messages) ? data.messages : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const startEdit = (r: SavedChatMessageRow) => {
    setEditingId(r.id);
    setForm({
      title: r.title,
      body: r.body,
      sort_order: String(r.sort_order),
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = form.title.trim();
    const body = form.body.trim();
    const sort_order = parseInt(form.sort_order, 10);
    if (!title || !body) {
      setError("Title and message text are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        const res = await fetch(`/api/saved-messages/${editingId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body,
            sort_order: Number.isFinite(sort_order) ? sort_order : 0,
          }),
        });
        const data = await readResponseJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Failed to update");
      } else {
        const res = await fetch("/api/saved-messages", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            body,
            sort_order: Number.isFinite(sort_order) ? sort_order : 0,
          }),
        });
        const data = await readResponseJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Failed to create");
      }
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this saved message?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/saved-messages/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      if (editingId === id) resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/protected" title="Back to chats">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Saved messages</h1>
            <p className="text-sm text-muted-foreground">
              Reusable texts for Green API — pick them from the chat composer (message
              icon).
            </p>
          </div>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>{editingId ? "Edit saved message" : "New saved message"}</CardTitle>
            <CardDescription>
              Short title for the list, full text is pasted into the message field when
              selected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, title: e.target.value }))
                    }
                    placeholder="e.g. Greeting"
                    maxLength={200}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sort">Sort order</Label>
                  <Input
                    id="sort"
                    type="number"
                    value={form.sort_order}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sort_order: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="body">Message text</Label>
                <Textarea
                  id="body"
                  value={form.body}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, body: e.target.value }))
                  }
                  placeholder="Text inserted into the composer…"
                  rows={6}
                  maxLength={10000}
                  required
                  className="resize-y min-h-[120px]"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingId ? (
                    "Save changes"
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Add message
                    </>
                  )}
                </Button>
                {editingId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={saving}
                  >
                    <X className="mr-2 h-4 w-4" />
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your messages</CardTitle>
            <CardDescription>
              {loading ? "Loading…" : `${rows.length} saved`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved messages yet.</p>
            ) : (
              <ul className="space-y-3">
                {rows.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{r.title}</div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                          {r.body}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Sort: {r.sort_order}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Edit"
                          onClick={() => startEdit(r)}
                          disabled={saving}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Delete"
                          onClick={() => void remove(r.id)}
                          disabled={saving}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
