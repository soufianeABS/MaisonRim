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

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("contact_statuses")
    .select("id, name, color, rule, rule_mode, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ statuses: data ?? [] });
}

export async function POST(request: NextRequest) {
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

  const name = cleanName(b.name);
  const color = typeof b.color === "string" ? b.color.trim() : "";
  const rule = cleanRule(b.rule);
  const ruleMode = b.rule_mode === "hard" ? "hard" : "ai";

  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!isHexColor(color)) {
    return NextResponse.json(
      { error: "Color must be a hex value like #22c55e." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("contact_statuses")
    .insert({
      owner_id: user.id,
      name,
      color,
      rule,
      rule_mode: ruleMode,
    })
    .select("id, name, color, rule, rule_mode, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: data });
}

