import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

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
      .select('id, messaging_provider, green_api_url, green_id_instance, green_api_token_instance')
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

    const isIncoming = body?.typeWebhook === 'incomingMessageReceived';
    const isOutgoingFromPhone = body?.typeWebhook === 'outgoingMessageReceived';
    if (!isIncoming && !isOutgoingFromPhone) {
      console.log('Green webhook: ignored type', { typeWebhook: body?.typeWebhook });
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
    const content =
      body.messageData?.textMessageData?.textMessage ??
      body.messageData?.extendedTextMessageData?.text ??
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
    } catch {
      // ignore
    }

    // Store message
    await supabase.from('messages').insert([
      {
        id,
        sender_id: phoneNumber,
        receiver_id: businessOwnerId,
        content,
        timestamp: messageTimestamp,
        is_sent_by_me: isOutgoingFromPhone,
        is_read: isOutgoingFromPhone, // outgoing messages are already "read" by the sender
        message_type: 'text',
        media_data: JSON.stringify({ provider: 'green_api', typeWebhook: body.typeWebhook }),
      },
    ]);

    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    // Still acknowledge to avoid repeated deliveries storms
    console.error('Green webhook error:', error);
    return new NextResponse('OK', { status: 200 });
  }
}

