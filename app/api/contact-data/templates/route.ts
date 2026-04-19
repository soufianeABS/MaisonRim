import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("contact_data_field_templates")
      .select("id, name, sort_order, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("contact-data/templates GET:", error);
      return NextResponse.json(
        { error: error.message || "Failed to load templates" },
        { status: 500 },
      );
    }

    return NextResponse.json({ templates: data ?? [] });
  } catch (e) {
    console.error("contact-data/templates GET:", e);
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
    const name = String(body.name ?? "").trim();
    const sort_order =
      typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
        ? Math.floor(body.sort_order)
        : 0;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("contact_data_field_templates")
      .insert({
        owner_id: user.id,
        name,
        sort_order,
      })
      .select("id, name, sort_order, created_at, updated_at")
      .single();

    if (error) {
      console.error("contact-data/templates POST:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create template" },
        { status: 500 },
      );
    }

    return NextResponse.json({ template: data });
  } catch (e) {
    console.error("contact-data/templates POST:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
