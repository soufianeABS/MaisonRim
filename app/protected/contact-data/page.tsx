"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, Copy, Check } from "lucide-react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readResponseJson } from "@/lib/read-response-json";

import type {
  FieldTemplate,
  ContactDataEntry,
} from "@/components/chat/contact-data-popover";

const emptyTemplate = { name: "", sort_order: "0" };

export default function ContactDataPage() {
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [browseEntries, setBrowseEntries] = useState<ContactDataEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyTemplate);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filterApplied, setFilterApplied] = useState("");
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editEntryKey, setEditEntryKey] = useState("");
  const [editEntryValue, setEditEntryValue] = useState("");
  const [savingEntryEdit, setSavingEntryEdit] = useState(false);
  const [defaultFieldNameSaved, setDefaultFieldNameSaved] = useState("");
  const [defaultFieldDraft, setDefaultFieldDraft] = useState("");
  const [savingDefaultPref, setSavingDefaultPref] = useState(false);

  const loadTemplates = useCallback(async () => {
    const res = await fetch("/api/contact-data/templates", {
      credentials: "include",
    });
    const data = await readResponseJson<{ templates?: unknown; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Failed to load");
    setTemplates(Array.isArray(data.templates) ? (data.templates as FieldTemplate[]) : []);
  }, []);

  const loadPreferences = useCallback(async (): Promise<string> => {
    const res = await fetch("/api/contact-data/preferences", {
      credentials: "include",
    });
    const data = await readResponseJson<{
      default_field_name?: unknown;
      error?: string;
    }>(res);
    if (!res.ok) throw new Error(data.error || "Failed to load preferences");
    const d = typeof data.default_field_name === "string" ? data.default_field_name : "";
    setDefaultFieldNameSaved(d);
    setDefaultFieldDraft(d);
    return d;
  }, []);

  const loadBrowse = useCallback(async () => {
    setBrowseLoading(true);
    try {
      const q = filterApplied.trim();
      const url =
        `/api/contact-data/entries?browse=1&limit=250` +
        (q ? `&q=${encodeURIComponent(q)}` : "");
      const res = await fetch(url, { credentials: "include" });
      const data = await readResponseJson<{ entries?: unknown; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setBrowseEntries(Array.isArray(data.entries) ? (data.entries as ContactDataEntry[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Browse failed");
      setBrowseEntries([]);
    } finally {
      setBrowseLoading(false);
    }
  }, [filterApplied]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [d] = await Promise.all([loadPreferences(), loadTemplates()]);
        if (!cancelled) {
          setForm((prev) => {
            if (prev.name !== "" || prev.sort_order !== "0") return prev;
            return { name: d, sort_order: "0" };
          });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTemplates, loadPreferences]);

  useEffect(() => {
    void loadBrowse();
  }, [loadBrowse]);

  const resetForm = useCallback(() => {
    setForm({ name: defaultFieldNameSaved, sort_order: "0" });
    setEditingTemplateId(null);
  }, [defaultFieldNameSaved]);

  const startEdit = (r: FieldTemplate) => {
    setEditingTemplateId(r.id);
    setForm({
      name: r.name,
      sort_order: String(r.sort_order),
    });
  };

  const submitTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const sort_order = parseInt(form.sort_order, 10);
    if (!name) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingTemplateId) {
        const res = await fetch(`/api/contact-data/templates/${editingTemplateId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            sort_order: Number.isFinite(sort_order) ? sort_order : 0,
          }),
        });
        const data = await readResponseJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Update failed");
      } else {
        const res = await fetch("/api/contact-data/templates", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            sort_order: Number.isFinite(sort_order) ? sort_order : 0,
          }),
        });
        const data = await readResponseJson<{ error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Create failed");
      }
      resetForm();
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!window.confirm("Remove this suggested field name from the library?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/contact-data/templates/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Delete failed");
      if (editingTemplateId === id) resetForm();
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const saveDefaultFieldPreference = async () => {
    setSavingDefaultPref(true);
    setError(null);
    try {
      const res = await fetch("/api/contact-data/preferences", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_field_name: defaultFieldDraft }),
      });
      const data = await readResponseJson<{
        default_field_name?: unknown;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to save default");
      const saved =
        typeof data.default_field_name === "string" ? data.default_field_name : "";
      setDefaultFieldNameSaved(saved);
      setDefaultFieldDraft(saved);
      if (!editingTemplateId) {
        setForm((f) => ({ ...f, name: saved }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingDefaultPref(false);
    }
  };

  const startEditBrowseEntry = (row: ContactDataEntry) => {
    setEditingEntryId(row.id);
    setEditEntryKey(row.field_key);
    setEditEntryValue(row.field_value);
    setError(null);
  };

  const cancelEditBrowseEntry = () => {
    setEditingEntryId(null);
    setEditEntryKey("");
    setEditEntryValue("");
  };

  const saveBrowseEntryEdit = async () => {
    if (!editingEntryId) return;
    const key = editEntryKey.trim();
    if (!key) {
      setError("Field name cannot be empty.");
      return;
    }
    setSavingEntryEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/contact-data/entries/${editingEntryId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_key: key,
          field_value: editEntryValue,
        }),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Update failed");
      cancelEditBrowseEntry();
      await loadBrowse();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingEntryEdit(false);
    }
  };

  const copyEntryValue = async (entryId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEntryId(entryId);
      window.setTimeout(() => setCopiedEntryId((id) => (id === entryId ? null : id)), 1600);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  const deleteEntry = async (id: string) => {
    if (!window.confirm("Delete this stored value?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/contact-data/entries/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await loadBrowse();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
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
            <h1 className="text-2xl font-bold tracking-tight">Contact data</h1>
            <p className="text-sm text-muted-foreground">
              Suggested field names for the notebook next to the chat composer, and stored
              values per contact.
            </p>
          </div>
        </div>

        {error ? (
          <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Tabs defaultValue="library" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="library">Field name library</TabsTrigger>
            <TabsTrigger value="stored">Stored values</TabsTrigger>
          </TabsList>

          <TabsContent value="library">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">Default field name</CardTitle>
                <CardDescription>
                  This text is used to pre-fill the &quot;Field name&quot; box when you add a
                  new library entry (and after you save an entry). Save to store it on your
                  account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label htmlFor="cdf-default-field-name">Default for &quot;Field name&quot;</Label>
                    <Input
                      id="cdf-default-field-name"
                      value={defaultFieldDraft}
                      onChange={(e) => setDefaultFieldDraft(e.target.value)}
                      placeholder="e.g. Notes, Contract #"
                      maxLength={200}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={savingDefaultPref}
                    onClick={() => void saveDefaultFieldPreference()}
                  >
                    {savingDefaultPref ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Save default"
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>
                  {editingTemplateId ? "Edit field name" : "New suggested field name"}
                </CardTitle>
                <CardDescription>
                  These names appear as suggestions when you add contact data in a
                  conversation. You can still type any custom name in the chat.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitTemplate} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="cdf-name">Field name</Label>
                      <Input
                        id="cdf-name"
                        value={form.name}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, name: e.target.value }))
                        }
                        placeholder="e.g. Contract #, Birthday"
                        maxLength={200}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cdf-sort">Sort order</Label>
                      <Input
                        id="cdf-sort"
                        type="number"
                        value={form.sort_order}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, sort_order: e.target.value }))
                        }
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={saving}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : editingTemplateId ? (
                        "Save changes"
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Add name
                        </>
                      )}
                    </Button>
                    {editingTemplateId ? (
                      <Button type="button" variant="outline" onClick={resetForm}>
                        Cancel edit
                      </Button>
                    ) : null}
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Your field names</CardTitle>
                <CardDescription>
                  Order controls how suggestions are listed in the datalist (lower first).
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No entries yet.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {templates.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{t.name}</span>
                        <span className="text-xs text-muted-foreground">
                          sort {t.sort_order}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startEdit(t)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => void deleteTemplate(t.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stored">
            <Card>
              <CardHeader>
                <CardTitle>Recent stored values</CardTitle>
                <CardDescription>
                  Data saved per contact from the chat notebook. Filter by phone number
                  (digits).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Filter by phone (digits, optional)"
                    value={filterInput}
                    onChange={(e) => setFilterInput(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setFilterApplied(filterInput);
                    }}
                    disabled={browseLoading}
                  >
                    Apply filter
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void loadBrowse()}
                    disabled={browseLoading}
                  >
                    {browseLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                </div>
                {browseLoading && browseEntries.length === 0 ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : browseEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No entries yet.</p>
                ) : (
                  <ul className="max-h-[480px] space-y-2 overflow-y-auto">
                    {browseEntries.map((row) =>
                      editingEntryId === row.id ? (
                        <li
                          key={row.id}
                          className="rounded-md border border-emerald-500/40 bg-muted/30 px-3 py-3 text-sm"
                        >
                          <p className="mb-2 text-xs text-muted-foreground">
                            +{row.contact_phone}
                          </p>
                          <div className="space-y-2">
                            <div>
                              <Label className="text-xs">Field name</Label>
                              <Input
                                value={editEntryKey}
                                onChange={(e) => setEditEntryKey(e.target.value)}
                                className="mt-0.5"
                                maxLength={200}
                                disabled={savingEntryEdit}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Value</Label>
                              <Textarea
                                value={editEntryValue}
                                onChange={(e) => setEditEntryValue(e.target.value)}
                                rows={3}
                                className="mt-0.5 resize-y"
                                maxLength={8000}
                                disabled={savingEntryEdit}
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={savingEntryEdit}
                                onClick={cancelEditBrowseEntry}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700"
                                disabled={savingEntryEdit}
                                onClick={() => void saveBrowseEntryEdit()}
                              >
                                {savingEntryEdit ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Save"
                                )}
                              </Button>
                            </div>
                          </div>
                        </li>
                      ) : (
                        <li
                          key={row.id}
                          className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-muted-foreground">
                                +{row.contact_phone}
                              </p>
                              <p className="font-medium">{row.field_key}</p>
                              <div className="mt-0.5 flex items-start gap-1">
                                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-muted-foreground">
                                  {row.field_value || "—"}
                                </p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                                  title="Copy value"
                                  aria-label={`Copy value for ${row.field_key}`}
                                  onClick={() => void copyEntryValue(row.id, row.field_value)}
                                >
                                  {copiedEntryId === row.id ? (
                                    <Check className="h-4 w-4 text-emerald-600" />
                                  ) : (
                                    <Copy className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col gap-0.5">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                title="Edit"
                                onClick={() => startEditBrowseEntry(row)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                                title="Delete"
                                onClick={() => void deleteEntry(row.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
