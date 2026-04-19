import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { imagePromptSelectColumns, parsePatchBody } from "../shared";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = parsePatchBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("image_prompts")
      .update(parsed.updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(imagePromptSelectColumns)
      .maybeSingle();

    if (error) {
      console.error("image-prompts PATCH:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update image prompt" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Prompt not found." }, { status: 404 });
    }

    return NextResponse.json({ prompt: data });
  } catch (e) {
    console.error("image-prompts PATCH:", e);
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
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: deleted, error } = await supabase
      .from("image_prompts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("image-prompts DELETE:", error);
      return NextResponse.json(
        { error: error.message || "Failed to delete image prompt" },
        { status: 500 },
      );
    }

    if (!deleted) {
      return NextResponse.json({ error: "Prompt not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("image-prompts DELETE:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
