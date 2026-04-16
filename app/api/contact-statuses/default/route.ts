import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function isMissingColumnError(e: unknown, columnName: string): boolean {
  if (!e || typeof e !== "object") return false;
  const anyErr = e as { code?: string; message?: string; details?: string; hint?: string };
  const msg = `${anyErr.message ?? ""} ${anyErr.details ?? ""} ${anyErr.hint ?? ""}`.toLowerCase();
  return anyErr.code === "42703" || msg.includes(columnName.toLowerCase());
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
    .from("user_settings")
    .select("default_contact_status_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // Backward-compatible: if DB migration not applied yet, don't crash the app.
    if (isMissingColumnError(error, "default_contact_status_id")) {
      return NextResponse.json({
        default_status_id: null,
        warning:
          "Missing column user_settings.default_contact_status_id. Apply sql/user_settings_default_contact_status.sql",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    default_status_id: data?.default_contact_status_id ?? null,
  });
}

export async function PUT(request: NextRequest) {
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
  const statusId = typeof b.default_status_id === "string" ? b.default_status_id : null;

  if (!statusId) {
    const { error } = await supabase
      .from("user_settings")
      .upsert(
        { id: user.id, default_contact_status_id: null, updated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (error) {
      if (isMissingColumnError(error, "default_contact_status_id")) {
        return NextResponse.json(
          {
            error:
              "Missing column user_settings.default_contact_status_id. Apply sql/user_settings_default_contact_status.sql",
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ default_status_id: null });
  }

  // Validate ownership of the status
  const { data: owned, error: ownedError } = await supabase
    .from("contact_statuses")
    .select("id")
    .eq("id", statusId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (ownedError) {
    return NextResponse.json({ error: ownedError.message }, { status: 500 });
  }
  if (!owned) {
    return NextResponse.json({ error: "Invalid default_status_id." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert(
      {
        id: user.id,
        default_contact_status_id: statusId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

  if (error) {
    if (isMissingColumnError(error, "default_contact_status_id")) {
      return NextResponse.json(
        {
          error:
            "Missing column user_settings.default_contact_status_id. Apply sql/user_settings_default_contact_status.sql",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ default_status_id: statusId });
}

