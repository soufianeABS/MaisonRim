import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import { imagePromptSelectColumns, parseCreateBody } from "./shared";

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
      .from("image_prompts")
      .select(imagePromptSelectColumns)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("image-prompts GET:", error);
      return NextResponse.json(
        { error: error.message || "Failed to load image prompts" },
        { status: 500 },
      );
    }

    return NextResponse.json({ prompts: data ?? [] });
  } catch (e) {
    console.error("image-prompts GET:", e);
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
    const parsed = parseCreateBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("image_prompts")
      .insert({
        user_id: user.id,
        name: parsed.name,
        prompt: parsed.prompt,
        expected_json: parsed.expected_json,
      })
      .select(imagePromptSelectColumns)
      .single();

    if (error) {
      console.error("image-prompts POST:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create image prompt" },
        { status: 500 },
      );
    }

    return NextResponse.json({ prompt: data });
  } catch (e) {
    console.error("image-prompts POST:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
