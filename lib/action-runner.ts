import { JSONPath } from "jsonpath-plus";

import { createClient } from "@/lib/supabase/server";
import { sendTextMessage } from "@/lib/send-text-message";

type HttpMethod = "GET" | "POST";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type ApiActionRow = {
  id: string;
  owner_id: string;
  status_id: string | null;
  tag_name: string;
  action_name?: string | null;
  url: string;
  method: HttpMethod;
  payload_template: unknown;
  response_map: unknown;
  message_template?: string | null;
  auto_send_message?: boolean | null;
};

type MappingTrace = {
  target: string;
  source: string;
  value: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function deepReplacePlaceholders(input: unknown, ctx: Record<string, string>): unknown {
  if (typeof input === "string") {
    return input.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (m, key) => {
      const k = String(key);
      return Object.prototype.hasOwnProperty.call(ctx, k) ? String(ctx[k]) : m;
    });
  }
  if (Array.isArray(input)) return input.map((x) => deepReplacePlaceholders(x, ctx));
  if (isRecord(input)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = deepReplacePlaceholders(v, ctx);
    return out;
  }
  return input;
}

function safeJSONPathValue(response: unknown, path: string): unknown {
  const rawPath = path.trim();
  if (!rawPath) return null;

  const candidates = rawPath.startsWith("$")
    ? [rawPath]
    : [`$.${rawPath}`, `$[0].${rawPath}`, rawPath];

  for (const candidate of candidates) {
    try {
      const out: unknown = JSONPath({ path: candidate, json: response as JsonValue });
      const arr = Array.isArray(out) ? out : [out];
      if (arr.length > 0 && arr[0] !== undefined) {
        return arr[0];
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function setMetadataPath(metadata: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = metadata;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (!isRecord(next)) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function deleteMetadataPath(metadata: Record<string, unknown>, path: string) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = metadata;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (!isRecord(next)) return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]!];
}

function readPath(source: unknown, path: string): unknown {
  if (!path.trim()) return source;
  const parts = path.split(".").filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    if (!isRecord(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function stringifyContactDataValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function renderMessageTemplate(params: {
  template: string;
  given: Record<string, unknown>;
  received: unknown;
  mapped: Record<string, unknown>;
}): string {
  return params.template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, expression) => {
    const expr = String(expression ?? "").trim();
    if (!expr) return "";

    if (expr === "given") return stringifyTemplateValue(params.given);
    if (expr === "received") return stringifyTemplateValue(params.received);
    if (expr.startsWith("given.")) return stringifyTemplateValue(readPath(params.given, expr.slice("given.".length)));
    if (expr.startsWith("received.")) return stringifyTemplateValue(readPath(params.received, expr.slice("received.".length)));

    // First priority: exact response_map key entered by the user.
    if (Object.prototype.hasOwnProperty.call(params.mapped, expr)) {
      return stringifyTemplateValue(params.mapped[expr]);
    }

    // Bare placeholders are treated as API response paths for simple templates.
    const direct = readPath(params.received, expr);
    if (direct !== undefined && direct !== null) return stringifyTemplateValue(direct);

    const byJsonPath = safeJSONPathValue(params.received, expr);
    if (byJsonPath !== undefined && byJsonPath !== null) return stringifyTemplateValue(byJsonPath);

    return "";
  });
}

async function persistContactActionIndicatorError(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  phone: string,
): Promise<void> {
  try {
    const { data: row, error } = await supabase
      .from("contacts")
      .select("metadata")
      .eq("owner_id", ownerId)
      .eq("phone", phone)
      .maybeSingle();
    if (error || !row) return;
    const meta = isRecord(row.metadata) ? { ...(row.metadata as Record<string, unknown>) } : {};
    deleteMetadataPath(meta, "ui.dynamic_action_running");
    setMetadataPath(meta, "ui.action_indicator", {
      status: "error",
      updated_at: new Date().toISOString(),
    });
    await supabase
      .from("contacts")
      .update({ metadata: meta, updated_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .eq("phone", phone);
  } catch {
    // ignore
  }
}

async function logActionError(params: {
  ownerId: string;
  contactId?: string | null;
  actionId?: string | null;
  tagName?: string | null;
  message: string;
  details?: Record<string, unknown>;
}) {
  try {
    const supabase = await createClient();
    await supabase.from("action_logs").insert({
      owner_id: params.ownerId,
      contact_id: params.contactId ?? null,
      action_id: params.actionId ?? null,
      tag_name: params.tagName ?? null,
      level: "error",
      message: params.message,
      details: params.details ?? {},
    });
  } catch {
    // ignore (logging should never crash caller)
  }
}

export class ActionRunner {
  static async run(params: { conversationId: string; tagName?: string; statusId?: string | null; actionId?: string | null }) {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    const contactId = params.conversationId;
    const statusId = params.statusId ?? null;
    const tagName = params.tagName ?? "";
    const actionId = params.actionId ?? null;

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("phone, owner_id, metadata")
      .eq("owner_id", user.id)
      .eq("phone", contactId)
      .single();

    if (contactError || !contact) {
      throw new Error("Conversation not found");
    }

    // Find action (prefer explicit actionId, then status_id, then tag_name)
    let action: ApiActionRow | null = null;
    if (actionId) {
      const { data } = await supabase
        .from("api_actions")
        .select("id, owner_id, status_id, tag_name, action_name, url, method, payload_template, response_map, message_template, auto_send_message")
        .eq("owner_id", user.id)
        .eq("id", actionId)
        .maybeSingle();
      action = (data as ApiActionRow | null) ?? null;
    }
    if (!action && statusId) {
      const { data } = await supabase
        .from("api_actions")
        .select("id, owner_id, status_id, tag_name, action_name, url, method, payload_template, response_map, message_template, auto_send_message")
        .eq("owner_id", user.id)
        .eq("status_id", statusId)
        .order("updated_at", { ascending: false })
        .limit(1);
      action = (data?.[0] as ApiActionRow | undefined) ?? null;
    }
    if (!action && tagName) {
      const { data } = await supabase
        .from("api_actions")
        .select("id, owner_id, status_id, tag_name, action_name, url, method, payload_template, response_map, message_template, auto_send_message")
        .eq("owner_id", user.id)
        .ilike("tag_name", tagName)
        .order("updated_at", { ascending: false })
        .limit(1);
      action = (data?.[0] as ApiActionRow | undefined) ?? null;
    }

    if (!action) {
      throw new Error("No ApiAction configured for this tag");
    }

    // Load user_settings as placeholder source
    const { data: settings } = await supabase
      .from("user_settings")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    const ctx: Record<string, string> = {
      conversationId: contactId,
      contactId,
      ownerId: user.id,
      tagName: tagName || action.tag_name,
    };
    if (settings && isRecord(settings)) {
      for (const [k, v] of Object.entries(settings)) {
        if (v === null || v === undefined) continue;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          ctx[`settings.${k}`] = String(v);
        }
      }
    }

    const payload = deepReplacePlaceholders(action.payload_template, ctx);
    const mappingTrace: MappingTrace[] = [];

    // Other browsers/tabs: list spinner via DB + Realtime until this run finishes.
    const inflightMeta = isRecord(contact.metadata)
      ? { ...(contact.metadata as Record<string, unknown>) }
      : {};
    setMetadataPath(inflightMeta, "ui.dynamic_action_running", {
      started_at: new Date().toISOString(),
      action_id: action.id,
    });
    await supabase
      .from("contacts")
      .update({ metadata: inflightMeta, updated_at: new Date().toISOString() })
      .eq("owner_id", user.id)
      .eq("phone", contactId);

    let responseJson: unknown;
    try {
      const method = action.method || "POST";
      let finalUrl = action.url;
      let requestPayload: unknown = null;

      const res = await (async () => {
        if (method === "GET") {
          const u = new URL(action.url);
          if (isRecord(payload)) {
            for (const [k, v] of Object.entries(payload)) {
              if (v === undefined) continue;
              if (v === null) continue;
              u.searchParams.set(k, String(v));
            }
          }
          finalUrl = u.toString();
          requestPayload = payload;
          return await fetch(finalUrl, { method: "GET" });
        }
        finalUrl = action.url;
        requestPayload = payload ?? {};
        return await fetch(action.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload ?? {}),
        });
      })();

      const text = await res.text();
      try {
        responseJson = text ? JSON.parse(text) : null;
      } catch {
        responseJson = { raw: text };
      }

      if (!res.ok) {
        await logActionError({
          ownerId: user.id,
          contactId,
          actionId: action.id,
          tagName: tagName || action.tag_name,
          message: `API call failed (${res.status})`,
          details: {
            url: action.url,
            finalUrl,
            method,
            payload: requestPayload,
            response: responseJson,
            mappingUsed: mappingTrace,
            status: res.status,
          },
        });
        throw new Error(`API call failed (${res.status})`);
      }
    } catch (e) {
      await persistContactActionIndicatorError(supabase, user.id, contactId);
      // If we already logged the non-2xx failure above, don't duplicate logs.
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.toLowerCase().startsWith("api call failed")) {
        await logActionError({
          ownerId: user.id,
          contactId,
          actionId: action.id,
          tagName: tagName || action.tag_name,
          message: "API call threw",
          details: {
            url: action.url,
            method: action.method,
            payload,
            mappingUsed: mappingTrace,
            error: msg,
          },
        });
      }
      throw e instanceof Error ? e : new Error("API call failed");
    }

    // Merge onto latest metadata so we don't drop ui.dynamic_action_running written at start.
    const { data: contactLatest, error: contactLatestError } = await supabase
      .from("contacts")
      .select("metadata")
      .eq("owner_id", user.id)
      .eq("phone", contactId)
      .single();
    if (contactLatestError || !contactLatest) {
      throw new Error("Conversation not found");
    }
    const currentMeta = isRecord(contactLatest.metadata)
      ? { ...(contactLatest.metadata as Record<string, unknown>) }
      : {};
    deleteMetadataPath(currentMeta, "ui.dynamic_action_running");

    const actionKey = tagName || action.tag_name || (statusId ?? "unknown");
    setMetadataPath(currentMeta, `actions.${actionKey}.raw_response`, responseJson);
    setMetadataPath(currentMeta, `actions.${actionKey}.ran_at`, new Date().toISOString());

    // Apply response_map
    const update: Record<string, unknown> = {
      metadata: currentMeta,
    };
    const contactDataRows: Array<{
      owner_id: string;
      contact_phone: string;
      field_key: string;
      field_value: string;
    }> = [];
    const mappedTemplateValues: Record<string, unknown> = {};

    const allowedContactColumns = new Set(["custom_name", "whatsapp_name", "avatar_url"]);
    if (isRecord(action.response_map)) {
      for (const [target, jsonPath] of Object.entries(action.response_map)) {
        if (typeof jsonPath !== "string" || !jsonPath.trim()) continue;
        const templateKey = target.trim();
        if (!templateKey) continue;
        const sourceKey = jsonPath.trim();
        const val = safeJSONPathValue(responseJson, sourceKey);
        mappingTrace.push({ target: templateKey, source: sourceKey, value: val });
        mappedTemplateValues[templateKey] = val;
        const normalizedKey = (templateKey.startsWith("metadata.") ? templateKey.slice("metadata.".length) : templateKey).trim();
        if (normalizedKey && normalizedKey !== templateKey) {
          mappedTemplateValues[normalizedKey] = val;
        }
        const asText = stringifyContactDataValue(val).trim();
        if (normalizedKey && asText) {
          contactDataRows.push({
            owner_id: user.id,
            contact_phone: contactId,
            field_key: normalizedKey.slice(0, 200),
            field_value: asText.slice(0, 8000),
          });
        }
        if (templateKey.startsWith("metadata.")) {
          setMetadataPath(currentMeta, templateKey.slice("metadata.".length), val);
        } else if (allowedContactColumns.has(templateKey)) {
          update[templateKey] = val;
        } else {
          // Unknown target -> store under metadata.extracted.<target>
          setMetadataPath(currentMeta, `extracted.${templateKey}`, val);
        }
      }
      update.metadata = currentMeta;
    }

    if (contactDataRows.length > 0) {
      const dedupedByKey = new Map<string, (typeof contactDataRows)[number]>();
      for (const row of contactDataRows) dedupedByKey.set(row.field_key, row);
      const { error: contactDataError } = await supabase
        .from("contact_data_entries")
        .upsert([...dedupedByKey.values()], {
          onConflict: "owner_id,contact_phone,field_key",
        });
      if (contactDataError) {
        await logActionError({
          ownerId: user.id,
          contactId,
          actionId: action.id,
          tagName: tagName || action.tag_name,
          message: "Failed to persist response_map into contact data",
          details: { error: contactDataError.message, mappingUsed: mappingTrace },
        });
      }
    }

    // List UI: survives refresh / other devices (client also POSTs, but server is source of truth).
    setMetadataPath(currentMeta, "ui.action_indicator", {
      status: "success",
      updated_at: new Date().toISOString(),
    });
    update.metadata = currentMeta;

    const { error: updateError } = await supabase
      .from("contacts")
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("owner_id", user.id)
      .eq("phone", contactId);

    if (updateError) {
      await logActionError({
        ownerId: user.id,
        contactId,
        actionId: action.id,
        tagName: tagName || action.tag_name,
        message: "Failed to persist action result",
        details: { updateError: updateError.message, mappingUsed: mappingTrace },
      });
      await persistContactActionIndicatorError(supabase, user.id, contactId);
      throw new Error("Failed to save action result");
    }

    const messageTemplate = (action.message_template ?? "").trim();
    const renderedMessage = messageTemplate
      ? renderMessageTemplate({
          template: messageTemplate,
          given: {
            ...ctx,
            payload,
            method: action.method,
            url: action.url,
          },
          received: responseJson,
          mapped: mappedTemplateValues,
        })
      : "";

    const shouldAutoSend = action.auto_send_message === true;
    if (shouldAutoSend && renderedMessage.trim()) {
      try {
        await sendTextMessage({
          supabase,
          userId: user.id,
          to: contactId,
          message: renderedMessage.trim(),
        });
      } catch (e) {
        await logActionError({
          ownerId: user.id,
          contactId,
          actionId: action.id,
          tagName: tagName || action.tag_name,
          message: "Auto-send message failed",
          details: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    return {
      success: true,
      response: responseJson,
      messageTemplate,
      renderedMessage,
      autoSent: shouldAutoSend,
      mappingUsed: mappingTrace,
      actionId: action.id,
      actionName: (action.action_name ?? "").trim(),
    };
  }
}

