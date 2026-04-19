import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (typeof body.field_key === "string") {
      const field_key = body.field_key.trim();
      if (!field_key) {
        return NextResponse.json({ error: "field_key cannot be empty" }, { status: 400 });
      }
      patch.field_key = field_key;
    }
    if (typeof body.field_value === "string") {
      if (body.field_value.length > 8000) {
        return NextResponse.json({ error: "field_value too long" }, { status: 400 });
      }
      patch.field_value = body.field_value;
    }

    const { data, error } = await supabase
      .from("contact_data_entries")
      .update(patch)
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id, contact_phone, field_key, field_value, created_at, updated_at")
      .single();

    if (error) {
      console.error("contact-data/entries PATCH:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update" },
        { status: 500 },
      );
    }

    return NextResponse.json({ entry: data });
  } catch (e) {
    console.error("contact-data/entries PATCH:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { error } = await supabase
      .from("contact_data_entries")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id);

    if (error) {
      console.error("contact-data/entries DELETE:", error);
      return NextResponse.json(
        { error: error.message || "Failed to delete" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("contact-data/entries DELETE:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
