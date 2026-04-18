import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim());
}

function cleanName(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 120) : "";
}

function cleanRule(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, 4000) : "";
}

function cleanRuleMode(v: unknown): "ai" | "hard" {
  return v === "hard" ? "hard" : "ai";
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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  if ("name" in b) {
    const name = cleanName(b.name);
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    update.name = name;
  }
  if ("color" in b) {
    const color = typeof b.color === "string" ? b.color.trim() : "";
    if (!isHexColor(color)) {
      return NextResponse.json(
        { error: "Color must be a hex value like #10b981." },
        { status: 400 },
      );
    }
    update.color = color;
  }
  if ("rule" in b) {
    update.rule = cleanRule(b.rule);
  }
  if ("rule_mode" in b) {
    update.rule_mode = cleanRuleMode(b.rule_mode);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("contact_statuses")
    .update(update)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("id, name, color, rule, rule_mode, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ status: data });
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

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("contact_statuses")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

