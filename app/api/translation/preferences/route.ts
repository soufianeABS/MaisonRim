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
    .select("translation_target_language, translation_enabled")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    if (
      isMissingColumnError(error, "translation_target_language") ||
      isMissingColumnError(error, "translation_enabled")
    ) {
      return NextResponse.json({
        translation_target_language: null as string | null,
        translation_enabled: true,
        warning:
          "Missing translation columns on user_settings. Apply sql/translation_message_translations.sql and sql/user_settings_translation_enabled.sql",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({
      translation_target_language: null,
      translation_enabled: true,
    });
  }

  const raw = (data as { translation_target_language?: string | null }).translation_target_language;
  const translation_target_language =
    typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;

  const en = (data as { translation_enabled?: boolean | null } | null)?.translation_enabled;
  const translation_enabled = typeof en === "boolean" ? en : true;

  return NextResponse.json({
    translation_target_language:
      translation_target_language && isAllowedTranslationLanguage(translation_target_language)
        ? translation_target_language
        : null,
    translation_enabled,
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

  const { data: current, error: curErr } = await supabase
    .from("user_settings")
    .select("translation_target_language, translation_enabled")
    .eq("id", user.id)
    .maybeSingle();

  if (
    curErr &&
    !isMissingColumnError(curErr, "translation_target_language") &&
    !isMissingColumnError(curErr, "translation_enabled")
  ) {
    return NextResponse.json({ error: curErr.message }, { status: 500 });
  }

  let translation_target_language: string | null = null;
  const curLang = (current as { translation_target_language?: string | null } | null)
    ?.translation_target_language;
  if (typeof curLang === "string" && curLang.trim().length > 0) {
    translation_target_language = curLang.trim();
  }

  let translation_enabled =
    typeof (current as { translation_enabled?: boolean | null } | null)?.translation_enabled ===
    "boolean"
      ? Boolean((current as { translation_enabled?: boolean }).translation_enabled)
      : true;

  if (b.translation_target_language === null || b.translation_target_language === undefined) {
    if ("translation_target_language" in b) {
      translation_target_language = null;
    }
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
  } else if ("translation_target_language" in b) {
    return NextResponse.json(
      { error: "translation_target_language must be a string or null." },
      { status: 400 },
    );
  }

  if ("translation_enabled" in b) {
    if (b.translation_enabled === null || b.translation_enabled === undefined) {
      translation_enabled = true;
    } else if (typeof b.translation_enabled === "boolean") {
      translation_enabled = b.translation_enabled;
    } else {
      return NextResponse.json(
        { error: "translation_enabled must be a boolean." },
        { status: 400 },
      );
    }
  }

  const upsertRow: {
    id: string;
    translation_target_language: string | null;
    translation_enabled: boolean;
    updated_at: string;
  } = {
    id: user.id,
    translation_target_language,
    translation_enabled,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("user_settings").upsert(upsertRow, {
    onConflict: "id",
  });

  if (error) {
    if (
      isMissingColumnError(error, "translation_target_language") ||
      isMissingColumnError(error, "translation_enabled")
    ) {
      return NextResponse.json(
        {
          error:
            "Missing translation columns on user_settings. Apply sql/translation_message_translations.sql and sql/user_settings_translation_enabled.sql",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    translation_target_language:
      translation_target_language && isAllowedTranslationLanguage(translation_target_language)
        ? translation_target_language
        : null,
    translation_enabled,
  });
}
