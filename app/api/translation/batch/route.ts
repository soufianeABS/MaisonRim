import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { isAllowedTranslationLanguage } from "@/lib/translation-languages";

export const runtime = "nodejs";

const MAX_IDS = 500;
const DEFAULT_MODEL = "gemini-2.5-flash";

type GeminiBatchResult = {
  ok: boolean;
  status: number;
  raw: string;
  errorMessage?: string;
};

async function requestGeminiBatchTranslation(params: {
  apiKey: string;
  model: string;
  targetLanguage: string;
  payloadLines: string;
}): Promise<GeminiBatchResult> {
  const { apiKey, model, targetLanguage, payloadLines } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const systemInstruction =
    `Translate each message into ${targetLanguage}. ` +
    `Return JSON object only: {"translations":{"<id>":"<translated_text>"}} with same IDs. ` +
    `Preserve meaning, tone, emojis, and line breaks.`;

  const geminiRes = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user", parts: [{ text: payloadLines }] }],
      generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
    }),
  });
  const geminiData = (await geminiRes.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };
  const raw =
    geminiData.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  return {
    ok: geminiRes.ok,
    status: geminiRes.status,
    raw,
    errorMessage: geminiData.error?.message || "Gemini request failed",
  };
}

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
  const autoGenerateMissing = b.auto_generate_missing === true;
  if (!isAllowedTranslationLanguage(lang)) {
    return NextResponse.json({ error: "Invalid or missing target_language." }, { status: 400 });
  }
  if (!Array.isArray(rawIds)) {
    return NextResponse.json({ error: "message_ids must be an array." }, { status: 400 });
  }
  const message_ids = rawIds
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .slice(0, MAX_IDS);

  console.log("[translation/batch] request", {
    userId: user.id,
    messageCount: message_ids.length,
    targetLanguage: lang,
    includeAnyExisting,
    autoGenerateMissing,
    sampleMessageIds: message_ids.slice(0, 20),
  });

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
    console.error("[translation/batch] query error", {
      userId: user.id,
      targetLanguage: lang,
      includeAnyExisting,
      error: error.message,
    });
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

  const missingIds = includeAnyExisting
    ? message_ids.filter((id) => !translations[id])
    : [];

  if (autoGenerateMissing && includeAnyExisting && missingIds.length > 0) {
    const { data: msgRows, error: msgErr } = await supabase
      .from("messages")
      .select("id, content, message_type")
      .in("id", missingIds.slice(0, 80));

    if (msgErr) {
      console.error("[translation/batch] message fetch for generation failed", {
        userId: user.id,
        error: msgErr.message,
      });
    } else {
      const toTranslate = (msgRows ?? [])
        .map((r) => {
          const row = r as { id?: string; content?: string; message_type?: string | null };
          const id = typeof row.id === "string" ? row.id : "";
          const content = typeof row.content === "string" ? row.content.trim() : "";
          return {
            id,
            text: content,
            messageType: row.message_type || "text",
          };
        })
        .filter((x) => x.id && x.text);

      console.log("[translation/batch] missing message previews", {
        userId: user.id,
        missingCount: missingIds.length,
        translatableCount: toTranslate.length,
        sample: toTranslate.slice(0, 10).map((m) => ({
          id: m.id,
          messageType: m.messageType,
          preview: m.text.slice(0, 120),
        })),
      });

      if (toTranslate.length > 0) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          console.error("[translation/batch] auto-generate skipped: missing GEMINI_API_KEY");
        } else {
          const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
          const payloadLines = toTranslate.map((m) => `${m.id}\t${m.text}`).join("\n");

          const gemini = await requestGeminiBatchTranslation({
            apiKey,
            model,
            targetLanguage: lang,
            payloadLines,
          });

          if (!gemini.ok) {
            console.error("[translation/batch] auto-generate gemini error", {
              userId: user.id,
              status: gemini.status,
              error: gemini.errorMessage || "Gemini request failed",
            });
            return NextResponse.json(
              {
                error:
                  gemini.errorMessage ||
                  "Auto-translation failed while calling Gemini.",
                status: gemini.status,
              },
              {
                status:
                  gemini.status >= 400 && gemini.status < 600
                    ? gemini.status
                    : 502,
              },
            );
          } else {
            const raw = gemini.raw;
            const jsonText = raw
              .replace(/^```json\s*/i, "")
              .replace(/^```\s*/i, "")
              .replace(/```$/, "")
              .trim();
            try {
              const parsed = JSON.parse(jsonText) as { translations?: Record<string, string> };
              const generated: Record<string, string> = {};
              for (const m of toTranslate) {
                const t = parsed.translations?.[m.id];
                if (typeof t === "string" && t.trim().length > 0) {
                  generated[m.id] = t.trim();
                }
              }
              const genKeys = Object.keys(generated);
              if (genKeys.length > 0) {
                const now = new Date().toISOString();
                const upsertRows = genKeys.map((message_id) => ({
                  message_id,
                  user_id: user.id,
                  target_language: lang,
                  translated_text: generated[message_id],
                  updated_at: now,
                }));
                await supabase.from("message_translations").upsert(upsertRows, {
                  onConflict: "message_id,user_id,target_language",
                });
                for (const k of genKeys) translations[k] = generated[k];
              }
              console.log("[translation/batch] auto-generate result", {
                userId: user.id,
                requested: toTranslate.length,
                generated: genKeys.length,
              });
            } catch (e) {
              console.error("[translation/batch] auto-generate parse failed", {
                userId: user.id,
                rawPreview: raw.slice(0, 300),
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      }
    }
  }

  console.log("[translation/batch] response", {
    userId: user.id,
    rowsFetched: rows?.length ?? 0,
    translationsReturned: Object.keys(translations).length,
    includeAnyExisting,
    autoGenerateMissing,
  });

  return NextResponse.json({ translations });
}
