"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Status = { id: string; name: string; color: string };

type ApiAction = {
  id: string;
  status_id: string | null;
  tag_name: string;
  url: string;
  method: "GET" | "POST";
  payload_template: unknown;
  response_map: unknown;
  message_template?: string | null;
  auto_send_message?: boolean | null;
  use_server_proxy?: boolean;
  updated_at: string;
};

type ResponseMapEntry = {
  target: string;
  jsonPath: string;
};

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

/** Empty or whitespace-only textarea is treated as `{}` (valid for GET with no extra query params). */
function parseJsonField(raw: string, fieldLabel: string): unknown {
  const t = raw.trim();
  if (t === "") return {};
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`${fieldLabel} must be valid JSON`);
  }
}

function responseMapToEntries(value: unknown): ResponseMapEntry[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([target, jsonPath]) => ({
    target,
    jsonPath: typeof jsonPath === "string" ? jsonPath : String(jsonPath ?? ""),
  }));
}

function entriesToResponseMap(entries: ResponseMapEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const target = entry.target.trim();
    const jsonPath = entry.jsonPath.trim();
    if (!target || !jsonPath) continue;
    out[target] = jsonPath;
  }
  return out;
}

export default function ActionsPage() {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [actions, setActions] = useState<ApiAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedStatusId, setSelectedStatusId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [method, setMethod] = useState<"GET" | "POST">("POST");
  const [payloadTemplate, setPayloadTemplate] = useState(pretty({ conversationId: "{{conversationId}}" }));
  const [responseMapEntries, setResponseMapEntries] = useState<ResponseMapEntry[]>([
    { target: "metadata.remote_url", jsonPath: "$.url" },
  ]);
  const [messageTemplate, setMessageTemplate] = useState("");
  const [autoSendMessage, setAutoSendMessage] = useState(false);
  const [useServerProxy, setUseServerProxy] = useState(false);

  const actionByStatus = useMemo(() => {
    const map = new Map<string, ApiAction>();
    for (const a of actions) {
      if (a.status_id) map.set(a.status_id, a);
    }
    return map;
  }, [actions]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, aRes] = await Promise.all([
        fetch("/api/contact-statuses", { cache: "no-store" }),
        fetch("/api/api-actions", { cache: "no-store" }),
      ]);
      const sData = await sRes.json();
      const aData = await aRes.json();
      if (!sRes.ok) throw new Error(sData.error || "Failed to load statuses");
      if (!aRes.ok) throw new Error(aData.error || "Failed to load actions");
      setStatuses(sData.statuses ?? []);
      setActions(aData.actions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upsertForStatus = async () => {
    if (!selectedStatusId) throw new Error("Pick a tag");
    const existing = actionByStatus.get(selectedStatusId) ?? null;
    const payload = parseJsonField(payloadTemplate, "payload_template");
    const map = entriesToResponseMap(responseMapEntries);

    const body = {
      status_id: selectedStatusId,
      tag_name: "",
      url: url.trim(),
      method,
      payload_template: payload,
      response_map: map,
      message_template: messageTemplate,
      auto_send_message: autoSendMessage,
      use_server_proxy: useServerProxy,
    };
    if (!body.url) throw new Error("URL is required");

    const res = existing
      ? await fetch(`/api/api-actions/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/api-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    await load();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertForStatus();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (actionId: string) => {
    if (!confirm("Delete this mapping?")) return;
    const res = await fetch(`/api/api-actions/${actionId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "Delete failed");
      return;
    }
    await load();
  };

  const handlePickStatus = (id: string) => {
    setSelectedStatusId(id);
    const existing = actionByStatus.get(id) ?? null;
    if (existing) {
      setUrl(existing.url ?? "");
      setMethod(existing.method ?? "POST");
      setPayloadTemplate(pretty(existing.payload_template));
      setResponseMapEntries(responseMapToEntries(existing.response_map));
      setMessageTemplate(existing.message_template ?? "");
      setAutoSendMessage(Boolean(existing.auto_send_message));
      setUseServerProxy(Boolean(existing.use_server_proxy));
    } else {
      setUrl("");
      setMethod("POST");
      setPayloadTemplate(pretty({ conversationId: "{{conversationId}}" }));
      setResponseMapEntries([{ target: "metadata.remote_url", jsonPath: "$.url" }]);
      setMessageTemplate("");
      setAutoSendMessage(false);
      setUseServerProxy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-muted/40">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/protected" title="Back to chats">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Dynamic actions</h1>
            <p className="text-sm text-muted-foreground">
              Map Tags → API calls. Responses are stored on the conversation metadata.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground gap-2 items-center">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Create / update mapping</CardTitle>
                <CardDescription>
                  Placeholders: <code>{"{{conversationId}}"}</code>, <code>{"{{ownerId}}"}</code>,{" "}
                  <code>{"{{tagName}}"}</code>, and <code>{"{{settings.<field>}}"}</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Tag</Label>
                    <div className="flex gap-2 flex-wrap">
                      {statuses.map((s) => {
                        const active = selectedStatusId === s.id;
                        const has = actionByStatus.has(s.id);
                        return (
                          <Button
                            key={s.id}
                            type="button"
                            variant={active ? "default" : "outline"}
                            size="sm"
                            className="gap-2"
                            onClick={() => handlePickStatus(s.id)}
                          >
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.name}
                            {has ? <span className="ml-1 text-[10px] opacity-70">(mapped)</span> : null}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="act-url">URL</Label>
                    <Input id="act-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/endpoint" />
                    <div className="flex gap-2">
                      <Button type="button" variant={method === "POST" ? "default" : "outline"} size="sm" onClick={() => setMethod("POST")}>
                        POST
                      </Button>
                      <Button type="button" variant={method === "GET" ? "default" : "outline"} size="sm" onClick={() => setMethod("GET")}>
                        GET
                      </Button>
                      <Button type="button" className="ml-auto gap-2" onClick={() => void handleSave()} disabled={saving || !selectedStatusId}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Save mapping
                      </Button>
                    </div>
                    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
                      <Checkbox
                        id="act-proxy"
                        checked={useServerProxy}
                        onCheckedChange={(v) => setUseServerProxy(v === true)}
                      />
                      <div className="space-y-1">
                        <Label htmlFor="act-proxy" className="cursor-pointer font-medium leading-none">
                          Fetch via server proxy (browser-like headers)
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Runs the request from this app with browser User-Agent and related headers. Useful when the API blocks non-browser clients.
                          Does not bypass interactive Cloudflare challenges.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="act-payload">payload_template (JSON)</Label>
                    <Textarea id="act-payload" value={payloadTemplate} onChange={(e) => setPayloadTemplate(e.target.value)} rows={12} className="font-mono text-xs" />
                    <p className="text-xs text-muted-foreground">
                      {method === "GET" ? (
                        <>
                          For GET, each key becomes a query parameter on the URL. Leave empty or use <code>{"{}"}</code> if you do not need placeholders beyond what is already in the URL.
                        </>
                      ) : (
                        <>Sent as the JSON body. Empty field is saved as <code>{"{}"}</code>.</>
                      )}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>response_map</Label>
                    <div className="space-y-2 rounded-md border border-border p-3">
                      {responseMapEntries.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No mappings yet. Add one row below.</p>
                      ) : (
                        responseMapEntries.map((entry, index) => (
                          <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                            <Input
                              value={entry.target}
                              onChange={(e) =>
                                setResponseMapEntries((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, target: e.target.value } : item)),
                                )
                              }
                              placeholder="target field (e.g. metadata.remote_url)"
                            />
                            <Input
                              value={entry.jsonPath}
                              onChange={(e) =>
                                setResponseMapEntries((prev) =>
                                  prev.map((item, i) => (i === index ? { ...item, jsonPath: e.target.value } : item)),
                                )
                              }
                              placeholder="JSONPath (e.g. $.url)"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => setResponseMapEntries((prev) => prev.filter((_, i) => i !== index))}
                              title="Remove mapping row"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() =>
                          setResponseMapEntries((prev) => [...prev, { target: "", jsonPath: "" }])
                        }
                      >
                        <Plus className="h-4 w-4" />
                        Add response mapping
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Keys can be <code>metadata.foo</code> or a contact column: <code>custom_name</code>, <code>whatsapp_name</code>, <code>avatar_url</code>.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="act-message-template">Message template (optional)</Label>
                  <Textarea
                    id="act-message-template"
                    value={messageTemplate}
                    onChange={(e) => setMessageTemplate(e.target.value)}
                    rows={4}
                    placeholder="Hi, URL: {{received.url}} | User: {{received.username}}"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use <code>{"{{received.field}}"}</code> for API response values and <code>{"{{given.conversationId}}"}</code>, <code>{"{{given.tagName}}"}</code>,{" "}
                    <code>{"{{given.payload.someKey}}"}</code> for request/context values. When action runs, this rendered text is pushed to the chat message box unless auto-send is enabled.
                  </p>
                  <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
                    <Checkbox
                      id="act-auto-send"
                      checked={autoSendMessage}
                      onCheckedChange={(v) => setAutoSendMessage(v === true)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor="act-auto-send" className="cursor-pointer font-medium leading-none">
                        Auto-send this message after action runs
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Sends from the server using your configured provider, so it works even if you close the browser.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Existing mappings</CardTitle>
                <CardDescription>One mapping per tag.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {actions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No mappings yet.</p>
                ) : (
                  actions.map((a) => {
                    const status = statuses.find((s) => s.id === a.status_id);
                    return (
                      <div key={a.id} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {status ? (
                              <>
                                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                                <span className="text-sm font-medium">{status.name}</span>
                              </>
                            ) : (
                              <span className="text-sm font-medium">{a.tag_name || "Tag"}</span>
                            )}
                            <span className="text-xs text-muted-foreground">{a.method}</span>
                            {a.use_server_proxy ? (
                              <span className="text-[10px] rounded border border-border px-1.5 py-0.5 text-muted-foreground">
                                server proxy
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{a.url}</p>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => handlePickStatus(a.status_id ?? "")} disabled={!a.status_id}>
                          Edit
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => void handleDelete(a.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

