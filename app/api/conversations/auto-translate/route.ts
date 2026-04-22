import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

    const body = (await request.json()) as {
      contactId?: unknown;
      enabled?: unknown;
    };
    const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
    if (!contactId) {
      return NextResponse.json({ error: "Missing contactId." }, { status: 400 });
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean." }, { status: 400 });
    }

    const { error } = await supabase
      .from("contacts")
      .update({ auto_translate_enabled: body.enabled })
      .eq("owner_id", user.id)
      .eq("phone", contactId);

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("auto_translate_enabled")) {
        return NextResponse.json(
          {
            error:
              "Missing contacts.auto_translate_enabled column. Apply sql/contact_conversations_auto_translate.sql",
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, contactId, enabled: body.enabled });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unexpected server error" },
      { status: 500 },
    );
  }
}
