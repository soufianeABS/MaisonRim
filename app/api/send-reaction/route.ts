import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { logWhatsAppGraphCall } from '@/lib/whatsapp-graph-debug';

/**
 * POST — send an emoji reaction to a specific WhatsApp message.
 * WhatsApp Cloud: Graph API type "reaction" (native reaction).
 * Green API: there is no public sendReaction endpoint (404). We use sendMessage
 * with only the emoji + quotedMessageId — WhatsApp shows a quoted reply with an
 * emoji (not the same as a native reaction bubble, but it is supported by Green).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { to, messageId, emoji } = body as {
      to?: string;
      messageId?: string;
      emoji?: string;
    };

    if (!to || !messageId || emoji === undefined || emoji === null) {
      return NextResponse.json(
        { error: 'Missing required parameters: to, messageId, emoji' },
        { status: 400 },
      );
    }

    const cleanPhoneNumber = to.replace(/\s+/g, '').replace(/[^\d]/g, '');
    const phoneRegex = /^\d{10,15}$/;
    if (!phoneRegex.test(cleanPhoneNumber)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 },
      );
    }

    const reactionStr = String(emoji);
    // Single emoji or empty string (remove reaction) — Meta allows empty string
    if (reactionStr.length > 8) {
      return NextResponse.json(
        { error: 'Reaction must be a single emoji or empty string' },
        { status: 400 },
      );
    }

    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select(
        'messaging_provider, access_token, phone_number_id, api_version, access_token_added, green_api_url, green_id_instance, green_api_token_instance',
      )
      .eq('id', user.id)
      .single();

    if (settingsError || !settings) {
      return NextResponse.json(
        { error: 'Messaging provider not configured.' },
        { status: 400 },
      );
    }

    const provider =
      (settings as { messaging_provider?: string | null }).messaging_provider ||
      'whatsapp_cloud';

    if (provider === 'green_api') {
      const greenApiUrl = (settings as { green_api_url?: string | null })
        .green_api_url;
      const idInstance = (settings as { green_id_instance?: string | null })
        .green_id_instance;
      const apiTokenInstance = (
        settings as { green_api_token_instance?: string | null }
      ).green_api_token_instance;

      if (!greenApiUrl || !idInstance || !apiTokenInstance) {
        return NextResponse.json(
          { error: 'Green API credentials not configured.' },
          { status: 400 },
        );
      }

      if (reactionStr.length === 0) {
        return NextResponse.json(
          {
            error:
              'Removing a reaction (empty emoji) is not supported for Green API from this endpoint.',
          },
          { status: 400 },
        );
      }

      const base = `${greenApiUrl.replace(/\/+$/, '')}/waInstance${idInstance}`;
      const chatId = `${cleanPhoneNumber}@c.us`;
      const quotedId = String(messageId).trim();

      const sendEndpoint = `${base}/sendMessage/${apiTokenInstance}`;
      const greenResp = await fetch(sendEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          message: reactionStr,
          quotedMessageId: quotedId,
          linkPreview: false,
        }),
      });

      const greenData = await greenResp.json().catch(async () => ({
        raw: await greenResp.text().catch(() => ''),
      }));

      if (!greenResp.ok) {
        return NextResponse.json(
          {
            error: 'Failed to send emoji via Green API (sendMessage + quote)',
            details: greenData,
          },
          { status: greenResp.status },
        );
      }

      return NextResponse.json({
        success: true,
        provider: 'green_api',
        greenDelivery:
          'quoted_emoji_reply' as const,
        note:
          'Green API has no public sendReaction HTTP method; this uses sendMessage with the emoji as the body and quotedMessageId (quoted reply, not a native reaction bubble).',
        providerResponse: greenData,
      });
    }

    if (!settings.access_token_added || !settings.access_token || !settings.phone_number_id) {
      return NextResponse.json(
        { error: 'WhatsApp Access Token not configured.' },
        { status: 400 },
      );
    }

    const accessToken = settings.access_token;
    const phoneNumberId = settings.phone_number_id;
    const apiVersion = settings.api_version || 'v23.0';

    const whatsappApiUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const messageData = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual' as const,
      to: cleanPhoneNumber,
      type: 'reaction' as const,
      reaction: {
        message_id: String(messageId).trim(),
        emoji: reactionStr,
      },
    };

    logWhatsAppGraphCall('send-reaction: POST /messages (reaction)', {
      url: whatsappApiUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      jsonBody: messageData,
    });

    const whatsappResponse = await fetch(whatsappApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageData),
    });

    const responseData = await whatsappResponse.json().catch(async () => ({
      raw: await whatsappResponse.text().catch(() => ''),
    }));

    if (!whatsappResponse.ok) {
      const metaErr = responseData?.error as
        | { message?: string; code?: number }
        | undefined;
      const metaMessage =
        typeof metaErr?.message === 'string' ? metaErr.message : 'Failed to send reaction';
      return NextResponse.json(
        { error: metaMessage, details: responseData },
        { status: whatsappResponse.status },
      );
    }

    return NextResponse.json({
      success: true,
      provider: 'whatsapp_cloud',
      providerResponse: responseData,
    });
  } catch (error) {
    console.error('send-reaction:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
