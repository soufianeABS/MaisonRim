import { NextRequest, NextResponse } from "next/server";

import { ActionRunner } from "@/lib/action-runner";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function classifyError(e: unknown): { status: number; message: string; hint?: string } {
  const msg = e instanceof Error ? e.message : "Action failed";
  const lower = msg.toLowerCase();

  if (lower.includes("unauthorized")) return { status: 401, message: msg };
  if (lower.includes("conversation not found")) return { status: 404, message: msg };
  if (lower.includes("no apiaction configured")) return { status: 404, message: msg };
  if (lower.includes("api call failed")) return { status: 502, message: msg };

  // Common Supabase/Postgres "relation does not exist" when SQL not applied
  if (
    lower.includes("relation") &&
    (lower.includes("api_actions") || lower.includes("action_logs") || lower.includes("metadata"))
  ) {
    return {
      status: 500,
      message: msg,
      hint: "Apply sql/dynamic_action_engine.sql in Supabase SQL editor.",
    };
  }

  return { status: 500, message: msg };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const conversationId = typeof b.conversationId === "string" ? b.conversationId : "";
  const tagName = typeof b.tagName === "string" ? b.tagName : undefined;
  const statusId = typeof b.statusId === "string" ? b.statusId : null;

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  try {
    const result = await ActionRunner.run({ conversationId, tagName, statusId });
    return NextResponse.json(result);
  } catch (e) {
    const classified = classifyError(e);
    console.error("[actions/run] failed", {
      conversationId,
      statusId,
      tagName,
      userId: user.id,
      error: e instanceof Error ? { message: e.message, stack: e.stack } : String(e),
      hint: classified.hint,
    });
    return NextResponse.json(
      { error: classified.message, ...(classified.hint ? { hint: classified.hint } : {}) },
      { status: classified.status },
    );
  }
}

