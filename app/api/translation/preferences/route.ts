import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isAllowedTranslationLanguage } from "@/lib/translation-languages";

function isMissingColumnError(e: unknown, columnName: string): boolean {
  if (!e || typeof e !== "object") return false;
  const anyErr = e as { code?: string; message?: string; details?: string; hint?: string };
  const msg = `${anyErr.message ?? ""} ${anyErr.details ?? ""} ${anyErr.hint ?? ""}`.toLowerCase();
  return anyErr.code === "42703" || msg.includes(columnName.toLowerCase());
}

export const runtime = "nodejs";

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
    .select("translation_target_language")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error, "translation_target_language")) {
      return NextResponse.json({
        translation_target_language: null as string | null,
        warning:
          "Missing column user_settings.translation_target_language. Apply sql/translation_message_translations.sql",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data as { translation_target_language?: string | null } | null)
    ?.translation_target_language;
  const translation_target_language =
    typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;

  return NextResponse.json({
    translation_target_language:
      translation_target_language && isAllowedTranslationLanguage(translation_target_language)
        ? translation_target_language
        : null,
  });
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
  let translation_target_language: string | null = null;
  if (b.translation_target_language === null || b.translation_target_language === undefined) {
    translation_target_language = null;
  } else if (typeof b.translation_target_language === "string") {
    const t = b.translation_target_language.trim();
    if (t.length === 0) {
      translation_target_language = null;
    } else if (!isAllowedTranslationLanguage(t)) {
      return NextResponse.json(
        { error: "Unsupported or invalid translation_target_language." },
        { status: 400 },
      );
    } else {
      translation_target_language = t;
    }
  } else {
    return NextResponse.json(
      { error: "translation_target_language must be a string or null." },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("user_settings").upsert(
    {
      id: user.id,
      translation_target_language,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    if (isMissingColumnError(error, "translation_target_language")) {
      return NextResponse.json(
        {
          error:
            "Missing column user_settings.translation_target_language. Apply sql/translation_message_translations.sql",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ translation_target_language });
}
