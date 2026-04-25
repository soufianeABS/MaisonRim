import { NextRequest, NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { messageIdVariants, previewSnippet } from '@/lib/message-quote';
import { logWhatsAppGraphCall } from '@/lib/whatsapp-graph-debug';
import { sendTextMessage } from '@/lib/send-text-message';

/**
 * POST handler for sending WhatsApp messages
 * Accepts message data and sends it via WhatsApp Cloud API
 * Now uses user-specific access tokens and phone number IDs
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

    const {
      to,
      message,
      quotedMessageId,
      originalMessage,
      autoTranslatedFrom,
      autoTranslatedTo,
    } = await request.json();

    const result = await sendTextMessage({
      supabase,
      userId: user.id,
      to,
      message,
      quotedMessageId,
      originalMessage: typeof originalMessage === "string" ? originalMessage : null,
      autoTranslatedFrom: typeof autoTranslatedFrom === "string" ? autoTranslatedFrom : null,
      autoTranslatedTo: typeof autoTranslatedTo === "string" ? autoTranslatedTo : null,
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in send-message API:', error);
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
 * GET handler for checking API status (now user-specific)
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

    // Get user's WhatsApp API credentials
    const { data: settings } = await supabase
      .from('user_settings')
      .select('access_token_added, api_version')
      .eq('id', user.id)
      .single();

    const isConfigured = settings?.access_token_added || false;
    const apiVersion = settings?.api_version || 'v23.0';
    
    return NextResponse.json({
      status: 'WhatsApp Send Message API',
      configured: isConfigured,
      version: apiVersion,
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json({
      status: 'WhatsApp Send Message API',
      configured: false,
      error: 'Failed to check configuration',
      timestamp: new Date().toISOString()
    });
  }
} 