import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { randomBytes } from 'crypto';

const DUPLICATE_PHONE_NUMBER_ID = 'DUPLICATE_PHONE_NUMBER_ID';

export const runtime = 'nodejs';

/**
 * Generate a unique webhook token
 */
function generateWebhookToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * POST handler for saving user settings (access token, webhook config, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Authentication error:', authError);
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      messaging_provider,
      provider_phone_number,
      access_token,
      phone_number_id,
      business_account_id,
      api_version,
      verify_token,
      messenger_page_id,
      messenger_page_access_token,
      messenger_app_secret,
      green_api_url,
      green_media_url,
      green_id_instance,
      green_api_token_instance,
    } = body;

    // Validate that at least one field is being updated
    if (
      messaging_provider === undefined &&
      provider_phone_number === undefined &&
      !access_token &&
      !phone_number_id &&
      !business_account_id &&
      !api_version &&
      !verify_token &&
      messenger_page_id === undefined &&
      messenger_page_access_token === undefined &&
      messenger_app_secret === undefined &&
      green_api_url === undefined &&
      green_media_url === undefined &&
      green_id_instance === undefined &&
      green_api_token_instance === undefined
    ) {
      return NextResponse.json(
        { error: 'At least one setting must be provided' },
        { status: 400 }
      );
    }

    // Build the update object
    const updateData: {
      updated_at: string;
      messaging_provider?: string;
      provider_phone_number?: string | null;
      access_token?: string;
      access_token_added?: boolean;
      phone_number_id?: string | null;
      business_account_id?: string;
      verify_token?: string;
      api_version?: string;
      webhook_verified?: boolean;
      webhook_token?: string;
      messenger_page_id?: string | null;
      messenger_page_access_token?: string | null;
      messenger_app_secret?: string | null;
      green_api_url?: string | null;
      green_media_url?: string | null;
      green_id_instance?: string | null;
      green_api_token_instance?: string | null;
    } = {
      updated_at: new Date().toISOString(),
    };

    if (messaging_provider !== undefined) {
      const provider =
        typeof messaging_provider === 'string' ? messaging_provider.trim() : '';
      if (
        provider &&
        provider !== 'whatsapp_cloud' &&
        provider !== 'green_api' &&
        provider !== 'meta_messenger'
      ) {
        return NextResponse.json(
          { error: 'Invalid messaging_provider. Use whatsapp_cloud, green_api, or meta_messenger.' },
          { status: 400 },
        );
      }
      if (provider) updateData.messaging_provider = provider;
    }

    if (provider_phone_number !== undefined) {
      const trimmed =
        typeof provider_phone_number === 'string'
          ? provider_phone_number.trim()
          : '';
      updateData.provider_phone_number = trimmed || null;
    }

    if (access_token !== undefined) {
      updateData.access_token = access_token;
      updateData.access_token_added = !!access_token;
    }

    if (phone_number_id !== undefined) {
      const trimmed =
        typeof phone_number_id === 'string' ? phone_number_id.trim() : '';
      updateData.phone_number_id = trimmed || null;
    }

    if (business_account_id !== undefined) {
      updateData.business_account_id = business_account_id;
    }

    if (api_version !== undefined) {
      updateData.api_version = api_version || 'v23.0';
    }

    if (verify_token !== undefined) {
      updateData.verify_token = verify_token;
    }

    if (messenger_page_id !== undefined) {
      const trimmed =
        typeof messenger_page_id === 'string' ? messenger_page_id.trim() : '';
      updateData.messenger_page_id = trimmed || null;
    }

    if (messenger_page_access_token !== undefined) {
      const trimmed =
        typeof messenger_page_access_token === 'string'
          ? messenger_page_access_token.trim()
          : '';
      updateData.messenger_page_access_token = trimmed || null;
    }

    if (messenger_app_secret !== undefined) {
      const trimmed =
        typeof messenger_app_secret === 'string' ? messenger_app_secret.trim() : '';
      updateData.messenger_app_secret = trimmed || null;
    }

    if (green_api_url !== undefined) {
      const trimmed =
        typeof green_api_url === 'string' ? green_api_url.trim() : '';
      updateData.green_api_url = trimmed || null;
    }

    if (green_media_url !== undefined) {
      const trimmed =
        typeof green_media_url === 'string' ? green_media_url.trim() : '';
      updateData.green_media_url = trimmed || null;
    }

    if (green_id_instance !== undefined) {
      const trimmed =
        typeof green_id_instance === 'string' ? green_id_instance.trim() : '';
      updateData.green_id_instance = trimmed || null;
    }

    if (green_api_token_instance !== undefined) {
      const trimmed =
        typeof green_api_token_instance === 'string'
          ? green_api_token_instance.trim()
          : '';
      updateData.green_api_token_instance = trimmed || null;
    }

    const newPhoneId = updateData.phone_number_id;
    if (
      newPhoneId !== undefined &&
      newPhoneId !== null &&
      String(newPhoneId).length > 0
    ) {
      try {
        const admin = createServiceRoleClient();
        const { data: conflictRows, error: conflictError } = await admin
          .from('user_settings')
          .select('id')
          .eq('phone_number_id', String(newPhoneId))
          .neq('id', user.id)
          .limit(1);

        if (!conflictError && conflictRows && conflictRows.length > 0) {
          return NextResponse.json(
            {
              error: DUPLICATE_PHONE_NUMBER_ID,
              message:
                'This Phone Number ID is already linked to another account. Use the number tied to your Meta app or a different WaChat account.',
            },
            { status: 409 },
          );
        }
      } catch (e) {
        console.error(
          'Duplicate phone_number_id check failed (service role?):',
          e,
        );
      }
    }

    console.log('Updating user settings for user:', user.id);

    // Check if user settings exist
    const { data: existingSettings } = await supabase
      .from('user_settings')
      .select('id, webhook_token')
      .eq('id', user.id)
      .single();

    let result;
    if (existingSettings) {
      // Generate webhook token if it doesn't exist
      if (!existingSettings.webhook_token) {
        updateData.webhook_token = generateWebhookToken();
        console.log('Generated new webhook token for user:', user.id);
      }
      
      // Update existing settings
      result = await supabase
        .from('user_settings')
        .update(updateData)
        .eq('id', user.id)
        .select()
        .single();
    } else {
      // Insert new settings with a webhook token
      const webhookToken = generateWebhookToken();
      console.log('Generated webhook token for new user settings:', user.id);
      
      result = await supabase
        .from('user_settings')
        .insert([{
          id: user.id,
          webhook_token: webhookToken,
          ...updateData,
        }])
        .select()
        .single();
    }

    const { data: settings, error: dbError } = result;

    if (dbError) {
      console.error('Database error:', dbError);
      if (dbError.code === '23505') {
        const msg = String(dbError.message ?? '');
        if (msg.includes('phone_number_id') || msg.includes('idx_user_settings_phone_number_id')) {
          return NextResponse.json(
            {
              error: DUPLICATE_PHONE_NUMBER_ID,
              message:
                'This Phone Number ID is already linked to another account. Use the number tied to your Meta app or a different WaChat account.',
            },
            { status: 409 },
          );
        }
      }
      return NextResponse.json(
        { error: 'Failed to save settings', details: dbError.message },
        { status: 500 }
      );
    }

    console.log('Settings saved successfully for user:', user.id);

    return NextResponse.json({
      success: true,
      message: 'Settings saved successfully',
      settings: {
        messaging_provider: (settings as { messaging_provider?: string | null })
          .messaging_provider,
        provider_phone_number: (settings as { provider_phone_number?: string | null })
          .provider_phone_number,
        access_token_added: settings.access_token_added,
        webhook_verified: settings.webhook_verified,
        api_version: settings.api_version,
        has_phone_number_id: !!settings.phone_number_id,
        has_business_account_id: !!settings.business_account_id,
        has_verify_token: !!settings.verify_token,
        webhook_token: settings.webhook_token,
        // Include actual values for display in setup page
        access_token: settings.access_token,
        phone_number_id: settings.phone_number_id,
        business_account_id: settings.business_account_id,
        verify_token: settings.verify_token,
        messenger_page_id: (settings as { messenger_page_id?: string | null })
          .messenger_page_id,
        messenger_page_access_token: (settings as {
          messenger_page_access_token?: string | null;
        }).messenger_page_access_token,
        messenger_app_secret: (settings as { messenger_app_secret?: string | null })
          .messenger_app_secret,
        green_api_url: (settings as { green_api_url?: string | null }).green_api_url,
        green_media_url: (settings as { green_media_url?: string | null })
          .green_media_url,
        green_id_instance: (settings as { green_id_instance?: string | null })
          .green_id_instance,
        green_api_token_instance: (settings as { green_api_token_instance?: string | null })
          .green_api_token_instance,
      },
    });

  } catch (error) {
    console.error('Error in save settings API:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      { status: 500 }
    );
  }
}

