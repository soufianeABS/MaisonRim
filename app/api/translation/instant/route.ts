import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isAllowedTranslationLanguage } from "@/lib/translation-languages";

export const runtime = "nodejs";

const DEFAULT_MODEL = "gemini-2.0-flash";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { text?: unknown; target_language?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const targetLanguage =
      typeof body.target_language === "string" ? body.target_language.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "No text to translate." }, { status: 400 });
    }
    if (!isAllowedTranslationLanguage(targetLanguage)) {
      return NextResponse.json({ error: "Invalid target_language." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server." }, { status: 503 });
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
        contents: [{ role: "user", parts: [{ text }] }],
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
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const translated =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim() ?? "";
    if (!translated) {
      return NextResponse.json({ error: "No translation returned. Try again." }, { status: 502 });
    }

    return NextResponse.json({ translated_text: translated, target_language: targetLanguage });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}
