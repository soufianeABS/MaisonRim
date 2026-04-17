import { JSONPath } from "jsonpath-plus";

import { createClient } from "@/lib/supabase/server";
import { fetchWithServerProxy, isLikelyCloudflareChallenge } from "@/lib/server-proxy-fetch";

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
  url: string;
  method: HttpMethod;
  payload_template: unknown;
  response_map: unknown;
  /** When absent (old row), treated as false. */
  use_server_proxy?: boolean | null;
};

type ContactRow = {
  phone: string;
  owner_id: string;
  metadata: unknown;
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
  try {
    const out: unknown = JSONPath({ path, json: response as JsonValue });
    const arr = Array.isArray(out) ? out : [out];
    return arr.length ? arr[0] : null;
  } catch {
    return null;
  }
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
  static async run(params: { conversationId: string; tagName?: string; statusId?: string | null }) {
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

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("phone, owner_id, metadata")
      .eq("owner_id", user.id)
      .eq("phone", contactId)
      .single();

    if (contactError || !contact) {
      throw new Error("Conversation not found");
    }

    // Find action (prefer status_id, fallback to tag_name)
    let action: ApiActionRow | null = null;
    if (statusId) {
      const { data } = await supabase
        .from("api_actions")
        .select("id, owner_id, status_id, tag_name, url, method, payload_template, response_map, use_server_proxy")
        .eq("owner_id", user.id)
        .eq("status_id", statusId)
        .maybeSingle();
      action = (data as ApiActionRow | null) ?? null;
    }
    if (!action && tagName) {
      const { data } = await supabase
        .from("api_actions")
        .select("id, owner_id, status_id, tag_name, url, method, payload_template, response_map, use_server_proxy")
        .eq("owner_id", user.id)
        .ilike("tag_name", tagName)
        .maybeSingle();
      action = (data as ApiActionRow | null) ?? null;
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
    const useProxy = action.use_server_proxy === true;

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
          if (useProxy) {
            return await fetchWithServerProxy({ url: finalUrl, method: "GET" });
          }
          return await fetch(finalUrl, { method: "GET" });
        }
        finalUrl = action.url;
        requestPayload = payload ?? {};
        if (useProxy) {
          return await fetchWithServerProxy({
            url: action.url,
            method: "POST",
            jsonBody: payload ?? {},
          });
        }
        return await fetch(action.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload ?? {}),
        });
      })();

      const text = await res.text();
      // Do not treat our own /api/iptv (Puppeteer) response as a Cloudflare challenge page.
      const isIptvStealthRoute = (() => {
        try {
          const u = new URL(finalUrl);
          return u.pathname === "/api/iptv" || u.pathname.endsWith("/api/iptv");
        } catch {
          return false;
        }
      })();
      if (useProxy && !isIptvStealthRoute && isLikelyCloudflareChallenge(text)) {
        await logActionError({
          ownerId: user.id,
          contactId,
          actionId: action.id,
          tagName: tagName || action.tag_name,
          message: "Cloudflare challenge page returned (server proxy)",
          details: { url: action.url, finalUrl, method },
        });
        throw new Error(
          "Cloudflare block detected. Server-side browser headers were not enough; try a different endpoint or tooling.",
        );
      }
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
            status: res.status,
          },
        });
        throw new Error(`API call failed (${res.status})`);
      }
    } catch (e) {
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
          error: msg,
        },
      });
    }
      throw e instanceof Error ? e : new Error("API call failed");
    }

    // Update contact.metadata with raw response
    const contactRow = contact as unknown as ContactRow;
    const currentMeta = isRecord(contactRow.metadata) ? { ...(contactRow.metadata as Record<string, unknown>) } : {};
    const actionKey = tagName || action.tag_name || (statusId ?? "unknown");
    setMetadataPath(currentMeta, `actions.${actionKey}.raw_response`, responseJson);
    setMetadataPath(currentMeta, `actions.${actionKey}.ran_at`, new Date().toISOString());

    // Apply response_map
    const update: Record<string, unknown> = {
      metadata: currentMeta,
    };

    const allowedContactColumns = new Set(["custom_name", "whatsapp_name", "avatar_url"]);
    if (isRecord(action.response_map)) {
      for (const [target, jsonPath] of Object.entries(action.response_map)) {
        if (typeof jsonPath !== "string" || !jsonPath.trim()) continue;
        const val = safeJSONPathValue(responseJson, jsonPath);
        if (target.startsWith("metadata.")) {
          setMetadataPath(currentMeta, target.slice("metadata.".length), val);
        } else if (allowedContactColumns.has(target)) {
          update[target] = val;
        } else {
          // Unknown target -> store under metadata.extracted.<target>
          setMetadataPath(currentMeta, `extracted.${target}`, val);
        }
      }
      update.metadata = currentMeta;
    }

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
        details: { updateError: updateError.message },
      });
      throw new Error("Failed to save action result");
    }

    return { success: true, response: responseJson };
  }
}

