import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  SUGGEST_REPLY_SYSTEM_INSTRUCTION,
  buildReplyAgentSystemInstruction,
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

    const agentId =
      typeof body.agentId === "string" && body.agentId.length > 0 ? body.agentId : null;
    const contactId =
      typeof body.contactId === "string" && body.contactId.length > 0 ? body.contactId : null;

    let systemInstruction = SUGGEST_REPLY_SYSTEM_INSTRUCTION;
    let temperature = 0.65;
    let maxOutputTokens = 512;

    if (agentId) {
      const { data: agent, error: agentError } = await supabase
        .from("reply_agents")
        .select(
          "persona, task, output_rules, business_rules, system_prompt, temperature, max_output_tokens",
        )
        .eq("id", agentId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (agentError) {
        console.error("suggest-reply agent load:", agentError);
        return NextResponse.json(
          { error: "Could not load the selected agent." },
          { status: 500 },
        );
      }
      if (!agent) {
        return NextResponse.json({ error: "Agent not found." }, { status: 404 });
      }
      const composed = buildReplyAgentSystemInstruction({
        persona: agent.persona,
        task: agent.task,
        output_rules: agent.output_rules,
        business_rules: agent.business_rules,
        system_prompt: agent.system_prompt,
      });
      if (!composed?.trim()) {
        return NextResponse.json({ error: "Agent not found or incomplete." }, { status: 404 });
      }
      systemInstruction = composed.trim();
      const t = Number(agent.temperature);
      const mx = Number(agent.max_output_tokens);
      if (Number.isFinite(t)) {
        temperature = Math.min(2, Math.max(0, t));
      }
      if (Number.isFinite(mx)) {
        maxOutputTokens = Math.min(8192, Math.max(64, Math.round(mx)));
      }
    }

    if (contactId) {
      const { data: assignment, error: aErr } = await supabase
        .from("contact_status_assignments")
        .select("status_id")
        .eq("owner_id", user.id)
        .eq("contact_id", contactId)
        .maybeSingle();

      if (aErr) {
        console.error("suggest-reply status assignment load:", aErr);
      } else if (assignment?.status_id) {
        const { data: status, error: sErr } = await supabase
          .from("contact_statuses")
          .select("name, rule")
          .eq("id", assignment.status_id)
          .eq("owner_id", user.id)
          .maybeSingle();

        if (sErr) {
          console.error("suggest-reply status load:", sErr);
        } else if (status?.rule && String(status.rule).trim().length > 0) {
          const ruleText = String(status.rule).trim();
          const name = String(status.name ?? "Status");
          systemInstruction = `${systemInstruction}\n\n[Contact status: ${name}]\nRule:\n${ruleText}`.trim();
        }
      }
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
          parts: [{ text: systemInstruction }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: userContent }],
          },
        ],
        generationConfig: {
          maxOutputTokens,
          temperature,
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
