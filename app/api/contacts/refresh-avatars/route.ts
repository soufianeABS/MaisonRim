import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function digitsOnly(v: string): string {
  return v.replace(/[^\d]/g, "");
}

async function fetchGreenAvatar(params: {
  apiUrl: string;
  idInstance: string;
  apiTokenInstance: string;
  phoneNumber: string;
}): Promise<string | null> {
  const endpoint = `${params.apiUrl.replace(/\/+$/, "")}/waInstance${params.idInstance}/getAvatar/${params.apiTokenInstance}`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId: `${params.phoneNumber}@c.us` }),
  });
  const data = await resp.json().catch(() => null) as { urlAvatar?: unknown } | null;
  if (!resp.ok) return null;
  const url = data?.urlAvatar;
  return typeof url === "string" && url ? url : null;
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
  const contactIdsRaw = Array.isArray(b.contactIds) ? (b.contactIds as unknown[]) : [];
  const contactIds = contactIdsRaw
    .map((x) => (typeof x === "string" ? digitsOnly(x) : ""))
    .filter(Boolean)
    .slice(0, 25);

  if (contactIds.length === 0) {
    return NextResponse.json({ error: "contactIds is required" }, { status: 400 });
  }

  // Load Green API settings for current user
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("messaging_provider, green_api_url, green_id_instance, green_api_token_instance")
    .eq("id", user.id)
    .maybeSingle();

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }

  const provider = (settings as { messaging_provider?: string | null } | null)?.messaging_provider;
  if (provider !== "green_api") {
    return NextResponse.json({ error: "Provider is not green_api" }, { status: 400 });
  }

  const apiUrl = (settings as { green_api_url?: string | null } | null)?.green_api_url || null;
  const idInstance =
    (settings as { green_id_instance?: string | null } | null)?.green_id_instance || null;
  const apiTokenInstance =
    (settings as { green_api_token_instance?: string | null } | null)?.green_api_token_instance ||
    null;

  if (!apiUrl || !idInstance || !apiTokenInstance) {
    return NextResponse.json(
      { error: "Green API settings are incomplete" },
      { status: 400 },
    );
  }

  const results: Array<{ contactId: string; avatar_url: string | null }> = [];

  for (const contactId of contactIds) {
    const avatar = await fetchGreenAvatar({
      apiUrl,
      idInstance,
      apiTokenInstance,
      phoneNumber: contactId,
    }).catch(() => null);

    results.push({ contactId, avatar_url: avatar });

    if (avatar) {
      // Best-effort update
      await supabase
        .from("contacts")
        .update({ avatar_url: avatar, updated_at: new Date().toISOString() })
        .eq("owner_id", user.id)
        .eq("phone", contactId);
    }
  }

  return NextResponse.json({ success: true, results });
}

