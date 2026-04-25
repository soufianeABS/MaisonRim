import { messageIdVariants, previewSnippet } from "@/lib/message-quote";
import { logWhatsAppGraphCall } from "@/lib/whatsapp-graph-debug";

type Provider = "whatsapp_cloud" | "green_api" | "meta_messenger";

type UserSettingsRow = {
  messaging_provider?: string | null;
  access_token?: string | null;
  phone_number_id?: string | null;
  api_version?: string | null;
  access_token_added?: boolean | null;
  green_api_url?: string | null;
  green_id_instance?: string | null;
  green_api_token_instance?: string | null;
  messenger_page_id?: string | null;
  messenger_page_access_token?: string | null;
};

type SupabaseLike = {
  from: (table: string) => {
    select: (...args: any[]) => any; // typed loosely; we only need chaining shape
    insert?: (...args: any[]) => any;
    upsert?: (...args: any[]) => any;
    update?: (...args: any[]) => any;
    delete?: (...args: any[]) => any;
    eq?: (...args: any[]) => any;
    gte?: (...args: any[]) => any;
    order?: (...args: any[]) => any;
    limit?: (...args: any[]) => any;
    maybeSingle?: (...args: any[]) => any;
    single?: (...args: any[]) => any;
    in?: (...args: any[]) => any;
  };
};

type WhatsAppGraphError = { message?: string; code?: number; type?: string };
type WhatsAppTextSendResponse = { messages?: Array<{ id?: string }> ; error?: WhatsAppGraphError } | { raw?: string };

function normalizeProvider(v: unknown): Provider {
  if (v === "green_api") return "green_api";
  if (v === "meta_messenger") return "meta_messenger";
  return "whatsapp_cloud";
}

