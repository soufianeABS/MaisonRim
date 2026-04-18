import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePresignedUrl } from "@/lib/r2-storage";

export const runtime = "nodejs";

function asciiFilename(name: string): string {
  const s = name.replace(/[^\x20-\x7E]/g, "_").slice(0, 180);
  return s || "download";
}

/**
 * Server-side media download so the browser never needs CORS on R2 / external URLs.
 * POST { messageId: string, filename?: string }
 */
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

    let body: { messageId?: string; filename?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const messageId = typeof body.messageId === "string" ? body.messageId.trim() : "";
    if (!messageId) {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }

    const filenameHint =
      typeof body.filename === "string" && body.filename.trim()
        ? body.filename.trim()
        : "download";

    const { data: message, error: messageError } = await supabase
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .single();

    if (messageError || !message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (message.sender_id !== user.id && message.receiver_id !== user.id) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!message.media_data) {
      return NextResponse.json({ error: "Message has no media" }, { status: 400 });
    }

    let mediaData: Record<string, unknown>;
    try {
      mediaData =
        typeof message.media_data === "string"
          ? (JSON.parse(message.media_data) as Record<string, unknown>)
          : (message.media_data as Record<string, unknown>);
    } catch {
      return NextResponse.json({ error: "Invalid media_data" }, { status: 400 });
    }

    const ownerIdForS3 = message.is_sent_by_me
      ? message.receiver_id
      : message.sender_id;

    const id = typeof mediaData.id === "string" ? mediaData.id : "";
    const mimeType = typeof mediaData.mime_type === "string" ? mediaData.mime_type : "";
    let urlToFetch =
      typeof mediaData.media_url === "string" && mediaData.media_url.trim()
        ? mediaData.media_url.trim()
        : "";

    async function fetchBinary(url: string) {
      return fetch(url, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
      });
    }

    let upstream = urlToFetch ? await fetchBinary(urlToFetch) : null;

    if (
      (!upstream || !upstream.ok) &&
      id &&
      mimeType &&
      typeof ownerIdForS3 === "string"
    ) {
      const fresh = await generatePresignedUrl(ownerIdForS3, id, mimeType);
      if (fresh) {
        urlToFetch = fresh;
        upstream = await fetchBinary(fresh);
      }
    }

    if (!upstream || !upstream.ok) {
      const status = upstream?.status ?? 502;
      return NextResponse.json(
        { error: "Could not fetch media", status },
        { status: 502 },
      );
    }

    const contentType =
      upstream.headers.get("content-type") || "application/octet-stream";
    const safe = asciiFilename(filenameHint);
    const cd = `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filenameHint)}`;

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": cd,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("media/download:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Download failed" },
      { status: 500 },
    );
  }
}
