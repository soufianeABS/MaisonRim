import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { TRANSLATION_LANGUAGES, isAllowedTranslationLanguage } from "@/lib/translation-languages";

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

    const body = (await request.json()) as { samples?: unknown };
    if (!Array.isArray(body.samples)) {
      return NextResponse.json({ error: "samples must be an array." }, { status: 400 });
    }

    const samples = body.samples
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim())
      .slice(0, 4);

    if (samples.length === 0) {
      return NextResponse.json({ language: "und" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server." }, { status: 503 });
    }

    const allowedCodes = TRANSLATION_LANGUAGES.map((l) => l.value).join(", ");
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const systemInstruction =
      `Detect the dominant language used in the provided chat excerpts. ` +
      `Return ONLY one BCP-47 language code from this allowed list: ${allowedCodes}. ` +
      `If uncertain, return "und".`;

    const prompt = samples.map((s, i) => `Sample ${i + 1}:\n${s}`).join("\n\n");

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 32,
          temperature: 0,
        },
      }),
    });

    const data = (await geminiRes.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    if (!geminiRes.ok) {
      return NextResponse.json({ language: "und" });
    }

    const raw =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    const language = raw.replace(/[`"' \n\r\t]/g, "");
    if (!isAllowedTranslationLanguage(language)) {
      return NextResponse.json({ language: "und" });
    }
    return NextResponse.json({ language });
  } catch {
    return NextResponse.json({ language: "und" });
  }
}
