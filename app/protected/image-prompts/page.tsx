"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardCopy,
  Download,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

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
import {
  type ImagePrompt,
  clearImagePromptsFromStorage,
  loadImagePromptsFromStorage,
} from "@/lib/image-prompts";

const emptyForm = {
  name: "",
  prompt: "",
  expected_json: `{
  "field": "string",
  "anotherField": "string | null"
}`.trim(),
};

type FormState = typeof emptyForm;

function cleanPrompt(s: string): string {
  return s.replace(/\r\n/g, "\n").trim();
}

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImagePromptsPage() {
  const [items, setItems] = useState<ImagePrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationDismissed, setMigrationDismissed] = useState(false);

  const legacyPrompts = useMemo(() => {
    if (typeof window === "undefined") return [];
    return loadImagePromptsFromStorage();
  }, [items.length, migrationDismissed]);

  const showMigrationBanner =
    !loading &&
    !loadError &&
    items.length === 0 &&
    legacyPrompts.length > 0 &&
    !migrationDismissed;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/image-prompts");
      const data = (await res.json()) as {
        error?: string;
        prompts?: ImagePrompt[];
      };
      if (!res.ok) {
        throw new Error(data.error || "Failed to load image prompts");
      }
      setItems(data.prompts ?? []);
    } catch (e) {
      setLoadError(
        e instanceof Error ? e.message : "Failed to load image prompts",
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setShowForm(false);
    setForm(emptyForm);
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const startEdit = (p: ImagePrompt) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      prompt: p.prompt,
      expected_json: p.expected_json,
    });
    setShowForm(true);
  };

  const canSubmit = useMemo(() => {
    if (!form.name.trim()) return false;
    if (!cleanPrompt(form.prompt)) return false;
    if (!form.expected_json.trim()) return false;
    return true;
  }, [form]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim().slice(0, 120),
        prompt: cleanPrompt(form.prompt).slice(0, 16_000),
        expected_json: cleanPrompt(form.expected_json).slice(0, 16_000),
      };

      if (editingId) {
        const res = await fetch(`/api/image-prompts/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          error?: string;
          prompt?: ImagePrompt;
        };
        if (!res.ok) {
          throw new Error(data.error || "Save failed");
        }
        if (data.prompt) {
          setItems((prev) =>
            prev.map((x) => (x.id === editingId ? data.prompt! : x)),
          );
        }
      } else {
        const res = await fetch("/api/image-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as {
          error?: string;
          prompt?: ImagePrompt;
        };
        if (!res.ok) {
          throw new Error(data.error || "Create failed");
        }
        if (data.prompt) {
          setItems((prev) => [data.prompt!, ...prev]);
        }
      }
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this image prompt?")) return;
    try {
      const res = await fetch(`/api/image-prompts/${id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Delete failed");
      }
      setItems((prev) => prev.filter((x) => x.id !== id));
      if (editingId === id) resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleExportAll = () => {
    downloadJson(
      `image-prompts-${new Date().toISOString().slice(0, 10)}.json`,
      {
        version: 1,
        prompts: items,
      },
    );
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSaving(true);
    try {
      const text = await file.text();
      const j = JSON.parse(text) as { prompts?: unknown } | ImagePrompt[];
      const arr = Array.isArray(j)
        ? j
        : Array.isArray(j?.prompts)
          ? (j.prompts as unknown[])
          : [];
      const created: ImagePrompt[] = [];
      for (const row of arr) {
        if (!row || typeof row !== "object") continue;
        const r = row as Partial<ImagePrompt>;
        if (typeof r.name !== "string") continue;
        if (typeof r.prompt !== "string") continue;
        if (typeof r.expected_json !== "string") continue;
        const res = await fetch("/api/image-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: r.name.trim().slice(0, 120),
            prompt: cleanPrompt(r.prompt).slice(0, 16_000),
            expected_json: cleanPrompt(r.expected_json).slice(0, 16_000),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          prompt?: ImagePrompt;
        };
        if (!res.ok) {
          throw new Error(data.error || "Import failed");
        }
        if (data.prompt) created.push(data.prompt);
      }
      if (created.length === 0) throw new Error("No prompts found in file.");
      setItems((prev) => [...created, ...prev]);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
  };

  const handleImportFromBrowser = async () => {
    const legacy = loadImagePromptsFromStorage();
    if (legacy.length === 0) return;
    setMigrationBusy(true);
    try {
      const created: ImagePrompt[] = [];
      for (const r of legacy) {
        const res = await fetch("/api/image-prompts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: r.name.trim().slice(0, 120),
            prompt: cleanPrompt(r.prompt).slice(0, 16_000),
            expected_json: cleanPrompt(r.expected_json).slice(0, 16_000),
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          prompt?: ImagePrompt;
        };
        if (!res.ok) {
          throw new Error(data.error || "Import failed");
        }
        if (data.prompt) created.push(data.prompt);
      }
      clearImagePromptsFromStorage();
      setItems((prev) => [...created, ...prev]);
      setMigrationDismissed(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Import failed");
    } finally {
      setMigrationBusy(false);
    }
  };

  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(emptyForm.expected_json);
      alert("Example JSON copied.");
    } catch {
      alert("Could not copy.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-muted/40">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/protected" title="Back to chats">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-6 w-6 text-emerald-600" />
            <div>
              <h1 className="text-lg font-semibold">Image prompts</h1>
              <p className="text-sm text-muted-foreground">
                Saved per account for extracting structured data from images in chat
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {loadError ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {loadError}
          </div>
        ) : null}

        {showMigrationBanner ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Import prompts from this browser?
              </CardTitle>
              <CardDescription>
                We found {legacyPrompts.length} prompt
                {legacyPrompts.length === 1 ? "" : "s"} saved only on this device.
                Copy them to your account so they follow you on any device.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handleImportFromBrowser()}
                disabled={migrationBusy}
                className="gap-2"
              >
                {migrationBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Import to my account
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMigrationDismissed(true)}
                disabled={migrationBusy}
              >
                Dismiss
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="flex justify-between items-center gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            In chat, click the small AI icon next to an image to run one of these
            prompts and get copyable fields.
          </p>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportFile}
            />
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={handleExportAll}
              disabled={items.length === 0}
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              onClick={() => importInputRef.current?.click()}
              disabled={saving}
            >
              <Upload className="h-4 w-4" />
              Import
            </Button>
            {!showForm && (
              <Button type="button" onClick={startCreate} className="gap-2">
                <Plus className="h-4 w-4" />
                New prompt
              </Button>
            )}
          </div>
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? "Edit prompt" : "Create prompt"}</CardTitle>
              <CardDescription>
                Write instructions for what to extract. Provide an example JSON (or
                schema-like JSON) describing the fields you want returned.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="ip-name">Name</Label>
                  <Input
                    id="ip-name"
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="e.g. ID card → name, DOB, idNumber"
                    maxLength={120}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ip-prompt">Prompt</Label>
                  <Textarea
                    id="ip-prompt"
                    value={form.prompt}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, prompt: e.target.value }))
                    }
                    placeholder="Tell the AI what to extract and how to format it…"
                    rows={6}
                    className="resize-y min-h-[120px]"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="ip-json">Expected JSON</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={copyExample}
                    >
                      <ClipboardCopy className="h-4 w-4" />
                      Copy example
                    </Button>
                  </div>
                  <Textarea
                    id="ip-json"
                    value={form.expected_json}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, expected_json: e.target.value }))
                    }
                    rows={8}
                    className="font-mono text-xs resize-y min-h-[160px]"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Tip: this can be a JSON example with placeholder values. The
                    chat AI will try to match the same keys.
                  </p>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="submit"
                    disabled={saving || !canSubmit}
                    className="gap-2"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {editingId ? "Save changes" : "Create prompt"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={saving}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground gap-2 items-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading prompts…
          </div>
        ) : loadError ? null : items.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <p>No image prompts yet.</p>
              {!showForm && (
                <Button
                  type="button"
                  className="mt-4 gap-2"
                  onClick={startCreate}
                >
                  <Plus className="h-4 w-4" />
                  Create your first prompt
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {items.map((p) => (
              <li key={p.id}>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{p.name}</CardTitle>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          onClick={() => startEdit(p)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => void handleDelete(p.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-xs">
                      Updated {new Date(p.updated_at).toLocaleString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
                      {p.prompt}
                    </div>
                    <details className="rounded-md border border-border/70 bg-muted/20 p-3">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Expected JSON
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-xs font-mono text-foreground/90">
                        {p.expected_json}
                      </pre>
                    </details>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
