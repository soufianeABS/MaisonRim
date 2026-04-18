import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { uploadBufferToS3 } from "@/lib/r2-storage";
import { resolveFrozenWhatsappName } from "@/lib/contact-whatsapp-name";

export const runtime = "nodejs";

function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, "");
}

function extractPhoneFromChatId(chatId: string): string {
  // Examples: "79001234567@c.us", "7900...-123@g.us"
  return digitsOnly(chatId.split("@")[0] || chatId);
}

function normalizeChatId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s.includes("@")) return s;
  const digits = digitsOnly(s);
  if (!digits) return null;
  return `${digits}@c.us`;
}

type GreenChat = { chatId?: string; id?: string } | string;

type GreenHistoryMessage = {
  type?: "outgoing" | "incoming";
  idMessage?: string;
  timestamp?: number;
  typeMessage?: string;
  chatId?: string;
  senderId?: string;
  senderName?: string;
  senderContactName?: string;
  textMessage?: string;
  caption?: string;
  downloadUrl?: string;
  fileName?: string;
  mimeType?: string;
  extendedTextMessage?: { text?: string } | null;
};

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const resp = await fetch(url, init);
  const text = await resp.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: resp.ok, status: resp.status, json, text };
}

function greenEndpointVariants(base: string, path: string): string[] {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  // Green API docs vary between `/...` and `/v3/...` for some methods (e.g. getChats)
  return [`${b}/${p}`, `${b}/v3/${p}`];
}

