import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  agentSelectColumns,
  buildReplyAgentInsertRow,
  clampMaxTokens,
  clampTemperature,
  parseRulesInput,
  validateAgentPayload,
} from "./shared";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("reply_agents")
      .select(agentSelectColumns)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("reply-agents GET:", error);
      return NextResponse.json(
        { error: error.message || "Failed to load agents" },
        { status: 500 },
      );
    }

    return NextResponse.json({ agents: data ?? [] });
  } catch (e) {
    console.error("reply-agents GET:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
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

    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const persona = String(body.persona ?? "").trim();
    const task = String(body.task ?? "").trim();
    const output_rules = parseRulesInput(body.output_rules);
    const business_rules = parseRulesInput(body.business_rules);
    const system_prompt = String(body.system_prompt ?? "").trim();

    const v = validateAgentPayload({
      name,
      persona,
      task,
      output_rules,
      business_rules,
      system_prompt,
    });
    if (v.error) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }

    const temperature = clampTemperature(body.temperature);
    const max_output_tokens = clampMaxTokens(body.max_output_tokens);

    const { data, error } = await supabase
      .from("reply_agents")
      .insert(
        buildReplyAgentInsertRow(user.id, {
          name,
          persona,
          task,
          output_rules,
          business_rules,
          system_prompt,
          temperature,
          max_output_tokens,
        }),
      )
      .select(agentSelectColumns)
      .single();

    if (error) {
      console.error("reply-agents POST:", error);
      return NextResponse.json(
        { error: error.message || "Failed to create agent" },
        { status: 500 },
      );
    }

    return NextResponse.json({ agent: data });
  } catch (e) {
    console.error("reply-agents POST:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
