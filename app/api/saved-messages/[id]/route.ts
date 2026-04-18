import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) {
        return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
      }
      updates.title = title;
    }
    if (body.body !== undefined) {
      const text = String(body.body).trim();
      if (!text) {
        return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
      }
      if (text.length > 10000) {
        return NextResponse.json(
          { error: "body must be at most 10000 characters" },
          { status: 400 },
        );
      }
      updates.body = text;
    }
    if (body.sort_order !== undefined) {
      const so = body.sort_order;
      if (typeof so === "number" && Number.isFinite(so)) {
        updates.sort_order = Math.floor(so);
      }
    }

    const { data, error } = await supabase
      .from("saved_chat_messages")
      .update(updates)
      .eq("id", id)
      .eq("owner_id", user.id)
      .select("id, title, body, sort_order, created_at, updated_at")
      .single();

    if (error) {
      console.error("saved-messages PATCH:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ message: data });
  } catch (e) {
    console.error("saved-messages PATCH:", e);
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
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { error } = await supabase
      .from("saved_chat_messages")
      .delete()
      .eq("id", id)
      .eq("owner_id", user.id);

    if (error) {
      console.error("saved-messages DELETE:", error);
      return NextResponse.json(
        { error: error.message || "Failed to delete" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("saved-messages DELETE:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
