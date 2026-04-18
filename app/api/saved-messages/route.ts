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
      .from("saved_chat_messages")
      .select("id, title, body, sort_order, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("saved-messages GET:", error);
      return NextResponse.json(
        { error: error.message || "Failed to load saved messages" },
        { status: 500 },
      );
    }

    return NextResponse.json({ messages: data ?? [] });
  } catch (e) {
    console.error("saved-messages GET:", e);
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
    const title = String(body.title ?? "").trim();
    const text = String(body.body ?? "").trim();
    const sort_order =
      typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
        ? Math.floor(body.sort_order)
        : 0;

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "body is required" }, { status: 400 });
    }
    if (text.length > 10000) {
      return NextResponse.json(
        { error: "body must be at most 10000 characters" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("saved_chat_messages")
      .insert({
        owner_id: user.id,
        title,
        body: text,
        sort_order,
      })
      .select("id, title, body, sort_order, created_at, updated_at")
      .single();

    if (error) {
      console.error("saved-messages POST:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create saved message" },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: data });
  } catch (e) {
    console.error("saved-messages POST:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
