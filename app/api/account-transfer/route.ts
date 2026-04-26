import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { buildReplyAgentInsertRow } from "@/app/api/reply-agents/shared";

type SectionKey =
  | "savedMessages"
  | "replyAgents"
  | "themeColors"
  | "translation"
  | "imagePrompts"
  | "statuses"
  | "dynamicActions";

const ALL_SECTIONS: SectionKey[] = [
  "savedMessages",
  "replyAgents",
  "themeColors",
  "translation",
  "imagePrompts",
  "statuses",
  "dynamicActions",
];

type ExportBundle = {
  version: 1;
  sourceApp: "WaChat";
  exportedAt: string;
  sections: SectionKey[];
  payload: {
    savedMessages?: Array<{ title: string; body: string; sort_order: number }>;
    replyAgents?: Array<{
      name: string;
      persona: string;
      task: string;
      output_rules: string[];
      business_rules: string[];
      system_prompt: string;
      temperature: number;
      max_output_tokens: number;
    }>;
    themeColors?: { light?: Record<string, string>; dark?: Record<string, string> } | null;
    translation?: { translation_target_language: string | null; translation_enabled: boolean };
    imagePrompts?: Array<{ name: string; prompt: string; expected_json: string }>;
    statuses?: Array<{ old_id: string; name: string; color: string; rule: string; rule_mode: "ai" | "hard" }>;
    dynamicActions?: Array<{
      action_name: string;
      status_old_id: string | null;
      tag_name: string;
      url: string;
      method: "GET" | "POST";
      payload_template: unknown;
      response_map: unknown;
      message_template: string;
      auto_send_message: boolean;
      use_server_proxy: boolean;
    }>;
  };
};

