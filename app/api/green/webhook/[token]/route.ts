import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { uploadBufferToS3 } from '@/lib/r2-storage';
import { messageIdVariants, previewSnippet } from '@/lib/message-quote';
import { resolveFrozenWhatsappName } from '@/lib/contact-whatsapp-name';

export const runtime = 'nodejs';

type GreenIncomingMessageWebhook = {
  typeWebhook?: string;
  timestamp?: number;
  idMessage?: string;
  chatId?: string;
  status?: string;
  sendByApi?: boolean;
  description?: string;
  senderData?: {
    chatId?: string;
    sender?: string;
    chatName?: string;
    senderName?: string;
    senderContactName?: string;
  };
  messageData?: {
    typeMessage?: string;
    textMessageData?: {
      textMessage?: string;
    };
    extendedTextMessageData?: {
      text?: string;
      /** Quoted / reply-to message id (Green API). */
      stanzaId?: string;
    };
    fileMessageData?: {
      downloadUrl?: string;
      caption?: string;
      fileName?: string;
      jpegThumbnail?: string;
      mimeType?: string;
    };
    /**
     * Present when typeMessage is extendedTextMessage and the user replied (quoted)
     * — stanzaId may appear here instead of only under extendedTextMessageData.
     * @see https://green-api.com/en/docs/api/receiving/notifications-format/incoming-message/ExtendedTextMessage/
     */
    quotedMessage?: {
      stanzaId?: string;
      participant?: string;
      typeMessage?: string;
    };
  };
};

function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, '');
}

