import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  SUGGEST_REPLY_SYSTEM_INSTRUCTION,
  buildSuggestReplyUserContent,
  type SuggestReplyTranscriptLine,
} from "@/lib/prompts";

const DEFAULT_MODEL = "gemini-2.0-flash";

type IncomingMessage = {
  content?: string;
  is_sent_by_me?: boolean;
};

function normalizeTranscript(messages: IncomingMessage[]): SuggestReplyTranscriptLine[] {
  const lines: SuggestReplyTranscriptLine[] = [];
  for (const m of messages) {
    const raw = (m.content ?? "").trim();
    const text =
      raw.length > 0
        ? raw
        : "[Non-text or empty message — infer context from surrounding lines if needed]";
    lines.push({
      role: m.is_sent_by_me ? "me" : "customer",
      text,
    });
  }
  return lines;
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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not configured on the server." },
        { status: 503 },
      );
    }

    const body = await request.json();
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    if (rawMessages.length === 0) {
      return NextResponse.json(
        { error: "No messages provided. Need recent conversation messages." },
        { status: 400 },
      );
    }

    const transcript = normalizeTranscript(rawMessages.slice(-10));
    const userContent = buildSuggestReplyUserContent(transcript);
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SUGGEST_REPLY_SYSTEM_INSTRUCTION }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userContent }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.65,
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
      console.error("Gemini API error:", geminiRes.status, msg);
      return NextResponse.json(
        { error: msg },
        { status: geminiRes.status >= 400 && geminiRes.status < 600 ? geminiRes.status : 502 },
      );
    }

    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("")?.trim() ?? "";

    if (!text) {
      return NextResponse.json(
        { error: "No suggestion returned. Try again or check the model response." },
        { status: 502 },
      );
    }

    return NextResponse.json({ suggestion: text });
  } catch (e) {
    console.error("suggest-reply route:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}