function parseSections(raw: unknown): SectionKey[] {
  if (!Array.isArray(raw)) return [...ALL_SECTIONS];
  const picked = raw.filter((x): x is SectionKey => typeof x === "string" && ALL_SECTIONS.includes(x as SectionKey));
  return picked.length ? picked : [...ALL_SECTIONS];
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asStringRecord(v: unknown): Record<string, string> {
  const obj = asObject(v);
  if (!obj) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function asBool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const obj = asObject(body);
  if (!obj) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const mode = obj.mode === "import" ? "import" : "export";
  if (mode === "export") {
    const sections = parseSections(obj.sections);
    const payload: ExportBundle["payload"] = {};

    if (sections.includes("savedMessages")) {
      const { data } = await supabase
        .from("saved_chat_messages")
        .select("title, body, sort_order")
        .eq("owner_id", user.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      payload.savedMessages = (data ?? []).map((x) => ({
        title: asString((x as Record<string, unknown>).title).trim(),
        body: asString((x as Record<string, unknown>).body),
        sort_order: Number((x as Record<string, unknown>).sort_order ?? 0) || 0,
      }));
    }

    if (sections.includes("replyAgents")) {
      const { data } = await supabase
        .from("reply_agents")
        .select("name, persona, task, output_rules, business_rules, system_prompt, temperature, max_output_tokens")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      payload.replyAgents = (data ?? []).map((x) => {
        const row = x as Record<string, unknown>;
        return {
          name: asString(row.name).trim(),
          persona: asString(row.persona),
          task: asString(row.task),
          output_rules: Array.isArray(row.output_rules) ? row.output_rules.map((r) => String(r).trim()).filter(Boolean) : [],
          business_rules: Array.isArray(row.business_rules) ? row.business_rules.map((r) => String(r).trim()).filter(Boolean) : [],
          system_prompt: asString(row.system_prompt),
          temperature: Number(row.temperature ?? 0.65) || 0.65,
          max_output_tokens: Number(row.max_output_tokens ?? 512) || 512,
        };
      });
    }

    if (sections.includes("themeColors") || sections.includes("translation")) {
      const { data } = await supabase
        .from("user_settings")
        .select("theme_custom_colors, translation_target_language, translation_enabled")
        .eq("id", user.id)
        .maybeSingle();
      const settings = (data ?? {}) as Record<string, unknown>;
      if (sections.includes("themeColors")) {
        const theme = asObject(settings.theme_custom_colors);
        payload.themeColors = theme
          ? {
              light: asStringRecord(theme.light),
              dark: asStringRecord(theme.dark),
            }
          : null;
      }
      if (sections.includes("translation")) {
        payload.translation = {
          translation_target_language: asString(settings.translation_target_language).trim() || null,
          translation_enabled: asBool(settings.translation_enabled, true),
        };
      }
    }

    if (sections.includes("imagePrompts")) {
      const { data } = await supabase
        .from("image_prompts")
        .select("name, prompt, expected_json")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      payload.imagePrompts = (data ?? []).map((x) => {
        const row = x as Record<string, unknown>;
        return {
          name: asString(row.name).trim(),
          prompt: asString(row.prompt),
          expected_json: asString(row.expected_json),
        };
      });
    }

    if (sections.includes("statuses") || sections.includes("dynamicActions")) {
      const { data: statuses } = await supabase
        .from("contact_statuses")
        .select("id, name, color, rule, rule_mode")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false });

      if (sections.includes("statuses")) {
        payload.statuses = (statuses ?? []).map((x) => {
          const row = x as Record<string, unknown>;
          return {
            old_id: asString(row.id),
            name: asString(row.name).trim(),
            color: asString(row.color).trim(),
            rule: asString(row.rule),
            rule_mode: row.rule_mode === "hard" ? "hard" : "ai",
          };
        });
      }

      if (sections.includes("dynamicActions")) {
        const { data: actions } = await supabase
          .from("api_actions")
          .select("action_name, status_id, tag_name, url, method, payload_template, response_map, message_template, auto_send_message, use_server_proxy")
          .eq("owner_id", user.id)
          .order("updated_at", { ascending: false });
        payload.dynamicActions = (actions ?? []).map((x) => {
          const row = x as Record<string, unknown>;
          return {
            action_name: asString(row.action_name).trim(),
            status_old_id: asString(row.status_id).trim() || null,
            tag_name: asString(row.tag_name).trim(),
            url: asString(row.url).trim(),
            method: row.method === "GET" ? "GET" : "POST",
            payload_template: row.payload_template ?? {},
            response_map: row.response_map ?? {},
            message_template: asString(row.message_template),
            auto_send_message: asBool(row.auto_send_message, false),
            use_server_proxy: asBool(row.use_server_proxy, false),
          };
        });
      }
    }

    const bundle: ExportBundle = {
      version: 1,
      sourceApp: "WaChat",
      exportedAt: new Date().toISOString(),
      sections,
      payload,
    };
    return NextResponse.json({ bundle });
  }

  const file = asObject(obj.file);
  if (!file) return NextResponse.json({ error: "file is required for import mode." }, { status: 400 });
  const sections = parseSections(obj.sections);
  const payload = asObject(file.payload) ?? {};
  const imported: Record<string, number> = {};

  const importedStatusesByOldId = new Map<string, string>();
  if (sections.includes("statuses")) {
    const rawStatuses = Array.isArray(payload.statuses) ? payload.statuses : [];
    const statusRows = rawStatuses
      .map((x) => asObject(x))
      .filter((x): x is Record<string, unknown> => Boolean(x))
      .map((row) => ({
        old_id: asString(row.old_id),
        name: asString(row.name).trim().slice(0, 120),
        color: asString(row.color).trim(),
        rule: asString(row.rule).slice(0, 4000),
        rule_mode: row.rule_mode === "hard" ? "hard" : "ai",
      }))
      .filter((row) => row.name && /^#[0-9a-fA-F]{6}$/.test(row.color));

    if (statusRows.length > 0) {
      const { data: inserted, error } = await supabase
        .from("contact_statuses")
        .insert(statusRows.map((s) => ({ owner_id: user.id, name: s.name, color: s.color, rule: s.rule, rule_mode: s.rule_mode })))
        .select("id, name, color");
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      imported.statuses = inserted?.length ?? 0;

      // best-effort old->new mapping by position for newly imported statuses
      for (let i = 0; i < statusRows.length; i++) {
        const oldId = statusRows[i]?.old_id;
        const newId = (inserted?.[i] as Record<string, unknown> | undefined)?.id;
        if (oldId && typeof newId === "string") {
          importedStatusesByOldId.set(oldId, newId);
        }
      }
    } else {
      imported.statuses = 0;
    }
  }

  if (sections.includes("dynamicActions") && importedStatusesByOldId.size === 0) {
    const rawStatuses = Array.isArray(payload.statuses) ? payload.statuses : [];
    const byOldId = new Map<string, { name: string; color: string }>();
    for (const item of rawStatuses) {
      const row = asObject(item);
      if (!row) continue;
      const oldId = asString(row.old_id).trim();
      const name = asString(row.name).trim();
      const color = asString(row.color).trim();
      if (!oldId || !name || !color) continue;
      byOldId.set(oldId, { name, color });
    }
    if (byOldId.size > 0) {
      const { data: existingStatuses } = await supabase
        .from("contact_statuses")
        .select("id, name, color")
        .eq("owner_id", user.id);
      for (const existing of existingStatuses ?? []) {
        const row = existing as Record<string, unknown>;
        const existingId = asString(row.id);
        const existingName = asString(row.name).trim();
        const existingColor = asString(row.color).trim();
        for (const [oldId, source] of byOldId.entries()) {
          if (source.name === existingName && source.color === existingColor) {
            importedStatusesByOldId.set(oldId, existingId);
          }
        }
      }
    }
  }

  if (sections.includes("savedMessages")) {
    const rawMessages = Array.isArray(payload.savedMessages) ? payload.savedMessages : [];
    const rows = rawMessages
      .map((x) => asObject(x))
      .filter((x): x is Record<string, unknown> => Boolean(x))
      .map((row) => ({
        owner_id: user.id,
        title: asString(row.title).trim().slice(0, 120),
        body: asString(row.body).trim().slice(0, 10000),
        sort_order: Number(row.sort_order ?? 0) || 0,
      }))
      .filter((row) => row.title && row.body);
    if (rows.length > 0) {
      const { error } = await supabase.from("saved_chat_messages").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    imported.savedMessages = rows.length;
  }

  if (sections.includes("replyAgents")) {
    const rawAgents = Array.isArray(payload.replyAgents) ? payload.replyAgents : [];
    const rows = rawAgents
      .map((x) => asObject(x))
      .filter((x): x is Record<string, unknown> => Boolean(x))
      .map((agent) =>
        buildReplyAgentInsertRow(user.id, {
          name: asString(agent.name).trim().slice(0, 120),
          persona: asString(agent.persona),
          task: asString(agent.task),
          output_rules: Array.isArray(agent.output_rules) ? agent.output_rules.map((r) => String(r).trim()).filter(Boolean) : [],
          business_rules: Array.isArray(agent.business_rules) ? agent.business_rules.map((r) => String(r).trim()).filter(Boolean) : [],
          system_prompt: asString(agent.system_prompt),
          temperature: Number(agent.temperature ?? 0.65) || 0.65,
          max_output_tokens: Number(agent.max_output_tokens ?? 512) || 512,
        }),
      )
      .filter((row) => row.name);
    if (rows.length > 0) {
      const { error } = await supabase.from("reply_agents").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    imported.replyAgents = rows.length;
  }

  if (sections.includes("themeColors")) {
    const theme = asObject(payload.themeColors);
    const { error } = await supabase.from("user_settings").upsert(
      {
        id: user.id,
        theme_custom_colors: theme
          ? {
              light: asStringRecord(theme.light),
              dark: asStringRecord(theme.dark),
            }
          : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    imported.themeColors = 1;
  }

  if (sections.includes("translation")) {
    const translation = asObject(payload.translation);
    if (translation) {
      const { error } = await supabase.from("user_settings").upsert(
        {
          id: user.id,
          translation_target_language: asString(translation.translation_target_language).trim() || null,
          translation_enabled: asBool(translation.translation_enabled, true),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      imported.translation = 1;
    } else {
      imported.translation = 0;
    }
  }

  if (sections.includes("imagePrompts")) {
    const rawPrompts = Array.isArray(payload.imagePrompts) ? payload.imagePrompts : [];
    const rows = rawPrompts
      .map((x) => asObject(x))
      .filter((x): x is Record<string, unknown> => Boolean(x))
      .map((row) => ({
        user_id: user.id,
        name: asString(row.name).trim().slice(0, 120),
        prompt: asString(row.prompt).trim().slice(0, 16000),
        expected_json: asString(row.expected_json).trim().slice(0, 16000),
      }))
      .filter((row) => row.name && row.prompt && row.expected_json);
    if (rows.length > 0) {
      const { error } = await supabase.from("image_prompts").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    imported.imagePrompts = rows.length;
  }

  if (sections.includes("dynamicActions")) {
    const rawActions = Array.isArray(payload.dynamicActions) ? payload.dynamicActions : [];
    const rows = rawActions
      .map((x) => asObject(x))
      .filter((x): x is Record<string, unknown> => Boolean(x))
      .map((row) => ({
        owner_id: user.id,
        action_name: asString(row.action_name).trim().slice(0, 120),
        status_id: (() => {
          const oldId = asString(row.status_old_id).trim();
          if (!oldId) return null;
          return importedStatusesByOldId.get(oldId) ?? null;
        })(),
        tag_name: asString(row.tag_name).trim().slice(0, 120),
        url: asString(row.url).trim(),
        method: row.method === "GET" ? "GET" : "POST",
        payload_template: row.payload_template ?? {},
        response_map: row.response_map ?? {},
        message_template: asString(row.message_template),
        auto_send_message: asBool(row.auto_send_message, false),
        use_server_proxy: asBool(row.use_server_proxy, false),
      }))
      .filter((row) => row.url && (row.status_id || row.tag_name));
    if (rows.length > 0) {
      const { error } = await supabase.from("api_actions").insert(rows);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    imported.dynamicActions = rows.length;
  }

  return NextResponse.json({ success: true, imported });
}
