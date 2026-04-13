import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ contactId: string }> },
) {
  const { contactId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("contact_status_assignments")
    .select("status_id")
    .eq("owner_id", user.id)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status_id: data?.status_id ?? null });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ contactId: string }> },
) {
  const { contactId } = await context.params;
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
  const statusId = typeof b.status_id === "string" ? b.status_id : null;

  if (!statusId) {
    const { error } = await supabase
      .from("contact_status_assignments")
      .delete()
      .eq("owner_id", user.id)
      .eq("contact_id", contactId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ status_id: null });
  }

  // Validate that the status belongs to the user
  const { data: owned, error: ownedError } = await supabase
    .from("contact_statuses")
    .select("id")
    .eq("id", statusId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (ownedError) {
    return NextResponse.json({ error: ownedError.message }, { status: 500 });
  }
  if (!owned) {
    return NextResponse.json({ error: "Invalid status_id." }, { status: 400 });
  }

  const { error } = await supabase.from("contact_status_assignments").upsert(
    {
      owner_id: user.id,
      contact_id: contactId,
      status_id: statusId,
    },
    { onConflict: "owner_id,contact_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status_id: statusId });
}

