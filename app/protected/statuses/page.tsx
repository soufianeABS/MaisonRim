"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ContactStatus = {
  id: string;
  name: string;
  color: string;
  rule: string;
  created_at: string;
  updated_at: string;
};

const SUGGESTED: Array<Pick<ContactStatus, "name" | "color" | "rule">> = [
  {
    name: "New client",
    color: "#3b82f6",
    rule: "Treat this as a first-time customer. Ask the minimum clarifying questions needed and propose the next step clearly.",
  },
  {
    name: "Finished order",
    color: "#22c55e",
    rule: "Be concise and confirm completion. Offer a simple follow-up (receipt, feedback, or next steps).",
  },
  {
    name: "Waiting payment",
    color: "#f59e0b",
    rule: "Politely remind about payment, include amount and payment method if known, and avoid sounding aggressive.",
  },
  {
    name: "Paid",
    color: "#10b981",
    rule: "Confirm payment received and move the conversation to delivery/fulfillment details.",
  },
];

const emptyForm = {
  name: "",
  color: "#3b82f6",
  rule: "",
};

export default function StatusesPage() {
  const [statuses, setStatuses] = useState<ContactStatus[]>([]);
  const [defaultStatusId, setDefaultStatusId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);

  const suggestedMissing = useMemo(() => {
    const existing = new Set(statuses.map((s) => s.name.toLowerCase().trim()));
    return SUGGESTED.filter((s) => !existing.has(s.name.toLowerCase().trim()));
  }, [statuses]);

  const loadStatuses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/contact-statuses");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load statuses");
      setStatuses(data.statuses ?? []);

      const defRes = await fetch("/api/contact-statuses/default", { cache: "no-store" });
      const defData = await defRes.json();
      if (defRes.ok) {
        setDefaultStatusId(defData?.default_status_id ?? null);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to load statuses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  const createStatus = async (payload: { name: string; color: string; rule: string }) => {
    const res = await fetch("/api/contact-statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create status");
  };

  const handleAddSuggested = async (s: { name: string; color: string; rule: string }) => {
    setSaving(true);
    try {
      await createStatus(s);
      await loadStatuses();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not add suggested status");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createStatus({
        name: form.name.trim(),
        color: form.color.trim(),
        rule: form.rule.trim(),
      });
      setForm(emptyForm);
      await loadStatuses();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (s: ContactStatus) => {
    setEditingId(s.id);
    setEditForm({
      name: s.name ?? "",
      color: s.color ?? "#3b82f6",
      rule: s.rule ?? "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(emptyForm);
  };

  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/contact-statuses/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name.trim(),
          color: editForm.color.trim(),
          rule: editForm.rule.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      cancelEdit();
      await loadStatuses();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this status?")) return;
    try {
      const res = await fetch(`/api/contact-statuses/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      if (defaultStatusId === id) {
        setDefaultStatusId(null);
      }
      if (editingId === id) cancelEdit();
      await loadStatuses();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const setDefaultStatus = async (id: string | null) => {
    setSaving(true);
    try {
      const res = await fetch("/api/contact-statuses/default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_status_id: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to set default");
      setDefaultStatusId(data?.default_status_id ?? null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not set default");
    } finally {
      setSaving(false);
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
            <Sparkles className="h-6 w-6 text-amber-500" />
            <div>
              <h1 className="text-lg font-semibold">Statuses</h1>
              <p className="text-sm text-muted-foreground">
                Create colored statuses for contacts. The status rule is injected into Suggest reply.
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Default tag</CardTitle>
            <CardDescription>
              This tag is automatically assigned to a client when you create a new chat/contact.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm">
              {defaultStatusId ? (
                <span className="text-foreground">
                  Current default:{" "}
                  <span className="font-medium">
                    {statuses.find((s) => s.id === defaultStatusId)?.name ?? "Unknown"}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">No default tag selected.</span>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void setDefaultStatus(null)}
              disabled={saving || !defaultStatusId}
            >
              Clear default
            </Button>
          </CardContent>
        </Card>

        {suggestedMissing.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Suggested statuses</CardTitle>
              <CardDescription>Pick one to add, or create your own.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {suggestedMissing.map((s) => (
                <Button
                  key={s.name}
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={saving}
                  onClick={() => void handleAddSuggested(s)}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.name}
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a status</CardTitle>
            <CardDescription>Name + color. Optional rule is appended to AI prompt.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="st-name">Name</Label>
                <Input
                  id="st-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Waiting payment"
                  maxLength={120}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div className="space-y-2">
                  <Label htmlFor="st-color">Color</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      id="st-color"
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      className="h-10 w-16 p-1"
                    />
                    <Input
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      placeholder="#22c55e"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="st-rule">Rule (optional)</Label>
                <Textarea
                  id="st-rule"
                  value={form.rule}
                  onChange={(e) => setForm((f) => ({ ...f, rule: e.target.value }))}
                  placeholder="Example: If status is Waiting payment, remind politely and propose a payment link."
                  rows={4}
                  className="resize-y"
                />
              </div>
            </form>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground gap-2 items-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading statuses…
          </div>
        ) : statuses.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <p>No statuses yet.</p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {statuses.map((s) => (
              <li key={s.id}>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                        {defaultStatusId === s.id ? (
                          <span className="ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                            Default
                          </span>
                        ) : null}
                      </CardTitle>
                      <div className="flex gap-1 shrink-0">
                        {defaultStatusId !== s.id ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={saving}
                            onClick={() => void setDefaultStatus(s.id)}
                            title="Set as default tag for new clients"
                          >
                            Set default
                          </Button>
                        ) : null}
                        {editingId === s.id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Cancel edit"
                            onClick={cancelEdit}
                            disabled={saving}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => startEdit(s)}
                            disabled={saving}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => void handleDelete(s.id)}
                          disabled={saving}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {editingId === s.id ? (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor={`edit-name-${s.id}`}>Name</Label>
                          <Input
                            id={`edit-name-${s.id}`}
                            value={editForm.name}
                            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            maxLength={120}
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`edit-color-${s.id}`}>Color</Label>
                          <div className="flex gap-2 items-center">
                            <Input
                              id={`edit-color-${s.id}`}
                              type="color"
                              value={editForm.color}
                              onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                              className="h-10 w-16 p-1"
                            />
                            <Input
                              value={editForm.color}
                              onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                              placeholder="#22c55e"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`edit-rule-${s.id}`}>Rule (optional)</Label>
                          <Textarea
                            id={`edit-rule-${s.id}`}
                            value={editForm.rule}
                            onChange={(e) => setEditForm((f) => ({ ...f, rule: e.target.value }))}
                            rows={4}
                            className="resize-y"
                          />
                        </div>

                        <div className="flex gap-2 flex-wrap justify-end">
                          <Button
                            type="button"
                            onClick={() => void handleSaveEdit(s.id)}
                            disabled={saving}
                          >
                            {saving ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving…
                              </>
                            ) : (
                              "Save"
                            )}
                          </Button>
                          <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {s.rule?.trim() ? s.rule : "No rule"}
                      </p>
                    )}
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

