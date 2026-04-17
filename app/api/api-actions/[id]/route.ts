import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function cleanMethod(v: unknown): "GET" | "POST" {
  return v === "GET" ? "GET" : "POST";
}

function cleanUseServerProxy(v: unknown): boolean {
  return v === true || v === "true";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
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

  const update: Record<string, unknown> = {};
  if ("status_id" in b) update.status_id = typeof b.status_id === "string" ? b.status_id : null;
  if ("tag_name" in b) update.tag_name = typeof b.tag_name === "string" ? b.tag_name.trim().slice(0, 120) : "";
  if ("url" in b) update.url = typeof b.url === "string" ? b.url.trim() : "";
  if ("method" in b) update.method = cleanMethod(b.method);
  if ("payload_template" in b) update.payload_template = b.payload_template ?? {};
  if ("response_map" in b) update.response_map = b.response_map ?? {};
  if ("use_server_proxy" in b) update.use_server_proxy = cleanUseServerProxy(b.use_server_proxy);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("api_actions")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, owner_id, status_id, tag_name, url, method, payload_template, response_map, use_server_proxy, created_at, updated_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ action: data });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("api_actions").delete().eq("id", id).eq("owner_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

