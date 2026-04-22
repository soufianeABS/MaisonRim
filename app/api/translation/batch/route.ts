import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isAllowedTranslationLanguage } from "@/lib/translation-languages";

export const runtime = "nodejs";

const MAX_IDS = 500;

function isMissingTranslationsTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const anyErr = e as { code?: string; message?: string };
  const msg = (anyErr.message ?? "").toLowerCase();
  return (
    anyErr.code === "42P01" ||
    msg.includes("message_translations") && msg.includes("does not exist")
  );
}

export async function POST(request: NextRequest) {
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
  const rawIds = b.message_ids;
  const lang =
    typeof b.target_language === "string" ? b.target_language.trim() : "";
  const includeAnyExisting = b.include_any_existing === true;
  if (!isAllowedTranslationLanguage(lang)) {
    return NextResponse.json({ error: "Invalid or missing target_language." }, { status: 400 });
  }
  if (!Array.isArray(rawIds)) {
    return NextResponse.json({ error: "message_ids must be an array." }, { status: 400 });
  }
  const message_ids = rawIds
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, MAX_IDS);

  if (message_ids.length === 0) {
    return NextResponse.json({ translations: {} as Record<string, string> });
  }

  const query = supabase
    .from("message_translations")
    .select("message_id, translated_text, target_language, updated_at")
    .eq("user_id", user.id)
    .in("message_id", message_ids);
  const { data: rows, error } = includeAnyExisting
    ? await query.order("updated_at", { ascending: false })
    : await query.eq("target_language", lang);

  if (error) {
    if (isMissingTranslationsTableError(error)) {
      return NextResponse.json(
        {
          error:
            "Missing table message_translations. Apply sql/translation_message_translations.sql",
          translations: {},
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const translations: Record<string, string> = {};
  for (const row of rows ?? []) {
    const id = (row as { message_id?: string }).message_id;
    const text = (row as { translated_text?: string }).translated_text;
    if (typeof id === "string" && typeof text === "string" && text.length > 0) {
      if (includeAnyExisting && translations[id]) continue;
      translations[id] = text;
    }
  }

  return NextResponse.json({ translations });
}
