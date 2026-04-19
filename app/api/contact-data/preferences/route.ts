import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const MAX_LEN = 200;

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
    .select("contact_data_default_field_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error, "contact_data_default_field_name")) {
      return NextResponse.json({
        default_field_name: "",
        warning:
          "Missing column user_settings.contact_data_default_field_name. Apply sql/user_settings_contact_data_default_field.sql",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = data?.contact_data_default_field_name;
  const default_field_name =
    typeof raw === "string" ? raw.slice(0, MAX_LEN) : "";

  return NextResponse.json({ default_field_name });
}

export async function PATCH(request: NextRequest) {
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
  let default_field_name = "";
  if (b.default_field_name === null || b.default_field_name === undefined) {
    default_field_name = "";
  } else if (typeof b.default_field_name === "string") {
    default_field_name = b.default_field_name.trim().slice(0, MAX_LEN);
  } else {
    return NextResponse.json({ error: "default_field_name must be a string or null." }, { status: 400 });
  }

  const { error } = await supabase.from("user_settings").upsert(
    {
      id: user.id,
      contact_data_default_field_name: default_field_name || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    if (isMissingColumnError(error, "contact_data_default_field_name")) {
      return NextResponse.json(
        {
          error:
            "Missing column user_settings.contact_data_default_field_name. Apply sql/user_settings_contact_data_default_field.sql",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ default_field_name });
}
