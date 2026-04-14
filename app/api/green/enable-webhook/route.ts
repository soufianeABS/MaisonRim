import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPublicSiteUrl } from '@/lib/site-url';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('webhook_token, green_api_url, green_id_instance, green_api_token_instance')
      .eq('id', user.id)
      .single();

    if (settingsError || !settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 400 });
    }

    const baseUrl = getPublicSiteUrl();
    if (!baseUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SITE_URL is not set. Set it to your public domain to enable webhooks.' },
        { status: 400 },
      );
    }

    if (!settings.webhook_token) {
      return NextResponse.json(
        { error: 'Webhook token not initialized. Open /protected/setup once to generate it.' },
        { status: 400 },
      );
    }

    if (!settings.green_api_url || !settings.green_id_instance || !settings.green_api_token_instance) {
      return NextResponse.json(
        { error: 'Green API credentials not configured. Please complete Green API setup first.' },
        { status: 400 },
      );
    }

    const webhookUrl = `${baseUrl.replace(/\/+$/, '')}/api/green/webhook/${settings.webhook_token}`;
    const endpoint =
      `${String(settings.green_api_url).replace(/\/+$/, '')}` +
      `/waInstance${settings.green_id_instance}` +
      `/setSettings/${settings.green_api_token_instance}`;

    const payload = {
      webhookUrl,
      webhookUrlToken: '',
      incomingWebhook: 'yes',
      outgoingWebhook: 'yes',
      outgoingAPIMessageWebhook: 'yes',
      stateWebhook: 'yes',
      // keepOnlineStatus: 'no',
      // markIncomingMessagesReaded: 'no',
    };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json().catch(async () => {
      const txt = await resp.text().catch(() => '');
      return { raw: txt };
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: 'Failed to enable Green API webhook', details: data },
        { status: resp.status },
      );
    }

    return NextResponse.json({
      success: true,
      webhookUrl,
      greenResponse: data,
    });
  } catch (error) {
    console.error('Enable Green webhook error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

