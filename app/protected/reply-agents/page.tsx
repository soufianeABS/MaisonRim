"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ReplyAgent = {
  id: string;
  name: string;
  persona?: string | null;
  task?: string | null;
  output_rules?: unknown;
  business_rules?: unknown;
  system_prompt?: string | null;
  temperature: number;
  max_output_tokens: number;
  created_at: string;
  updated_at: string;
};

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

const emptyForm = {
  name: "",
  persona: "",
  task: "",
  output_rules: [] as string[],
  business_rules: [] as string[],
  system_prompt: "",
  temperature: "0.65",
  max_output_tokens: "512",
};

type FormState = typeof emptyForm;

function RulesEditor({
  label,
  description,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  description?: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label>{label}</Label>
        {description ? (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        ) : null}
      </div>
      {values.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No rules yet — add one below.</p>
      ) : (
        <ul className="space-y-2">
          {values.map((line, i) => (
            <li key={i} className="flex gap-2 items-start">
              <Input
                value={line}
                onChange={(e) => {
                  const next = [...values];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                placeholder={placeholder}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                title="Remove rule"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => onChange([...values, ""])}>
        <Plus className="h-3.5 w-3.5" />
        Add rule
      </Button>
    </div>
  );
}

function trimRules(lines: string[]): string[] {
  return lines.map((s) => s.trim()).filter(Boolean).slice(0, 40);
}

export default function ReplyAgentsPage() {
  const [agents, setAgents] = useState<ReplyAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/reply-agents");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load agents");
      }
      setAgents(data.agents ?? []);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const startEdit = (a: ReplyAgent) => {
    setEditingId(a.id);
    setForm({
      name: a.name,
      persona: a.persona ?? "",
      task: a.task ?? "",
      output_rules: asStringList(a.output_rules),
      business_rules: asStringList(a.business_rules),
      system_prompt: a.system_prompt ?? "",
      temperature: String(a.temperature),
      max_output_tokens: String(a.max_output_tokens),
    });
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        persona: form.persona.trim(),
        task: form.task.trim(),
        output_rules: trimRules(form.output_rules),
        business_rules: trimRules(form.business_rules),
        system_prompt: form.system_prompt.trim(),
        temperature: Number(form.temperature),
        max_output_tokens: Number(form.max_output_tokens),
      };

      if (editingId) {
        const res = await fetch(`/api/reply-agents/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to update");
        }
      } else {
        const res = await fetch("/api/reply-agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to create");
        }
      }

      await loadAgents();
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this reply agent?")) return;
    try {
      const res = await fetch(`/api/reply-agents/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete");
      }
      if (editingId === id) {
        resetForm();
      }
      await loadAgents();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const previewSnippet = (a: ReplyAgent) => {
    const p = (a.persona ?? "").trim();
    const t = (a.task ?? "").trim();
    const sp = (a.system_prompt ?? "").trim();
    const oc = asStringList(a.output_rules).length;
    const bc = asStringList(a.business_rules).length;
    if (p || t) {
      return (
        <div className="space-y-1 text-sm text-muted-foreground">
          {p ? <p className="line-clamp-2 whitespace-pre-wrap">Persona: {p}</p> : null}
          {t ? <p className="line-clamp-2 whitespace-pre-wrap">Task: {t}</p> : null}
          <p className="text-xs">
            {oc} output rule{oc !== 1 ? "s" : ""} · {bc} business rule{bc !== 1 ? "s" : ""}
          </p>
        </div>
      );
    }
    if (sp) {
      return (
        <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-wrap">
          Legacy prompt: {sp}
        </p>
      );
    }
    return <p className="text-sm text-muted-foreground">Empty agent</p>;
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
              <h1 className="text-lg font-semibold">Reply agents</h1>
              <p className="text-sm text-muted-foreground">
                Persona, task, rule lists, and optional extra instructions for suggest reply
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <p className="text-sm text-muted-foreground">
            In chat, open <span className="font-medium text-foreground">Suggest reply</span> and
            pick an agent. Persona and task are required; rules are optional lists.
          </p>
          {!showForm && (
            <Button type="button" onClick={startCreate} className="shrink-0 gap-2">
              <Plus className="h-4 w-4" />
              New agent
            </Button>
          )}
        </div>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>{editingId ? "Edit agent" : "Create agent"}</CardTitle>
              <CardDescription>
                The app combines persona, task, output rules, business rules, and any additional
                instructions into one system prompt. The last messages of the chat are still sent
                in the standard transcript format.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Name</Label>
                  <Input
                    id="agent-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Support — formal"
                    maxLength={120}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-persona">Persona</Label>
                  <Textarea
                    id="agent-persona"
                    value={form.persona}
                    onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
                    placeholder="Who is the assistant? Tone, background, relationship to the customer…"
                    rows={5}
                    className="resize-y min-h-[100px]"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-task">Task</Label>
                  <Textarea
                    id="agent-task"
                    value={form.task}
                    onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
                    placeholder="What should each suggested reply accomplish? Constraints on content…"
                    rows={5}
                    className="resize-y min-h-[100px]"
                    required
                  />
                </div>

                <RulesEditor
                  label="Output rules"
                  description="Formatting, length, language, what not to say — one rule per line."
                  values={form.output_rules}
                  onChange={(output_rules) => setForm((f) => ({ ...f, output_rules }))}
                  placeholder="e.g. Keep replies under 3 sentences."
                />

                <RulesEditor
                  label="Business rules"
                  description="Policies, pricing boundaries, legal lines — one rule per line."
                  values={form.business_rules}
                  onChange={(business_rules) => setForm((f) => ({ ...f, business_rules }))}
                  placeholder="e.g. Never promise refunds without manager approval."
                />

                <div className="space-y-2">
                  <Label htmlFor="agent-extra">Additional instructions (optional)</Label>
                  <Textarea
                    id="agent-extra"
                    value={form.system_prompt}
                    onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
                    placeholder="Anything else that should apply on top of the sections above…"
                    rows={4}
                    className="resize-y min-h-[80px] text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="agent-temp">Temperature (0–2)</Label>
                    <Input
                      id="agent-temp"
                      type="number"
                      step="0.05"
                      min={0}
                      max={2}
                      value={form.temperature}
                      onChange={(e) => setForm((f) => ({ ...f, temperature: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-tokens">Max output tokens</Label>
                    <Input
                      id="agent-tokens"
                      type="number"
                      min={64}
                      max={8192}
                      step={64}
                      value={form.max_output_tokens}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, max_output_tokens: e.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button type="submit" disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {editingId ? "Save changes" : "Create agent"}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetForm} disabled={saving}>
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
            Loading agents…
          </div>
        ) : agents.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <p>No agents yet. Create one to get tailored reply suggestions.</p>
              {!showForm && (
                <Button type="button" className="mt-4 gap-2" onClick={startCreate}>
                  <Plus className="h-4 w-4" />
                  Create your first agent
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {agents.map((a) => (
              <li key={a.id}>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{a.name}</CardTitle>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title="Edit"
                          onClick={() => startEdit(a)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          title="Delete"
                          onClick={() => handleDelete(a.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <CardDescription className="text-xs">
                      temp {a.temperature} · max tokens {a.max_output_tokens}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>{previewSnippet(a)}</CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
