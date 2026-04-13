import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import {
  REPLY_AGENT_EXPORT_VERSION,
  agentSelectColumns,
  sanitizeAgentFilename,
} from "../../shared";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row, error } = await supabase
    .from("reply_agents")
    .select(agentSelectColumns)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = {
    version: REPLY_AGENT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceApp: "WaChat" as const,
    agent: {
      name: row.name,
      persona: row.persona ?? "",
      task: row.task ?? "",
      output_rules: row.output_rules ?? [],
      business_rules: row.business_rules ?? [],
      system_prompt: row.system_prompt ?? "",
      temperature: row.temperature,
      max_output_tokens: row.max_output_tokens,
    },
  };

  const base = sanitizeAgentFilename(row.name);
  const filename = `${base}.json`;
  const body = JSON.stringify(payload, null, 2);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
