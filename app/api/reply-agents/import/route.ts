import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

import {
  agentSelectColumns,
  buildReplyAgentInsertRow,
  parseReplyAgentImportPayload,
} from "../shared";

export async function POST(request: Request) {
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

  const parsed = parseReplyAgentImportPayload(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reply_agents")
    .insert(buildReplyAgentInsertRow(user.id, parsed))
    .select(agentSelectColumns)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ agent: data });
}
