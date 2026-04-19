import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const DEFAULT_MODEL = "gemini-2.5-flash";

function coerceString(v: unknown, maxLen: number): string {
  const s = typeof v === "string" ? v : "";
  const t = s.trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

function extractFirstJsonObject(text: string): unknown | null {
  const t = text.trim();
  // Fast path
  try {
    return JSON.parse(t) as unknown;
  } catch {
    /* fallthrough */
  }

  // Try to locate the first {...} block and parse it.
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) return null;
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    return null;
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

    const body = (await request.json()) as Record<string, unknown>;
    const media_url = coerceString(body.media_url, 4000);
    const mime_type = coerceString(body.mime_type, 120) || "image/jpeg";
    const prompt = coerceString(body.prompt, 16_000);
    const expected_json = coerceString(body.expected_json, 16_000);

    if (!media_url) {
      return NextResponse.json({ error: "media_url is required" }, { status: 400 });
    }
    if (!mime_type.startsWith("image/")) {
      return NextResponse.json({ error: "mime_type must be an image/* type" }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (!expected_json) {
      return NextResponse.json({ error: "expected_json is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured on the server." },
        { status: 503 },
      );
    }

    let imagePart: { inlineData: { mimeType: string; data: string } } | null = null;
    try {
      const resp = await fetch(media_url, { method: "GET" });
      if (!resp.ok) {
        const msg = `Could not download image (${resp.status})`;
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      const arr = await resp.arrayBuffer();
      const buf = Buffer.from(arr);
      const maxBytes = 4 * 1024 * 1024;
      if (buf.length === 0) {
        return NextResponse.json({ error: "Downloaded image is empty" }, { status: 502 });
      }
      if (buf.length > maxBytes) {
        return NextResponse.json(
          { error: `Image too large (${buf.length} bytes). Max is ${maxBytes} bytes.` },
          { status: 413 },
        );
      }
      imagePart = {
        inlineData: {
          mimeType: mime_type,
          data: buf.toString("base64"),
        },
      };
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to download image" },
        { status: 502 },
      );
    }

    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey,
    )}`;

    const systemInstruction = `You extract structured information from an image.

Output rules:
- Output ONLY valid JSON. No markdown, no explanations, no surrounding text.
- Use EXACTLY the keys described in "Expected JSON". If a field is not present/unknown, use null (or an empty string if the example shows empty string).
- Do not add extra keys.
- Keep values concise and human-readable.`;

    const userText = `Task prompt:
${prompt}

Expected JSON (example or schema-like):
${expected_json}

Return the JSON object now.`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userText }, imagePart],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.2,
        },
      }),
    });

    const data = (await geminiRes.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      error?: { message?: string; code?: number };
    };

    if (!geminiRes.ok) {
      const msg = data.error?.message || "Gemini request failed";
      console.error("analyze-image Gemini API error:", geminiRes.status, msg);
      return NextResponse.json(
        { error: msg },
        { status: geminiRes.status >= 400 && geminiRes.status < 600 ? geminiRes.status : 502 },
      );
    }

    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim() ?? "";
    if (!text) {
      return NextResponse.json(
        { error: "No output returned from model." },
        { status: 502 },
      );
    }

    const parsed = extractFirstJsonObject(text);
    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json(
        { error: "Model did not return valid JSON.", raw: text },
        { status: 502 },
      );
    }

    return NextResponse.json({ data: parsed });
  } catch (e) {
    console.error("analyze-image route:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}

