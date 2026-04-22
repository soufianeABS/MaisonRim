import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

import { createServiceRoleClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type MessengerWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string; // page id
    time?: number;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
      };
    }>;
  }>;
};

function verifyMetaSignature(opts: {
  rawBody: string;
  appSecret: string;
  signatureHeader: string | null;
}): boolean {
  const { rawBody, appSecret, signatureHeader } = opts;
  if (!signatureHeader) return false;
  const [algo, theirSig] = signatureHeader.split('=', 2);
  if (algo !== 'sha256' || !theirSig) return false;
  const ours = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(ours, 'hex'), Buffer.from(theirSig, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Meta Messenger webhook verification.
 * Meta calls this endpoint with hub.* query params to verify your callback URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token: webhookToken } = await params;
    const searchParams = request.nextUrl.searchParams;
    const mode = searchParams.get('hub.mode');
    const verifyToken = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    if (mode !== 'subscribe' || !verifyToken || !webhookToken) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const supabase = createServiceRoleClient();
    const { data: settings, error } = await supabase
      .from('user_settings')
      .select('id, verify_token, webhook_token, messaging_provider')
      .eq('webhook_token', webhookToken)
      .single();

    if (error || !settings) return new NextResponse('Forbidden', { status: 403 });
    if ((settings as { verify_token?: string | null }).verify_token !== verifyToken) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    // Mark webhook as verified for this user (same flag used across providers)
    await supabase
      .from('user_settings')
      .update({
        webhook_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settings.id);

    return new NextResponse(challenge, { status: 200 });
  } catch (e) {
    console.error('Meta Messenger webhook verification error:', e);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

/**
 * Meta Messenger webhook events.
 * Stores incoming messages in `messages` and upserts the sender in `contacts`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token: webhookToken } = await params;
  const supabase = createServiceRoleClient();

  try {
    if (!webhookToken) return new NextResponse('Forbidden', { status: 403 });

    const rawBody = await request.text();
    let body: MessengerWebhookPayload;
    try {
      body = JSON.parse(rawBody) as MessengerWebhookPayload;
    } catch {
      return new NextResponse('OK', { status: 200 });
    }

    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select(
        'id, messaging_provider, messenger_page_id, messenger_app_secret, default_contact_status_id',
      )
      .eq('webhook_token', webhookToken)
      .single();

    if (settingsError || !userSettings) {
      // Acknowledge to avoid retries
      return new NextResponse('OK', { status: 200 });
    }

    const businessOwnerId = userSettings.id as string;
    const provider =
      (userSettings as { messaging_provider?: string | null }).messaging_provider ||
      'whatsapp_cloud';
    if (provider !== 'meta_messenger') {
      return new NextResponse('OK', { status: 200 });
    }

    // Optional signature verification (recommended). Only enforced when app secret exists.
    const appSecret = (userSettings as { messenger_app_secret?: string | null })
      .messenger_app_secret;
    if (appSecret) {
      const signatureHeader = request.headers.get('x-hub-signature-256');
      const ok = verifyMetaSignature({ rawBody, appSecret, signatureHeader });
      if (!ok) {
        console.warn('Meta Messenger webhook: signature verification failed', {
          tokenPrefix: webhookToken.slice(0, 8),
          hasSignature: !!signatureHeader,
        });
        return new NextResponse('Forbidden', { status: 403 });
      }
    }

    const pageId = (userSettings as { messenger_page_id?: string | null }).messenger_page_id;

    const entries = body.entry || [];
    for (const entry of entries) {
      const messaging = entry.messaging || [];
      for (const evt of messaging) {
        const mid = evt.message?.mid;
        const text = evt.message?.text;
        const isEcho = !!evt.message?.is_echo;

        if (!mid) continue;

        // Who is the "contact" in our DB?
        // - Incoming: sender is PSID
        // - Echo (outgoing): recipient is PSID (sender is the page)
        const contactId = isEcho ? evt.recipient?.id : evt.sender?.id;
        if (!contactId) continue;

        // If we have a page id configured, ignore events that are not for that page.
        // For incoming messages, recipient should be the page; for echos, sender is the page.
        if (pageId) {
          const pageCandidate = isEcho ? evt.sender?.id : evt.recipient?.id;
          if (pageCandidate && pageCandidate !== pageId) continue;
        }

        const tsMs =
          typeof evt.timestamp === 'number'
            ? evt.timestamp
            : typeof entry.time === 'number'
              ? entry.time * 1000
              : Date.now();
        const messageTimestamp = new Date(tsMs).toISOString();

        // Upsert contact (best-effort; name not available in webhook payload without profile API calls)
        try {
          await supabase.from('contacts').upsert(
            [
              {
                owner_id: businessOwnerId,
                phone: String(contactId),
                whatsapp_name: null,
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
            await supabase.from('contact_status_assignments').upsert(
              [
                {
                  owner_id: businessOwnerId,
                  contact_id: String(contactId),
                  status_id: defaultStatusId,
                },
              ],
              { onConflict: 'owner_id,contact_id', ignoreDuplicates: true },
            );
          }
        } catch {
          // ignore
        }

        const content = typeof text === 'string' && text.trim().length > 0 ? text : '[Message]';

        const metaPayload = {
          provider: 'meta_messenger',
          is_echo: isEcho,
          page_id: pageId ?? null,
          sender_id: evt.sender?.id ?? null,
          recipient_id: evt.recipient?.id ?? null,
        };

        await supabase.from('messages').upsert(
          [
            {
              id: mid,
              sender_id: String(contactId),
              receiver_id: businessOwnerId,
              content,
              timestamp: messageTimestamp,
              is_sent_by_me: isEcho,
              is_read: isEcho,
              message_type: 'text',
              media_data: JSON.stringify(metaPayload),
            },
          ],
          { onConflict: 'id', ignoreDuplicates: true },
        );
      }
    }

    return new NextResponse('OK', { status: 200 });
  } catch (e) {
    // Acknowledge to avoid repeated delivery storms
    console.error('Meta Messenger webhook error:', e);
    return new NextResponse('OK', { status: 200 });
  }
}

