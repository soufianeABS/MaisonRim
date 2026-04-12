import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  agentSelectColumns,
  clampMaxTokens,
  clampTemperature,
  NAME_MAX,
  parseRulesInput,
  PERSONA_TASK_MAX,
  PROMPT_EXTRA_MAX,
  validateAgentPayload,
} from "../shared";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
      }
      if (name.length > NAME_MAX) {
        return NextResponse.json(
          { error: `Name must be at most ${NAME_MAX} characters.` },
          { status: 400 },
        );
      }
      updates.name = name;
    }

    if (body.persona !== undefined) {
      const persona = String(body.persona).trim();
      if (!persona) {
        return NextResponse.json({ error: "Persona cannot be empty." }, { status: 400 });
      }
      if (persona.length > PERSONA_TASK_MAX) {
        return NextResponse.json(
          { error: `Persona must be at most ${PERSONA_TASK_MAX} characters.` },
          { status: 400 },
        );
      }
      updates.persona = persona;
    }

    if (body.task !== undefined) {
      const task = String(body.task).trim();
      if (!task) {
        return NextResponse.json({ error: "Task cannot be empty." }, { status: 400 });
      }
      if (task.length > PERSONA_TASK_MAX) {
        return NextResponse.json(
          { error: `Task must be at most ${PERSONA_TASK_MAX} characters.` },
          { status: 400 },
        );
      }
      updates.task = task;
    }

    if (body.output_rules !== undefined) {
      updates.output_rules = parseRulesInput(body.output_rules);
    }

    if (body.business_rules !== undefined) {
      updates.business_rules = parseRulesInput(body.business_rules);
    }

    if (body.system_prompt !== undefined) {
      const systemPrompt = String(body.system_prompt).trim();
      if (systemPrompt.length > PROMPT_EXTRA_MAX) {
        return NextResponse.json(
          { error: `Additional instructions must be at most ${PROMPT_EXTRA_MAX} characters.` },
          { status: 400 },
        );
      }
      updates.system_prompt = systemPrompt || null;
    }

    if (body.temperature !== undefined) {
      updates.temperature = clampTemperature(body.temperature);
    }
    if (body.max_output_tokens !== undefined) {
      updates.max_output_tokens = clampMaxTokens(body.max_output_tokens);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update." }, { status: 400 });
    }

    const { data: current, error: loadErr } = await supabase
      .from("reply_agents")
      .select("name, persona, task, output_rules, business_rules, system_prompt")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadErr || !current) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    const merged = {
      name: (updates.name as string) ?? current.name,
      persona: (updates.persona as string) ?? String(current.persona ?? "").trim(),
      task: (updates.task as string) ?? String(current.task ?? "").trim(),
      output_rules:
        updates.output_rules !== undefined
          ? (updates.output_rules as string[])
          : parseRulesInput(current.output_rules),
      business_rules:
        updates.business_rules !== undefined
          ? (updates.business_rules as string[])
          : parseRulesInput(current.business_rules),
      system_prompt:
        updates.system_prompt !== undefined
          ? String(updates.system_prompt ?? "").trim()
          : String(current.system_prompt ?? "").trim(),
    };

    const v = validateAgentPayload(merged);
    if (v.error) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("reply_agents")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(agentSelectColumns)
      .single();

    if (error) {
      console.error("reply-agents PATCH:", error);
      return NextResponse.json(
        { error: error.message || "Failed to update agent" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    return NextResponse.json({ agent: data });
  } catch (e) {
    console.error("reply-agents PATCH:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: deleted, error } = await supabase
      .from("reply_agents")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("reply-agents DELETE:", error);
      return NextResponse.json(
        { error: error.message || "Failed to delete agent" },
        { status: 500 },
      );
    }

    if (!deleted) {
      return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("reply-agents DELETE:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