function extractPhoneFromChatId(chatId: string): string {
  // Examples: "79001234567@c.us", "7900...-123@g.us"
  return digitsOnly(chatId.split('@')[0] || chatId);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return NextResponse.json({
    ok: true,
    message:
      'Green webhook endpoint is reachable. Configure Green API to POST incomingMessageReceived here.',
    tokenPrefix: token?.slice(0, 8),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = createServiceRoleClient();

  try {
    if (!token) return new NextResponse('Forbidden', { status: 403 });

    console.log('Green webhook hit:', {
      tokenPrefix: token.slice(0, 8),
      contentType: request.headers.get('content-type'),
    });

    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select('id, messaging_provider, green_api_url, green_id_instance, green_api_token_instance, default_contact_status_id')
      .eq('webhook_token', token)
      .single();

    if (settingsError || !userSettings) {
      console.warn('Green webhook: token not found', {
        tokenPrefix: token.slice(0, 8),
        settingsError: settingsError?.message,
      });
      // Acknowledge to avoid retries
      return new NextResponse('OK', { status: 200 });
    }

    const businessOwnerId = userSettings.id as string;
    const provider =
      (userSettings as { messaging_provider?: string | null }).messaging_provider ||
      'whatsapp_cloud';
    if (provider !== 'green_api') {
      console.log('Green webhook ignored (provider not selected):', {
        provider,
        businessOwnerId,
      });
      return new NextResponse('OK', { status: 200 });
    }
    const body = (await request.json()) as GreenIncomingMessageWebhook;

    const typeWebhook = body?.typeWebhook;
    const isIncoming = typeWebhook === 'incomingMessageReceived';
    const isOutgoingFromPhone = typeWebhook === 'outgoingMessageReceived';
    const isOutgoingFromApi = typeWebhook === 'outgoingAPIMessageReceived';
    const isOutgoingStatus = typeWebhook === 'outgoingMessageStatus';
    if (!isIncoming && !isOutgoingFromPhone && !isOutgoingFromApi && !isOutgoingStatus) {
      console.log('Green webhook: ignored type', {
        typeWebhook,
        hasSenderData: !!body?.senderData,
        hasMessageData: !!body?.messageData,
      });
      return new NextResponse('OK', { status: 200 });
    }

    // WhatsApp-style read receipts: Green sends outgoingMessageStatus (sent → delivered → read).
    // Update existing row so the UI can show blue double-checks without relying on upsert (ignoreDuplicates).
    if (isOutgoingStatus) {
      const idMsg =
        typeof body.idMessage === "string" && body.idMessage.length > 0 ? body.idMessage : null;
      const stRaw = typeof body.status === "string" ? body.status.toLowerCase() : "";
      if (
        idMsg &&
        ["sent", "delivered", "read", "failed"].includes(stRaw)
      ) {
        const { data: row } = await supabase
          .from("messages")
          .select("id, media_data, is_sent_by_me")
          .eq("id", idMsg)
          .eq("receiver_id", businessOwnerId)
          .maybeSingle();
        if (row?.is_sent_by_me) {
          let md: Record<string, unknown> = {};
          try {
            if (row.media_data) {
              md =
                typeof row.media_data === "string"
                  ? (JSON.parse(row.media_data as string) as Record<string, unknown>)
                  : (row.media_data as Record<string, unknown>);
            }
          } catch {
            md = {};
          }
          md.green_recipient_status = stRaw;
          md.green_status_updated_at = new Date().toISOString();
          const { error: upErr } = await supabase
            .from("messages")
            .update({ media_data: JSON.stringify(md) })
            .eq("id", idMsg);
          if (!upErr) {
            console.log("Green webhook: recipient delivery status updated", {
              idMsg,
              st: stRaw,
            });
            return new NextResponse("OK", { status: 200 });
          }
        }
      }
    }

    const apiUrl = (userSettings as { green_api_url?: string | null }).green_api_url;
    const idInstance = (userSettings as { green_id_instance?: string | null }).green_id_instance;
    const apiTokenInstance = (userSettings as { green_api_token_instance?: string | null })
      .green_api_token_instance;

    const chatId = (isOutgoingStatus ? body.chatId : null) || body.senderData?.chatId || body.senderData?.sender;
    if (!chatId) return new NextResponse('OK', { status: 200 });

    const phoneNumber = extractPhoneFromChatId(chatId);
    if (!phoneNumber) return new NextResponse('OK', { status: 200 });

    // If we only received a status webhook (common for messages sent from phone),
    // fetch the full message from the journal and continue processing as a normal outgoing message.
    if (isOutgoingStatus) {
      const idMessage =
        typeof body.idMessage === "string" && body.idMessage.length > 0 ? body.idMessage : null;
      if (!apiUrl || !idInstance || !apiTokenInstance || !idMessage) {
        console.log("Green webhook: outgoingMessageStatus missing credentials or idMessage", {
          hasApiUrl: !!apiUrl,
          hasIdInstance: !!idInstance,
          hasToken: !!apiTokenInstance,
          hasIdMessage: !!idMessage,
        });
        return new NextResponse("OK", { status: 200 });
      }

      const getMessageEndpoint = `${apiUrl.replace(/\/+$/, "")}/waInstance${idInstance}/getMessage/${apiTokenInstance}`;
      let data: unknown = null;
      let hydratedFrom: "getMessage" | "getChatHistory" | null = null;

      // Green journal can lag. Retry a couple times before giving up.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const resp = await fetch(getMessageEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, idMessage }),
        });
        const payload = await resp.json().catch(async () => {
          const txt = await resp.text().catch(() => "");
          return { raw: txt };
        });
        if (resp.ok && payload && typeof payload === "object") {
          data = payload;
          hydratedFrom = "getMessage";
          break;
        }
        console.warn("Green webhook: getMessage not ready yet", {
          chatId,
          idMessage,
          attempt,
          status: resp.status,
        });
        await sleep(350 * attempt);
      }

      // Fallback: pull recent history and find the message id
      if (!hydratedFrom) {
        const historyEndpoint = `${apiUrl.replace(/\/+$/, "")}/waInstance${idInstance}/getChatHistory/${apiTokenInstance}`;
        const resp = await fetch(historyEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, count: 50 }),
        });
        const payload = await resp.json().catch(async () => {
          const txt = await resp.text().catch(() => "");
          return { raw: txt };
        });
        if (resp.ok && Array.isArray(payload)) {
          const found = (payload as Array<Record<string, unknown>>).find(
            (m) => String(m?.idMessage ?? "") === idMessage,
          );
          if (found) {
            data = found;
            hydratedFrom = "getChatHistory";
          }
        }
      }

      if (!hydratedFrom || !data || typeof data !== "object") {
        console.warn("Green webhook: could not hydrate message for outgoingMessageStatus", {
          chatId,
          idMessage,
          status: body.status,
          sendByApi: body.sendByApi,
        });
        return new NextResponse("OK", { status: 200 });
      }

      // Re-shape into the same format our handler expects for received messages.
      // getMessage returns fields similar to getChatHistory items (type/typeMessage/textMessage/downloadUrl/etc).
      const anyMsg = data as Record<string, unknown>;
      body.idMessage = String(anyMsg.idMessage ?? idMessage);
      body.timestamp = typeof anyMsg.timestamp === "number" ? (anyMsg.timestamp as number) : body.timestamp;
      body.senderData = {
        chatId: String(anyMsg.chatId ?? chatId),
        sender: undefined,
        chatName: undefined,
        senderName: typeof anyMsg.senderName === "string" ? (anyMsg.senderName as string) : undefined,
        senderContactName:
          typeof anyMsg.senderContactName === "string" ? (anyMsg.senderContactName as string) : undefined,
      };
      const typeMessage = typeof anyMsg.typeMessage === "string" ? (anyMsg.typeMessage as string) : undefined;
      const downloadUrl = typeof anyMsg.downloadUrl === "string" ? (anyMsg.downloadUrl as string) : undefined;
      const caption = typeof anyMsg.caption === "string" ? (anyMsg.caption as string) : undefined;
      const fileName = typeof anyMsg.fileName === "string" ? (anyMsg.fileName as string) : undefined;
      const mimeType = typeof anyMsg.mimeType === "string" ? (anyMsg.mimeType as string) : undefined;
      const textMessage = typeof anyMsg.textMessage === "string" ? (anyMsg.textMessage as string) : undefined;
      body.messageData = {
        typeMessage,
        textMessageData: textMessage ? { textMessage } : undefined,
        fileMessageData: downloadUrl
          ? {
              downloadUrl,
              caption,
              fileName,
              mimeType,
            }
          : undefined,
      };

      // For status webhooks, treat it as "sent by me".
      // (sendByApi false => sent from phone; true => sent by API).
      // We keep typeWebhook = outgoingMessageStatus but will compute isSentByMe later.
      console.log("Green webhook: hydrated outgoingMessageStatus via getMessage", {
        chatId,
        idMessage,
        typeMessage,
        sendByApi: body.sendByApi,
        status: body.status,
        hydratedFrom,
      });
    }

    const ts =
      typeof body.timestamp === 'number' ? body.timestamp : Math.floor(Date.now() / 1000);
    const messageTimestamp = new Date(ts * 1000).toISOString();

    const typeMessage = body.messageData?.typeMessage;
    const fileData = body.messageData?.fileMessageData;

    const messageTypeMap: Record<string, 'image' | 'video' | 'audio' | 'document' | 'text'> = {
      textMessage: 'text',
      extendedTextMessage: 'text',
      quotedMessage: 'text',
      imageMessage: 'image',
      videoMessage: 'video',
      audioMessage: 'audio',
      documentMessage: 'document',
    };

    const mappedType = typeMessage ? messageTypeMap[typeMessage] : 'text';
    const isMedia = mappedType !== 'text';

    const content =
      body.messageData?.textMessageData?.textMessage ??
      body.messageData?.extendedTextMessageData?.text ??
      fileData?.caption ??
      (typeMessage ? `[${typeMessage}]` : '[Message]');

    const id =
      typeof body.idMessage === 'string' && body.idMessage.length > 0
        ? body.idMessage
        : `green_in_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const contactName =
      body.senderData?.senderContactName ||
      body.senderData?.senderName ||
      body.senderData?.chatName ||
      null;

    // Best-effort fetch avatar (may be blocked by privacy settings)
    let avatarUrl: string | null = null;
    try {
      const apiUrl = (userSettings as { green_api_url?: string | null }).green_api_url;
      const idInstance = (userSettings as { green_id_instance?: string | null }).green_id_instance;
      const apiTokenInstance = (userSettings as { green_api_token_instance?: string | null })
        .green_api_token_instance;
      if (apiUrl && idInstance && apiTokenInstance) {
        const endpoint = `${apiUrl.replace(/\/+$/, '')}/waInstance${idInstance}/getAvatar/${apiTokenInstance}`;
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: `${phoneNumber}@c.us` }),
        });
        const data = await resp.json().catch(() => null);
        if (resp.ok && data && typeof data.urlAvatar === 'string' && data.urlAvatar) {
          avatarUrl = data.urlAvatar;
        }
      }
    } catch {
      // ignore
    }

    // Upsert contact (per owner) so it appears in the inbox
    try {
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('whatsapp_name')
        .eq('owner_id', businessOwnerId)
        .eq('phone', phoneNumber)
        .maybeSingle();

      const whatsappNameForUpsert = resolveFrozenWhatsappName(
        existingContact?.whatsapp_name,
        contactName,
      );

      await supabase.from('contacts').upsert(
        [
          {
            owner_id: businessOwnerId,
            phone: phoneNumber,
            whatsapp_name: whatsappNameForUpsert,
            avatar_url: avatarUrl,
            last_active: messageTimestamp,
          },
        ],
        { onConflict: 'owner_id,phone' },
      );

      // Assign default tag on first contact creation (best-effort, do not override existing)
      const defaultStatusId =
        (userSettings as { default_contact_status_id?: string | null })
          .default_contact_status_id ?? null;
      if (defaultStatusId) {
        await supabase.from("contact_status_assignments").upsert(
          [
            {
              owner_id: businessOwnerId,
              contact_id: phoneNumber,
              status_id: defaultStatusId,
            },
          ],
          { onConflict: "owner_id,contact_id", ignoreDuplicates: true },
        );
      }
    } catch {
      // ignore
    }

    // If it's a media message, download and upload to R2 so the UI can render it
    let mediaUrl: string | null = null;
    let s3Uploaded = false;
    let mediaMimeType: string | null = null;
    let mediaFilename: string | null = null;
    let mediaCaption: string | null = null;

    if (isMedia) {
      mediaMimeType = fileData?.mimeType || null;
      mediaFilename = fileData?.fileName || null;
      mediaCaption = fileData?.caption || null;

      const downloadUrl = fileData?.downloadUrl;
      if (downloadUrl && mediaMimeType) {
        try {
          const resp = await fetch(downloadUrl);
          if (resp.ok) {
            const arr = await resp.arrayBuffer();
            const buf = Buffer.from(arr);
            // Keep a conservative limit to avoid huge memory usage
            const maxBytes = 25 * 1024 * 1024;
            if (buf.length <= maxBytes) {
              const presigned = await uploadBufferToS3(
                buf,
                phoneNumber,
                id,
                mediaMimeType,
                mediaFilename,
              );
              if (presigned) {
                mediaUrl = presigned;
                s3Uploaded = true;
              }
            } else {
              console.warn('Green media too large to store in R2 (limit 25MB):', {
                bytes: buf.length,
                id,
                phoneNumber,
              });
              mediaUrl = downloadUrl;
            }
          } else {
            console.warn('Failed to download Green media:', resp.status, resp.statusText);
            mediaUrl = downloadUrl;
          }
        } catch (e) {
          console.warn('Error downloading/uploading Green media:', e);
          mediaUrl = downloadUrl || null;
        }
      } else {
        // No download url or mime type; keep placeholder
        mediaUrl = downloadUrl || null;
      }
    }

    // Reply / quote: Green puts stanzaId in extendedTextMessageData and/or messageData.quotedMessage
    // (extendedTextMessage replies often use quotedMessage.stanzaId only).
    const quotedStanzaIdRaw =
      (typeof body.messageData?.extendedTextMessageData?.stanzaId === 'string'
        ? body.messageData.extendedTextMessageData.stanzaId.trim()
        : '') ||
      (typeof body.messageData?.quotedMessage?.stanzaId === 'string'
        ? body.messageData.quotedMessage.stanzaId.trim()
        : '');
    const quotedStanzaId = quotedStanzaIdRaw || undefined;

    let quotedIdToStore: string | undefined = quotedStanzaId;
    let quotedPreview: string | undefined;
    if (quotedStanzaId) {
      const variants = messageIdVariants(quotedStanzaId);
      const { data: rows } = await supabase
        .from('messages')
        .select('id, content')
        .in('id', variants)
        .limit(1);
      const row = rows?.[0];
      if (row?.content && typeof row.content === 'string') {
        quotedPreview = previewSnippet(row.content);
      }
      if (row?.id) {
        quotedIdToStore = row.id;
      }
    }

    // Store message (upsert to handle retries/duplicates cleanly)
    const isSentByMe = isOutgoingFromPhone || isOutgoingFromApi || isOutgoingStatus;
    const greenMediaPayload: Record<string, unknown> = {
      provider: 'green_api',
      typeWebhook,
      outgoing_status: isOutgoingStatus
        ? {
            status: body.status ?? null,
            description: body.description ?? null,
            sendByApi: body.sendByApi ?? null,
          }
        : undefined,
      ...(isMedia
        ? {
            type: mappedType,
            mime_type: mediaMimeType,
            filename: mediaFilename,
            caption: mediaCaption,
            media_url: mediaUrl,
            s3_uploaded: s3Uploaded,
            green_download_url: fileData?.downloadUrl || null,
          }
        : {}),
      ...(quotedIdToStore
        ? {
            quoted_message_id: quotedIdToStore,
            ...(quotedPreview ? { quoted_message_preview: quotedPreview } : {}),
          }
        : {}),
    };

    const { error: msgErr } = await supabase.from('messages').upsert(
      [
        {
          id,
          sender_id: phoneNumber,
          receiver_id: businessOwnerId,
          content,
          timestamp: messageTimestamp,
          is_sent_by_me: isSentByMe,
          is_read: isSentByMe, // outgoing messages are already "read" by the sender
          message_type: mappedType,
          media_data: JSON.stringify(greenMediaPayload),
        },
      ],
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (msgErr) {
      console.warn('Green webhook: failed to store message', {
        id,
        typeWebhook,
        mappedType,
        error: msgErr.message,
      });
    } else {
      console.log('Green webhook: stored message', {
        id,
        typeWebhook,
        mappedType,
        chatId,
        phoneNumber,
        isSentByMe,
      });
    }

    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    // Still acknowledge to avoid repeated deliveries storms
    console.error('Green webhook error:', error);
    return new NextResponse('OK', { status: 200 });
  }
}

