import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const browse = searchParams.get("browse") === "1";
    const phoneRaw = searchParams.get("phone");

    if (browse) {
      const limit = Math.min(
        500,
        Math.max(1, parseInt(searchParams.get("limit") || "200", 10) || 200),
      );
      const q = searchParams.get("q")?.trim();
      let query = supabase
        .from("contact_data_entries")
        .select("id, contact_phone, field_key, field_value, created_at, updated_at")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (q) {
        const digits = digitsOnly(q);
        if (digits.length >= 3) {
          query = query.like("contact_phone", `%${digits}%`);
        }
      }
      const { data, error } = await query;
      if (error) {
        console.error("contact-data/entries GET browse:", error);
        return NextResponse.json(
          { error: error.message || "Failed to load entries" },
          { status: 500 },
        );
      }
      return NextResponse.json({ entries: data ?? [] });
    }

    if (!phoneRaw?.trim()) {
      return NextResponse.json(
        { error: "phone query parameter is required (or use browse=1)" },
        { status: 400 },
      );
    }
    const contact_phone = digitsOnly(phoneRaw);
    if (contact_phone.length < 6) {
      return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("contact_data_entries")
      .select("id, contact_phone, field_key, field_value, created_at, updated_at")
      .eq("owner_id", user.id)
      .eq("contact_phone", contact_phone)
      .order("field_key", { ascending: true });

    if (error) {
      console.error("contact-data/entries GET:", error);
      return NextResponse.json(
        { error: error.message || "Failed to load entries" },
        { status: 500 },
      );
    }

    return NextResponse.json({ entries: data ?? [] });
  } catch (e) {
    console.error("contact-data/entries GET:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const contact_phone = digitsOnly(String(body.contact_phone ?? ""));
    const field_key = String(body.field_key ?? "").trim();
    const field_value = String(body.field_value ?? "");

    if (contact_phone.length < 6) {
      return NextResponse.json({ error: "contact_phone is required" }, { status: 400 });
    }
    if (!field_key) {
      return NextResponse.json({ error: "field_key is required" }, { status: 400 });
    }
    if (field_value.length > 8000) {
      return NextResponse.json({ error: "field_value too long" }, { status: 400 });
    }

    const now = new Date().toISOString();

    const { data: existing } = await supabase
      .from("contact_data_entries")
      .select("id")
      .eq("owner_id", user.id)
      .eq("contact_phone", contact_phone)
      .eq("field_key", field_key)
      .maybeSingle();

    if (existing?.id) {
      const { data, error } = await supabase
        .from("contact_data_entries")
        .update({ field_value, updated_at: now })
        .eq("id", existing.id)
        .eq("owner_id", user.id)
        .select("id, contact_phone, field_key, field_value, created_at, updated_at")
        .single();
      if (error) {
        console.error("contact-data/entries POST update:", error);
        return NextResponse.json(
          { error: error.message || "Failed to save entry" },
          { status: 500 },
        );
      }
      return NextResponse.json({ entry: data });
    }

    const { data, error } = await supabase
      .from("contact_data_entries")
      .insert({
        owner_id: user.id,
        contact_phone,
        field_key,
        field_value,
        updated_at: now,
      })
      .select("id, contact_phone, field_key, field_value, created_at, updated_at")
      .single();

    if (error) {
      console.error("contact-data/entries POST insert:", error);
      return NextResponse.json(
        { error: error.message || "Failed to save entry" },
        { status: 500 },
      );
    }

    return NextResponse.json({ entry: data });
  } catch (e) {
    console.error("contact-data/entries POST:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
