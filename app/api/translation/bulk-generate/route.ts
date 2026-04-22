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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as {
      target_language?: unknown;
      messages?: unknown;
    };
    const targetLanguage =
      typeof body.target_language === "string" ? body.target_language.trim() : "";
    if (!isAllowedTranslationLanguage(targetLanguage)) {
      return NextResponse.json({ error: "Invalid target_language." }, { status: 400 });
    }
    if (!Array.isArray(body.messages)) {
      return NextResponse.json({ error: "messages must be an array." }, { status: 400 });
    }

    const messages = body.messages
      .map((m) => {
        const mm = m as { id?: unknown; text?: unknown };
        const id = typeof mm.id === "string" ? mm.id.trim() : "";
        const text = typeof mm.text === "string" ? mm.text.trim() : "";
        return { id, text };
      })
      .filter((m) => m.id && m.text)
      .slice(0, 80);

    console.log("[translation/bulk-generate] request", {
      userId: user.id,
      targetLanguage,
      messageCount: messages.length,
      sampleIds: messages.slice(0, 10).map((m) => m.id),
    });

    if (messages.length === 0) {
      return NextResponse.json({ translations: {} as Record<string, string> });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY is not configured on the server." }, { status: 503 });
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const systemInstruction =
      `Translate each message into ${targetLanguage}. ` +
      `Return JSON object only: {"translations":{"<id>":"<translated_text>"}} with same IDs. ` +
      `Preserve meaning, tone, emojis, and line breaks.`;
    const payloadLines = messages.map((m) => `${m.id}\t${m.text}`).join("\n");

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: payloadLines }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
      }),
    });

    const data = (await geminiRes.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!geminiRes.ok) {
      console.error("[translation/bulk-generate] gemini error", {
        userId: user.id,
        targetLanguage,
        status: geminiRes.status,
        error: data.error?.message || "Gemini request failed",
      });
      return NextResponse.json({ error: data.error?.message || "Gemini request failed" }, { status: 502 });
    }

    const raw =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
    const jsonText = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/, "").trim();
    let parsed: { translations?: Record<string, string> } = {};
    try {
      parsed = JSON.parse(jsonText) as { translations?: Record<string, string> };
    } catch {
      console.error("[translation/bulk-generate] json parse failed", {
        userId: user.id,
        targetLanguage,
        rawPreview: raw.slice(0, 300),
      });
      return NextResponse.json({ translations: {} as Record<string, string> });
    }

    const translations: Record<string, string> = {};
    for (const m of messages) {
      const t = parsed.translations?.[m.id];
      if (typeof t === "string" && t.trim().length > 0) {
        translations[m.id] = t.trim();
      }
    }

    if (Object.keys(translations).length > 0) {
      const now = new Date().toISOString();
      const rows = Object.entries(translations).map(([message_id, translated_text]) => ({
        message_id,
        user_id: user.id,
        target_language: targetLanguage,
        translated_text,
        updated_at: now,
      }));
      await supabase.from("message_translations").upsert(rows, {
        onConflict: "message_id,user_id,target_language",
      });
    }

    console.log("[translation/bulk-generate] response", {
      userId: user.id,
      targetLanguage,
      requested: messages.length,
      translated: Object.keys(translations).length,
    });

    return NextResponse.json({ translations });
  } catch (e) {
    console.error("[translation/bulk-generate] unexpected error", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}
