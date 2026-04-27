import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function cleanMethod(v: unknown): "GET" | "POST" {
  return v === "GET" ? "GET" : "POST";
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("api_actions")
    .select("id, owner_id, status_id, tag_name, action_name, url, method, payload_template, response_map, message_template, auto_send_message, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ actions: data ?? [] });
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
  const b = body as Record<string, unknown>;

  const statusId = typeof b.status_id === "string" ? b.status_id : null;
  const tagName = typeof b.tag_name === "string" ? b.tag_name.trim().slice(0, 120) : "";
  const actionName = typeof b.action_name === "string" ? b.action_name.trim().slice(0, 120) : "";
  const url = typeof b.url === "string" ? b.url.trim() : "";
  const method = cleanMethod(b.method);
  const payloadTemplate = b.payload_template ?? {};
  const responseMap = b.response_map ?? {};
  const messageTemplate = typeof b.message_template === "string" ? b.message_template : "";
  const autoSendMessage = b.auto_send_message === true || b.auto_send_message === "true";

  if (!statusId && !tagName) {
    return NextResponse.json({ error: "status_id or tag_name is required" }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("api_actions")
    .insert({
      owner_id: user.id,
      status_id: statusId,
      tag_name: tagName,
      action_name: actionName,
      url,
      method,
      payload_template: payloadTemplate,
      response_map: responseMap,
      message_template: messageTemplate,
      auto_send_message: autoSendMessage,
    })
    .select("id, owner_id, status_id, tag_name, action_name, url, method, payload_template, response_map, message_template, auto_send_message, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ action: data });
}