/**
 * GET handler for retrieving user settings
 */
export async function GET() {
  try {
    const supabase = await createClient();
    
    // Verify user authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Fetch user settings
    const { data: settings, error: dbError } = await supabase
      .from('user_settings')
      .select('*')
      .eq('id', user.id)
      .single();

    if (dbError && dbError.code !== 'PGRST116') { // PGRST116 is "not found" error
      console.error('Database error:', dbError);
      return NextResponse.json(
        { error: 'Failed to fetch settings' },
        { status: 500 }
      );
    }

    let updatedSettings = settings;
    
    // If no settings exist at all, create them with a webhook token
    if (!settings || dbError?.code === 'PGRST116') {
      const webhookToken = generateWebhookToken();
      console.log('Creating initial settings with webhook token for new user:', user.id);
      
      const { data: newSettings, error: insertError } = await supabase
        .from('user_settings')
        .insert([{
          id: user.id,
          webhook_token: webhookToken,
          api_version: 'v23.0'
        }])
        .select()
        .single();
      
      if (insertError) {
        console.error('Error creating settings:', insertError);
      } else {
        updatedSettings = newSettings;
      }
    }
    // If settings exist but no webhook token, generate one
    else if (settings && !settings.webhook_token) {
      const webhookToken = generateWebhookToken();
      const { data: updated } = await supabase
        .from('user_settings')
        .update({ webhook_token: webhookToken })
        .eq('id', user.id)
        .select()
        .single();
      
      if (updated) {
        updatedSettings = updated;
        console.log('Generated webhook token for existing user:', user.id);
      }
    }

    // Return settings (or null if not found)
    return NextResponse.json({
      settings: updatedSettings
        ? {
            messaging_provider:
              (updatedSettings as { messaging_provider?: string | null })
                .messaging_provider || 'whatsapp_cloud',
            provider_phone_number: (updatedSettings as { provider_phone_number?: string | null })
              .provider_phone_number,
            access_token_added: updatedSettings.access_token_added,
            webhook_verified: updatedSettings.webhook_verified,
            api_version: updatedSettings.api_version,
            has_access_token: !!updatedSettings.access_token,
            has_phone_number_id: !!updatedSettings.phone_number_id,
            has_business_account_id: !!updatedSettings.business_account_id,
            has_verify_token: !!updatedSettings.verify_token,
            webhook_token: updatedSettings.webhook_token,
            access_token: updatedSettings.access_token,
            phone_number_id: updatedSettings.phone_number_id,
            business_account_id: updatedSettings.business_account_id,
            verify_token: updatedSettings.verify_token,
            messenger_page_id: (updatedSettings as { messenger_page_id?: string | null })
              .messenger_page_id,
            messenger_page_access_token: (updatedSettings as {
              messenger_page_access_token?: string | null;
            }).messenger_page_access_token,
            messenger_app_secret: (updatedSettings as { messenger_app_secret?: string | null })
              .messenger_app_secret,
            green_api_url: (updatedSettings as { green_api_url?: string | null })
              .green_api_url,
            green_media_url: (updatedSettings as { green_media_url?: string | null })
              .green_media_url,
            green_id_instance: (updatedSettings as { green_id_instance?: string | null })
              .green_id_instance,
            green_api_token_instance: (updatedSettings as { green_api_token_instance?: string | null })
              .green_api_token_instance,
            created_at: updatedSettings.created_at,
            updated_at: updatedSettings.updated_at,
          }
        : null,
    });

  } catch (error) {
    console.error('Error in get settings API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