export async function sendTextMessage(params: {
  supabase: SupabaseLike;
  userId: string;
  to: string;
  message: string;
  quotedMessageId?: string;
  originalMessage?: string | null;
  autoTranslatedFrom?: string | null;
  autoTranslatedTo?: string | null;
}): Promise<{
  success: true;
  deduped?: boolean;
  messageId: string;
  timestamp: string;
  provider: Provider;
  storedInDb: boolean;
  providerResponse?: unknown;
}> {
  const toRaw = String(params.to ?? "").trim();
  const message = String(params.message ?? "");
  if (!toRaw || !message) {
    throw new Error("Missing required parameters: to, message");
  }

  const digitsTo = toRaw.replace(/\s+/g, "").replace(/[^\d]/g, "");

  const { data: settings, error: settingsError } = await params.supabase
    .from("user_settings")
    .select(
      "messaging_provider, access_token, phone_number_id, api_version, access_token_added, green_api_url, green_id_instance, green_api_token_instance, messenger_page_id, messenger_page_access_token",
    )
    .eq("id", params.userId)
    .single();

  if (settingsError || !settings) {
    throw new Error("Messaging provider not configured. Please complete setup.");
  }

  const provider = normalizeProvider((settings as UserSettingsRow).messaging_provider);

  // Dedup guard (same as /api/send-message)
  const duplicateWindowStartIso = new Date(Date.now() - 3500).toISOString();
  const dedupeSenderId = provider === "meta_messenger" ? toRaw : digitsTo;
  const { data: recentDuplicate } = await params.supabase
    .from("messages")
    .select("id, timestamp")
    .eq("receiver_id", params.userId)
    .eq("sender_id", dedupeSenderId)
    .eq("is_sent_by_me", true)
    .eq("content", message)
    .gte("timestamp", duplicateWindowStartIso)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentDuplicate?.id) {
    return {
      success: true,
      deduped: true,
      messageId: recentDuplicate.id,
      timestamp: recentDuplicate.timestamp ?? new Date().toISOString(),
      provider,
      storedInDb: true,
    };
  }

  let providerMessageId: string | null = null;
  let providerRawResponse: unknown = null;

  if (provider === "meta_messenger") {
    const pageId = (settings as UserSettingsRow).messenger_page_id;
    const pageToken = (settings as UserSettingsRow).messenger_page_access_token;
    const apiVersion = (settings as UserSettingsRow).api_version || "v23.0";

    if (!pageId || !pageToken) {
      throw new Error("Meta Messenger credentials not configured. Please complete setup.");
    }

    const messengerApiUrl = `https://graph.facebook.com/${apiVersion}/${pageId}/messages`;
    const payload: Record<string, unknown> = {
      messaging_type: "RESPONSE",
      recipient: { id: toRaw },
      message: { text: message },
    };

    const resp = await fetch(messengerApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pageToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(async () => {
      const txt = await resp.text().catch(() => "");
      return { raw: txt };
    });

    providerRawResponse = data;
    if (!resp.ok) {
      throw new Error("Failed to send message via Meta Messenger");
    }

    providerMessageId =
      typeof (data as { message_id?: unknown }).message_id === "string"
        ? (data as { message_id: string }).message_id
        : null;
  } else if (provider === "green_api") {
    const greenApiUrl = (settings as UserSettingsRow).green_api_url;
    const idInstance = (settings as UserSettingsRow).green_id_instance;
    const apiTokenInstance = (settings as UserSettingsRow).green_api_token_instance;

    if (!greenApiUrl || !idInstance || !apiTokenInstance) {
      throw new Error("Green API credentials not configured. Please complete setup.");
    }

    const phoneRegex = /^\d{6,20}$/;
    if (!phoneRegex.test(digitsTo)) {
      throw new Error("Invalid phone number format");
    }

    const endpoint = `${greenApiUrl.replace(/\/+$/, "")}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;
    const chatId = `${digitsTo}@c.us`;

    const greenPayload: {
      chatId: string;
      message: string;
      linkPreview: boolean;
      quotedMessageId?: string;
    } = { chatId, message, linkPreview: false };
    if (params.quotedMessageId && params.quotedMessageId.trim()) {
      greenPayload.quotedMessageId = params.quotedMessageId.trim();
    }

    const greenResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(greenPayload),
    });

    const greenData = await greenResp.json().catch(async () => {
      const txt = await greenResp.text().catch(() => "");
      return { raw: txt };
    });

    providerRawResponse = greenData;
    if (!greenResp.ok) {
      throw new Error("Failed to send message via Green API");
    }

    providerMessageId =
      typeof (greenData as { idMessage?: unknown }).idMessage === "string"
        ? (greenData as { idMessage: string }).idMessage
        : null;
  } else {
    const phoneRegex = /^\d{10,15}$/;
    if (!phoneRegex.test(digitsTo)) {
      throw new Error("Invalid phone number format");
    }

    const accessTokenAdded = (settings as UserSettingsRow).access_token_added;
    const accessToken = (settings as UserSettingsRow).access_token;
    const phoneNumberId = (settings as UserSettingsRow).phone_number_id;
    const apiVersion = (settings as UserSettingsRow).api_version || "v23.0";

    if (!accessTokenAdded || !accessToken || !phoneNumberId) {
      throw new Error("WhatsApp Access Token not configured. Please complete setup.");
    }

    const whatsappApiUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    const messageData: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: digitsTo,
      type: "text",
      text: { body: message },
    };
    if (params.quotedMessageId && params.quotedMessageId.trim()) {
      messageData.context = { message_id: params.quotedMessageId.trim() };
    }

    logWhatsAppGraphCall("send-message: POST /messages (text) [server]", {
      url: whatsappApiUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      jsonBody: messageData,
    });

    const whatsappResponse = await fetch(whatsappApiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messageData),
    });

    const responseData: WhatsAppTextSendResponse = await whatsappResponse.json().catch(async () => {
      const txt = await whatsappResponse.text().catch(() => "");
      return { raw: txt };
    });
    providerRawResponse = responseData;

    if (!whatsappResponse.ok) {
      const metaErr = "error" in responseData ? responseData.error : undefined;
      const metaMessage = typeof metaErr?.message === "string" ? metaErr.message : null;
      const tokenExpired =
        metaErr?.code === 190 || (metaMessage?.toLowerCase().includes("access token") ?? false);
      const errorText = metaMessage
        ? tokenExpired
          ? `${metaMessage} Update your WhatsApp access token in Settings (Meta → Developers → your app → WhatsApp → API Setup).`
          : metaMessage
        : "Failed to send message via WhatsApp API";
      throw new Error(errorText);
    }

    providerMessageId =
      "messages" in responseData && Array.isArray(responseData.messages)
        ? responseData.messages?.[0]?.id ?? null
        : null;
  }

  const messageId = providerMessageId || `outgoing_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const timestamp = new Date().toISOString();

  const quoted =
    typeof params.quotedMessageId === "string" && params.quotedMessageId.trim().length > 0
      ? params.quotedMessageId.trim()
      : undefined;

  let quotedPreview: string | undefined;
  if (quoted) {
    const variants = messageIdVariants(quoted);
    const { data: rows } = await params.supabase.from("messages").select("content").in("id", variants).limit(1);
    const qRow = rows?.[0];
    if (qRow?.content && typeof qRow.content === "string") {
      quotedPreview = previewSnippet(qRow.content);
    }
  }

  const safeOriginalMessage =
    typeof params.originalMessage === "string" && params.originalMessage.trim().length > 0
      ? params.originalMessage.trim()
      : null;
  const safeTranslatedFrom =
    typeof params.autoTranslatedFrom === "string" && params.autoTranslatedFrom.trim().length > 0
      ? params.autoTranslatedFrom.trim()
      : null;
  const safeTranslatedTo =
    typeof params.autoTranslatedTo === "string" && params.autoTranslatedTo.trim().length > 0
      ? params.autoTranslatedTo.trim()
      : null;

  const senderIdForDb = provider === "meta_messenger" ? toRaw : digitsTo;

  const messageObject = {
    id: messageId,
    sender_id: senderIdForDb,
    receiver_id: params.userId,
    content: message,
    timestamp,
    is_sent_by_me: true,
    is_read: true,
    message_type: "text",
    media_data: JSON.stringify({
      provider,
      ...(safeOriginalMessage
        ? {
            original_text: safeOriginalMessage,
            translated_text: message,
            auto_translated_outgoing: true,
            ...(safeTranslatedFrom ? { auto_translated_from: safeTranslatedFrom } : {}),
            ...(safeTranslatedTo ? { auto_translated_to: safeTranslatedTo } : {}),
          }
        : {}),
      ...(quoted
        ? {
            quoted_message_id: quoted,
            ...(quotedPreview ? { quoted_message_preview: quotedPreview } : {}),
          }
        : {}),
      ...(providerRawResponse ? { provider_response: providerRawResponse } : {}),
    }),
  };

  const { error: dbError } = await params.supabase.from("messages").insert([messageObject]);

  // Ensure contact exists/updated (best-effort)
  try {
    await params.supabase.from("contacts").upsert(
      [{ owner_id: params.userId, phone: senderIdForDb, last_active: timestamp }],
      { onConflict: "owner_id,phone" },
    );
  } catch {
    // ignore
  }

  return {
    success: true,
    messageId: messageObject.id,
    timestamp,
    provider,
    providerResponse: providerRawResponse,
    storedInDb: !dbError,
  };
}

