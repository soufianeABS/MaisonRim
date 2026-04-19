"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  NotebookPen,
  Plus,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  Pencil,
} from "lucide-react";
import { readResponseJson } from "@/lib/read-response-json";

export type FieldTemplate = {
  id: string;
  name: string;
  sort_order: number;
};

export type ContactDataEntry = {
  id: string;
  contact_phone: string;
  field_key: string;
  field_value: string;
  updated_at: string;
};

type ContactDataPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Digits-only phone matching contacts.phone */
  contactPhone: string;
  contactDisplayName?: string;
  /** Appends text to the message composer (respects max length in parent). */
  onAppendComposer: (text: string) => void;
}

export function ContactDataPopover({
  open,
  onOpenChange,
  contactPhone,
  contactDisplayName,
  onAppendComposer,
}: ContactDataPopoverProps) {
  const [templates, setTemplates] = useState<FieldTemplate[]>([]);
  const [entries, setEntries] = useState<ContactDataEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldKey, setFieldKey] = useState("");
  const [fieldValue, setFieldValue] = useState("");
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editFieldKey, setEditFieldKey] = useState("");
  const [editFieldValue, setEditFieldValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, eRes, pRes] = await Promise.all([
        fetch("/api/contact-data/templates", { credentials: "include" }),
        fetch(
          `/api/contact-data/entries?phone=${encodeURIComponent(contactPhone)}`,
          { credentials: "include" },
        ),
        fetch("/api/contact-data/preferences", { credentials: "include" }),
      ]);
      const tJson = await readResponseJson<{ templates?: unknown; error?: string }>(tRes);
      const eJson = await readResponseJson<{ entries?: unknown; error?: string }>(eRes);
      const pJson = await readResponseJson<{
        default_field_name?: unknown;
        error?: string;
      }>(pRes);
      if (!tRes.ok) throw new Error(tJson.error || "Failed to load field names");
      if (!eRes.ok) throw new Error(eJson.error || "Failed to load contact data");
      setTemplates(Array.isArray(tJson.templates) ? (tJson.templates as FieldTemplate[]) : []);
      setEntries(Array.isArray(eJson.entries) ? (eJson.entries as ContactDataEntry[]) : []);

      let defaultName = "";
      if (pRes.ok) {
        defaultName =
          typeof pJson.default_field_name === "string" ? pJson.default_field_name : "";
      }
      setFieldKey((prev) => (prev.trim() === "" ? defaultName : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setTemplates([]);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [contactPhone]);

  useEffect(() => {
    if (!open || !contactPhone) return;
    void load();
  }, [open, contactPhone, load]);

  useEffect(() => {
    if (!open) {
      setFieldKey("");
      setFieldValue("");
      setError(null);
      setEditingEntryId(null);
      setEditFieldKey("");
      setEditFieldValue("");
    }
  }, [open]);

  const startEditEntry = (row: ContactDataEntry) => {
    setEditingEntryId(row.id);
    setEditFieldKey(row.field_key);
    setEditFieldValue(row.field_value);
    setError(null);
  };

  const cancelEditEntry = () => {
    setEditingEntryId(null);
    setEditFieldKey("");
    setEditFieldValue("");
  };

  const saveEditEntry = async () => {
    if (!editingEntryId) return;
    const key = editFieldKey.trim();
    if (!key) {
      setError("Field name cannot be empty.");
      return;
    }
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/contact-data/entries/${editingEntryId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field_key: key,
          field_value: editFieldValue,
        }),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Update failed");
      cancelEditEntry();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingEdit(false);
    }
  };

  const saveEntry = async () => {
    const key = fieldKey.trim();
    if (!key) {
      setError("Enter a field name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/contact-data/entries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_phone: contactPhone,
          field_key: key,
          field_value: fieldValue,
        }),
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Save failed");
      setFieldKey("");
      setFieldValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async (id: string) => {
    if (!window.confirm("Delete this field for this contact?")) return;
    try {
      const res = await fetch(`/api/contact-data/entries/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const insertLine = (key: string, value: string) => {
    const line = `${key}: ${value}\n`;
    onAppendComposer(line);
  };

  const copyValue = async (entryId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEntryId(entryId);
      window.setTimeout(() => setCopiedEntryId((id) => (id === entryId ? null : id)), 1600);
    } catch {
      setError("Could not copy to clipboard.");
    }
  };

  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-2 w-[min(calc(100vw-2rem),22rem)] rounded-xl border border-border bg-popover p-3 shadow-lg"
      role="dialog"
      aria-label="Contact data"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">Contact data</p>
          <p className="truncate text-xs text-muted-foreground" title={contactDisplayName}>
            {contactDisplayName || contactPhone}
          </p>
        </div>
        <Link
          href="/protected/contact-data"
          className="inline-flex shrink-0 items-center gap-0.5 text-xs text-emerald-600 hover:underline"
          onClick={() => onOpenChange(false)}
        >
          Manage
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {error && (
        <p className="mb-2 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          <ul className="mb-3 max-h-44 space-y-2 overflow-y-auto text-sm">
            {entries.length === 0 ? (
              <li className="text-xs text-muted-foreground">No saved fields yet.</li>
            ) : (
              entries.map((row) =>
                editingEntryId === row.id ? (
                  <li
                    key={row.id}
                    className="rounded-md border border-emerald-500/40 bg-muted/40 px-2 py-2"
                  >
                    <div className="space-y-1.5">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Field name</Label>
                        <Input
                          value={editFieldKey}
                          onChange={(e) => setEditFieldKey(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.preventDefault();
                          }}
                          className="h-8 text-sm"
                          maxLength={200}
                          disabled={savingEdit}
                          list="cdf-suggestions-edit"
                        />
                        <datalist id="cdf-suggestions-edit">
                          {templates.map((t) => (
                            <option key={t.id} value={t.name} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Value</Label>
                        <Textarea
                          value={editFieldValue}
                          onChange={(e) => setEditFieldValue(e.target.value)}
                          onKeyDown={(e) => e.stopPropagation()}
                          rows={2}
                          className="min-h-[48px] resize-y text-sm"
                          maxLength={8000}
                          disabled={savingEdit}
                        />
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          disabled={savingEdit}
                          onClick={cancelEditEntry}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 bg-emerald-600 text-xs hover:bg-emerald-700"
                          disabled={savingEdit}
                          onClick={() => void saveEditEntry()}
                        >
                          {savingEdit ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
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
                    className="rounded-lg border border-border/60 bg-card/80 px-2.5 py-2 shadow-sm transition-colors hover:border-border hover:bg-muted/20"
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                        title={row.field_key}
                      >
                        {row.field_key}
                      </p>
                      <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-snug text-foreground">
                        {row.field_value ? (
                          row.field_value
                        ) : (
                          <span className="text-muted-foreground/80 italic">No value</span>
                        )}
                      </p>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-border/50 pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 min-h-8 shrink-0 px-3 text-xs font-medium"
                        onClick={() => insertLine(row.field_key, row.field_value)}
                      >
                        Insert
                      </Button>
                      <div
                        className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md border border-border/50 bg-muted/40 p-0.5"
                        role="group"
                        aria-label={`Actions for ${row.field_key}`}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title="Copy value"
                          aria-label={`Copy value for ${row.field_key}`}
                          onClick={() => void copyValue(row.id, row.field_value)}
                        >
                          {copiedEntryId === row.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          title="Edit"
                          aria-label={`Edit ${row.field_key}`}
                          onClick={() => startEditEntry(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          title="Delete"
                          aria-label={`Delete ${row.field_key}`}
                          onClick={() => void removeEntry(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ),
              )
            )}
          </ul>

          <div className="space-y-2 border-t border-border pt-2">
            <div className="space-y-1">
              <Label htmlFor="cdf-key" className="text-xs">
                Field name
              </Label>
              <Input
                id="cdf-key"
                list="cdf-suggestions"
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder="e.g. Order ID"
                className="h-9 text-sm"
                maxLength={200}
              />
              <datalist id="cdf-suggestions">
                {templates.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cdf-val" className="text-xs">
                Value
              </Label>
              <Textarea
                id="cdf-val"
                value={fieldValue}
                onChange={(e) => setFieldValue(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Any text…"
                rows={2}
                className="min-h-[52px] resize-y text-sm"
                maxLength={8000}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={saving}
              onClick={() => void saveEntry()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Save for contact
                </>
              )}
            </Button>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Suggested names come from your{" "}
              <Link
                href="/protected/contact-data"
                className="text-emerald-600 underline"
                onClick={() => onOpenChange(false)}
              >
                field name library
              </Link>
              . You can type any custom name here.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export function ContactDataTriggerButton({
  active,
  onClick,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-full transition-colors ${
        active ? "bg-muted text-foreground" : "hover:bg-muted"
      }`}
      title="Contact data (name & value)"
      aria-expanded={active}
      aria-haspopup="dialog"
    >
      <NotebookPen className="h-5 w-5" />
    </Button>
  );
}
