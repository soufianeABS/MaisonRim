import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { uploadBufferToS3 } from '@/lib/r2-storage';

export const runtime = 'nodejs';

type GreenIncomingMessageWebhook = {
  typeWebhook?: string;
  timestamp?: number;
  idMessage?: string;
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
    };
    fileMessageData?: {
      downloadUrl?: string;
      caption?: string;
      fileName?: string;
      jpegThumbnail?: string;
      mimeType?: string;
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
    if (!isIncoming && !isOutgoingFromPhone && !isOutgoingFromApi) {
      console.log('Green webhook: ignored type', {
        typeWebhook,
        hasSenderData: !!body?.senderData,
        hasMessageData: !!body?.messageData,
      });
      return new NextResponse('OK', { status: 200 });
    }

    const chatId = body.senderData?.chatId || body.senderData?.sender;
    if (!chatId) return new NextResponse('OK', { status: 200 });

    const phoneNumber = extractPhoneFromChatId(chatId);
    if (!phoneNumber) return new NextResponse('OK', { status: 200 });

    const ts =
      typeof body.timestamp === 'number' ? body.timestamp : Math.floor(Date.now() / 1000);
    const messageTimestamp = new Date(ts * 1000).toISOString();

    const typeMessage = body.messageData?.typeMessage;
    const fileData = body.messageData?.fileMessageData;

    const messageTypeMap: Record<string, 'image' | 'video' | 'audio' | 'document' | 'text'> = {
      textMessage: 'text',
      extendedTextMessage: 'text',
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
      await supabase.from('contacts').upsert(
        [
          {
            owner_id: businessOwnerId,
            phone: phoneNumber,
            whatsapp_name: contactName,
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

    // Store message (upsert to handle retries/duplicates cleanly)
    const isSentByMe = isOutgoingFromPhone || isOutgoingFromApi;
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
          media_data: JSON.stringify({
            provider: 'green_api',
            typeWebhook,
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
          }),
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

