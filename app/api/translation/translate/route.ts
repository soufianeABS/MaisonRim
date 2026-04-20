import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isAllowedTranslationLanguage } from "@/lib/translation-languages";

export const runtime = "nodejs";

const DEFAULT_MODEL = "gemini-2.5-flash";
const MAX_SOURCE_CHARS = 12_000;

function isMissingSchemaError(e: unknown, hint: "settings_col" | "translations_table"): boolean {
  if (!e || typeof e !== "object") return false;
  const anyErr = e as { code?: string; message?: string };
  const msg = (anyErr.message ?? "").toLowerCase();
  if (hint === "settings_col") {
    return anyErr.code === "42703" || msg.includes("translation_target_language");
  }
  return (
    anyErr.code === "42P01" ||
    (msg.includes("message_translations") && msg.includes("does not exist"))
  );
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const b = body as Record<string, unknown>;
    const messageId = typeof b.message_id === "string" ? b.message_id.trim() : "";
    const text =
      typeof b.text === "string" ? b.text.slice(0, MAX_SOURCE_CHARS) : "";
    let targetLanguage =
      typeof b.target_language === "string" ? b.target_language.trim() : "";

    if (!messageId || messageId.startsWith("optimistic_")) {
      return NextResponse.json({ error: "Invalid message_id." }, { status: 400 });
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "No text to translate." }, { status: 400 });
    }

    if (!targetLanguage) {
      const { data: settings, error: setErr } = await supabase
        .from("user_settings")
        .select("translation_target_language")
        .eq("id", user.id)
        .maybeSingle();
      if (setErr && !isMissingSchemaError(setErr, "settings_col")) {
        return NextResponse.json({ error: setErr.message }, { status: 500 });
      }
      const raw = (settings as { translation_target_language?: string | null } | null)
        ?.translation_target_language;
      targetLanguage = typeof raw === "string" ? raw.trim() : "";
    }

    if (!isAllowedTranslationLanguage(targetLanguage)) {
      return NextResponse.json(
        {
          error:
            "Set a target language on the Translation tool page, or pass target_language in the request.",
        },
        { status: 400 },
      );
    }

    const uid = user.id;
    const { data: msgRow, error: msgErr } = await supabase
      .from("messages")
      .select("id")
      .eq("id", messageId)
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .maybeSingle();

    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }
    if (!msgRow) {
      return NextResponse.json({ error: "Message not found or not accessible." }, { status: 404 });
    }

    const { data: cached, error: cacheErr } = await supabase
      .from("message_translations")
      .select("translated_text")
      .eq("user_id", uid)
      .eq("message_id", messageId)
      .eq("target_language", targetLanguage)
      .maybeSingle();

    if (cacheErr) {
      if (isMissingSchemaError(cacheErr, "translations_table")) {
        return NextResponse.json(
          {
            error:
              "Missing message_translations table. Apply sql/translation_message_translations.sql",
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: cacheErr.message }, { status: 500 });
    }
    const cachedText = (cached as { translated_text?: string } | null)?.translated_text;
    if (typeof cachedText === "string" && cachedText.trim().length > 0) {
      return NextResponse.json({
        translated_text: cachedText.trim(),
        target_language: targetLanguage,
        cached: true,
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured on the server." },
        { status: 503 },
      );
    }

    const langLabel =
      typeof Intl !== "undefined"
        ? new Intl.DisplayNames(["en"], { type: "language" }).of(
            targetLanguage.replace("_", "-"),
          ) || targetLanguage
        : targetLanguage;

    const systemInstruction =
      `You are a professional translator. Translate the following message into ${langLabel} (${targetLanguage}). ` +
      `Preserve meaning, tone, emojis, and line breaks. Output ONLY the translated text without quotes or explanations.`;

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [
          {
            role: "user",
            parts: [{ text: trimmed }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.2,
        },
      }),
    });

    const data = (await geminiRes.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };

    if (!geminiRes.ok) {
      const msg = data.error?.message || "Gemini request failed";
      return NextResponse.json(
        { error: msg },
        {
          status:
            geminiRes.status >= 400 && geminiRes.status < 600 ? geminiRes.status : 502,
        },
      );
    }

    const translated =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim() ?? "";

    if (!translated) {
      return NextResponse.json(
        { error: "No translation returned. Try again." },
        { status: 502 },
      );
    }

    const { error: upsertErr } = await supabase.from("message_translations").upsert(
      {
        message_id: messageId,
        user_id: uid,
        target_language: targetLanguage,
        translated_text: translated,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_id,user_id,target_language" },
    );

    if (upsertErr) {
      if (isMissingSchemaError(upsertErr, "translations_table")) {
        return NextResponse.json(
          {
            error:
              "Missing message_translations table. Apply sql/translation_message_translations.sql",
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      translated_text: translated,
      target_language: targetLanguage,
      cached: false,
    });
  } catch (e) {
    console.error("translation translate route:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}
