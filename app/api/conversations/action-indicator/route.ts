import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (!isRecord(next)) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function deletePath(target: Record<string, unknown>, path: string) {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (!isRecord(next)) return;
    cur = next;
  }
  delete cur[parts[parts.length - 1]!];
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
  const contactId = typeof b.contactId === "string" ? b.contactId.trim() : "";
  const status = b.status === "success" || b.status === "error" ? b.status : null;

  if (!contactId) return NextResponse.json({ error: "contactId is required" }, { status: 400 });

  const { data: row, error: getError } = await supabase
    .from("contacts")
    .select("metadata")
    .eq("owner_id", user.id)
    .eq("phone", contactId)
    .maybeSingle();

  if (getError) return NextResponse.json({ error: getError.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  const metadata = isRecord(row.metadata) ? { ...(row.metadata as Record<string, unknown>) } : {};
  if (status) {
    setPath(metadata, "ui.action_indicator", {
      status,
      updated_at: new Date().toISOString(),
    });
  } else {
    deletePath(metadata, "ui.action_indicator");
    deletePath(metadata, "ui.dynamic_action_running");
  }

  const { error: updateError } = await supabase
    .from("contacts")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("owner_id", user.id)
    .eq("phone", contactId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