function mapGreenTypeMessage(typeMessage?: string): "image" | "video" | "audio" | "document" | "text" {
  const messageTypeMap: Record<string, "image" | "video" | "audio" | "document" | "text"> = {
    textMessage: "text",
    extendedTextMessage: "text",
    imageMessage: "image",
    videoMessage: "video",
    audioMessage: "audio",
    documentMessage: "document",
    stickerMessage: "image",
  };
  return (typeMessage && messageTypeMap[typeMessage]) || "text";
}

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.log("[green sync] start", { userId: user.id });

    const admin = createServiceRoleClient();
    const { data: settings, error: settingsError } = await admin
      .from("user_settings")
      .select(
        "messaging_provider, green_api_url, green_id_instance, green_api_token_instance, default_contact_status_id",
      )
      .eq("id", user.id)
      .single();

    if (settingsError || !settings) {
      return NextResponse.json({ error: "Settings not found" }, { status: 400 });
    }

    const provider = (settings as { messaging_provider?: string | null }).messaging_provider || "whatsapp_cloud";
    if (provider !== "green_api") {
      return NextResponse.json(
        { error: "Green API is not the selected provider. Select Green API first, then retry." },
        { status: 400 },
      );
    }

    const apiUrl = (settings as { green_api_url?: string | null }).green_api_url;
    const idInstance = (settings as { green_id_instance?: string | null }).green_id_instance;
    const apiTokenInstance = (settings as { green_api_token_instance?: string | null }).green_api_token_instance;
    const defaultStatusId =
      (settings as { default_contact_status_id?: string | null })
        .default_contact_status_id ?? null;
    if (!apiUrl || !idInstance || !apiTokenInstance) {
      return NextResponse.json(
        { error: "Green API credentials not configured. Please complete setup first." },
        { status: 400 },
      );
    }
    console.log("[green sync] settings", {
      apiUrl,
      idInstance,
      tokenPrefix: String(apiTokenInstance).slice(0, 6),
    });

    // 1) List chats
    const getChatsPath = `waInstance${idInstance}/getChats/${apiTokenInstance}`;
    let chatsPayload: unknown = null;
    let chatsOk = false;
    let chatsErr: { status?: number; details?: unknown } | null = null;
    for (const url of greenEndpointVariants(apiUrl, getChatsPath)) {
      console.log("[green sync] getChats attempt", { url });
      const { ok, status, json, text } = await fetchJson(url, { method: "GET" });
      if (ok) {
        chatsPayload = json ?? (text ? text : null);
        chatsOk = true;
        console.log("[green sync] getChats ok", {
          url,
          isArray: Array.isArray(chatsPayload),
          sample: Array.isArray(chatsPayload) ? (chatsPayload as unknown[]).slice(0, 3) : chatsPayload,
        });
        break;
      }
      chatsErr = { status, details: json ?? text };
      console.log("[green sync] getChats failed", { url, status, details: chatsErr.details });
    }
    if (!chatsOk) {
      return NextResponse.json(
        { error: "Failed to list chats from Green API", details: chatsErr },
        { status: chatsErr?.status || 502 },
      );
    }

    const chatsArr = Array.isArray(chatsPayload) ? (chatsPayload as GreenChat[]) : [];
    console.log("[green sync] chats raw count", { count: chatsArr.length });

    const chatIds: string[] = chatsArr
      .map((c) => {
        if (typeof c === "string") return c;
        if (typeof c?.chatId === "string") return c.chatId;
        if (typeof c?.id === "string") return c.id;
        return "";
      })
      .map((c) => normalizeChatId(c))
      .filter((v): v is string => !!v);

    // For now, import only 1:1 chats (c.us) — groups (g.us) don't map cleanly to current schema.
    const directChatIds = chatIds.filter((id) => id.includes("@c.us"));
    console.log("[green sync] chatId normalization", {
      chatIdsCount: chatIds.length,
      directChatsCount: directChatIds.length,
      first: directChatIds.slice(0, 10),
    });

    let chatsProcessed = 0;
    let messagesUpserted = 0;
    let mediaStored = 0;

    // Simple safety limits to avoid runaway imports.
    const MAX_CHATS = 250;
    const MAX_MESSAGES_PER_CHAT = 1000;

    for (const chatId of directChatIds.slice(0, MAX_CHATS)) {
      const contactPhone = extractPhoneFromChatId(chatId);
      if (!contactPhone) continue;

      // 2) Get chat history
      const histUrl = `${apiUrl.replace(/\/+$/, "")}/waInstance${idInstance}/getChatHistory/${apiTokenInstance}`;
      console.log("[green sync] getChatHistory", { chatId, histUrl });
      const { ok, status, json, text } = await fetchJson(histUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, count: MAX_MESSAGES_PER_CHAT }),
      });
      if (!ok || !Array.isArray(json)) {
        console.warn("[green sync] getChatHistory failed:", { chatId, status, details: json ?? text });
        continue;
      }
      chatsProcessed += 1;

      const history = (json as GreenHistoryMessage[]).filter((m) => !!m?.idMessage);
      console.log("[green sync] history ok", {
        chatId,
        total: Array.isArray(json) ? (json as unknown[]).length : 0,
        withIdMessage: history.length,
        firstMsg: history[0]?.idMessage,
      });

      // Track best contact name and last_active from the messages we saw
      let bestName: string | null = null;
      let lastActiveTs = 0;

      // Upsert messages (descending order from API; DB ordering uses timestamp anyway)
      for (const m of history) {
        const idMessage = typeof m.idMessage === "string" ? m.idMessage : null;
        if (!idMessage) continue;

        const ts = typeof m.timestamp === "number" ? m.timestamp : null;
        if (!ts) continue;
        lastActiveTs = Math.max(lastActiveTs, ts);
        if (!bestName) bestName = m.senderContactName || m.senderName || null;

        const mappedType = mapGreenTypeMessage(m.typeMessage);
        const isMedia = mappedType !== "text";

        const textBody =
          (typeof m.textMessage === "string" && m.textMessage) ||
          (typeof m.extendedTextMessage?.text === "string" && m.extendedTextMessage.text) ||
          (typeof m.caption === "string" && m.caption) ||
          (m.typeMessage ? `[${m.typeMessage}]` : "[Message]");

        const messageTimestamp = new Date(ts * 1000).toISOString();
        const isSentByMe = m.type === "outgoing";

        let mediaUrl: string | null = null;
        let s3Uploaded = false;

        if (isMedia) {
          // Prefer direct downloadUrl from history; if absent, try downloadFile method.
          let downloadUrl =
            typeof m.downloadUrl === "string" && m.downloadUrl ? m.downloadUrl : null;
          if (!downloadUrl) {
            const dlUrl = `${apiUrl.replace(/\/+$/, "")}/waInstance${idInstance}/downloadFile/${apiTokenInstance}`;
            const dl = await fetchJson(dlUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId, idMessage }),
            });
            if (dl.ok && dl.json && typeof (dl.json as { downloadUrl?: unknown }).downloadUrl === "string") {
              downloadUrl = (dl.json as { downloadUrl: string }).downloadUrl;
            }
          }

          if (downloadUrl && typeof m.mimeType === "string" && m.mimeType) {
            try {
              const resp = await fetch(downloadUrl);
              if (resp.ok) {
                const arr = await resp.arrayBuffer();
                const buf = Buffer.from(arr);
                const maxBytes = 25 * 1024 * 1024;
                if (buf.length <= maxBytes) {
                  const presigned = await uploadBufferToS3(
                    buf,
                    contactPhone,
                    idMessage,
                    m.mimeType,
                    typeof m.fileName === "string" ? m.fileName : undefined,
                  );
                  if (presigned) {
                    mediaUrl = presigned;
                    s3Uploaded = true;
                    mediaStored += 1;
                  } else {
                    mediaUrl = downloadUrl;
                  }
                } else {
                  mediaUrl = downloadUrl;
                }
              } else {
                mediaUrl = downloadUrl;
              }
            } catch {
              mediaUrl = downloadUrl;
            }
          } else {
            mediaUrl = downloadUrl;
          }
        }

        // Message schema: sender_id = contact phone; receiver_id = owner user id
        const row = {
          id: idMessage,
          sender_id: contactPhone,
          receiver_id: user.id,
          content: textBody,
          timestamp: messageTimestamp,
          is_sent_by_me: isSentByMe,
          is_read: isSentByMe ? true : false,
          message_type: mappedType,
          media_data: JSON.stringify({
            provider: "green_api",
            typeMessage: m.typeMessage,
            ...(isMedia
              ? {
                  type: mappedType,
                  mime_type: typeof m.mimeType === "string" ? m.mimeType : null,
                  filename: typeof m.fileName === "string" ? m.fileName : null,
                  caption: typeof m.caption === "string" ? m.caption : null,
                  media_url: mediaUrl,
                  s3_uploaded: s3Uploaded,
                  green_download_url: typeof m.downloadUrl === "string" ? m.downloadUrl : null,
                }
              : {}),
          }),
        };

        const { error: upsertErr } = await admin.from("messages").upsert([row], { onConflict: "id" });
        if (!upsertErr) messagesUpserted += 1;
      }

      // 3) Upsert contact so it shows in inbox
      const lastActiveIso = new Date((lastActiveTs || Math.floor(Date.now() / 1000)) * 1000).toISOString();
      const { data: existingContact } = await admin
        .from("contacts")
        .select("whatsapp_name")
        .eq("owner_id", user.id)
        .eq("phone", contactPhone)
        .maybeSingle();

      const whatsappNameForUpsert = resolveFrozenWhatsappName(
        existingContact?.whatsapp_name,
        bestName,
      );

      await admin
        .from("contacts")
        .upsert(
          [
            {
              owner_id: user.id,
              phone: contactPhone,
              whatsapp_name: whatsappNameForUpsert,
              last_active: lastActiveIso,
            },
          ],
          { onConflict: "owner_id,phone" },
        );

      // Assign default tag on first contact creation (best-effort, do not override existing)
      if (defaultStatusId) {
        await admin.from("contact_status_assignments").upsert(
          [
            {
              owner_id: user.id,
              contact_id: contactPhone,
              status_id: defaultStatusId,
            },
          ],
          { onConflict: "owner_id,contact_id", ignoreDuplicates: true },
        );
      }
    }

    console.log("[green sync] done", { chatsProcessed, messagesUpserted, mediaStored });
    return NextResponse.json({
      success: true,
      chatsFound: directChatIds.length,
      chatsProcessed,
      messagesUpserted,
      mediaStored,
      limits: { maxChats: MAX_CHATS, maxMessagesPerChat: MAX_MESSAGES_PER_CHAT },
    });
  } catch (error) {
    console.error("Green history sync error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

