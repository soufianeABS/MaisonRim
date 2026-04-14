import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logWhatsAppGraphCall } from '@/lib/whatsapp-graph-debug';

/**
 * POST - Broadcast a message to all group members
 * Sends messages via WhatsApp and stores them in the database
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: groupId } = await params;
    const body = await request.json();
    const { message, templateName = null, templateData = null, variables = null } = body;

    // Validate input
    if (!message && !templateName) {
      return NextResponse.json(
        { error: 'Message or template name is required' },
        { status: 400 }
      );
    }

    // Verify group ownership and get group details
    const { data: group, error: groupError } = await supabase
      .from('chat_groups')
      .select('id, name, owner_id')
      .eq('id', groupId)
      .eq('owner_id', user.id)
      .single();

    if (groupError || !group) {
      return NextResponse.json(
        { error: 'Group not found or unauthorized' },
        { status: 404 }
      );
    }

    // Get all group members
    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('user_id')
      .eq('group_id', groupId);

    if (membersError) {
      console.error('Error fetching members:', membersError);
      return NextResponse.json(
        { error: 'Failed to fetch group members', details: membersError.message },
        { status: 500 }
      );
    }

    if (!members || members.length === 0) {
      return NextResponse.json(
        { error: 'Group has no members' },
        { status: 400 }
      );
    }

    // Get user settings for provider + credentials
    const { data: settings } = await supabase
      .from('user_settings')
      .select('messaging_provider, access_token, phone_number_id, api_version, green_api_url, green_id_instance, green_api_token_instance')
      .eq('id', user.id)
      .single();

    if (!settings) {
      return NextResponse.json({ error: 'Settings not configured' }, { status: 400 });
    }

    const provider =
      (settings as { messaging_provider?: string | null }).messaging_provider ||
      'whatsapp_cloud';

    if (provider === 'green_api' && templateName) {
      return NextResponse.json(
        { error: 'Template broadcasts are not supported with Green API.', provider },
        { status: 400 },
      );
    }

    const accessToken = settings.access_token;
    const phoneNumberId = settings.phone_number_id;
    const apiVersion = settings.api_version || 'v23.0';
    const whatsappApiUrl =
      provider === 'whatsapp_cloud' && phoneNumberId
        ? `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`
        : null;

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    const timestamp = new Date().toISOString();
    
    // Helper function to replace variables in text
    const replaceVariables = (text: string, componentVariables: Record<string, string>) => {
      let result = text;
      Object.entries(componentVariables).forEach(([key, value]) => {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      });
      return result;
    };

    // Send message to each member individually
    for (const member of members) {
      try {
        const cleanPhoneNumber = member.user_id.replace(/\s+/g, '').replace(/[^\d]/g, '');
        let whatsappResponse: Response | null = null;
        let messageContent = message;
        let messageMediaData = null;

        if (provider === 'green_api') {
          const greenApiUrl = (settings as { green_api_url?: string | null }).green_api_url;
          const idInstance = (settings as { green_id_instance?: string | null }).green_id_instance;
          const apiTokenInstance = (settings as { green_api_token_instance?: string | null })
            .green_api_token_instance;
          if (!greenApiUrl || !idInstance || !apiTokenInstance) {
            throw new Error('Green API credentials not configured');
          }

          const endpoint = `${greenApiUrl.replace(/\/+$/, '')}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`;
          const chatId = `${cleanPhoneNumber}@c.us`;

          whatsappResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chatId,
              message: message,
              linkPreview: false,
            }),
          });

          messageMediaData = JSON.stringify({
            provider: 'green_api',
            broadcast_group_id: groupId,
          });
        } else if (templateName && templateData) {
          if (!whatsappApiUrl || !accessToken) {
            throw new Error('WhatsApp credentials not configured');
          }
          // Build template components for WhatsApp API
          const templateComponents = [];

          // Add header parameters
          if (variables?.header && Object.keys(variables.header).length > 0) {
            const headerParams = Object.keys(variables.header)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(key => ({ type: 'text', text: variables.header[key] }));
            templateComponents.push({ type: 'header', parameters: headerParams });
          }

          // Add body parameters
          if (variables?.body && Object.keys(variables.body).length > 0) {
            const bodyParams = Object.keys(variables.body)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(key => ({ type: 'text', text: variables.body[key] }));
            templateComponents.push({ type: 'body', parameters: bodyParams });
          }

          // Add footer parameters
          if (variables?.footer && Object.keys(variables.footer).length > 0) {
            const footerParams = Object.keys(variables.footer)
              .sort((a, b) => parseInt(a) - parseInt(b))
              .map(key => ({ type: 'text', text: variables.footer[key] }));
            templateComponents.push({ type: 'footer', parameters: footerParams });
          }

          // Send template message via WhatsApp API
          const templateMessage = {
            messaging_product: 'whatsapp',
            to: cleanPhoneNumber,
            type: 'template',
            template: {
              name: templateName,
              language: {
                code: templateData.language || 'en'
              },
              ...(templateComponents.length > 0 && { components: templateComponents })
            }
          };

          logWhatsAppGraphCall(`broadcast: POST /messages (template) → ${cleanPhoneNumber}`, {
            url: whatsappApiUrl,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            jsonBody: templateMessage,
          });

          whatsappResponse = await fetch(whatsappApiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(templateMessage),
          });

          // Process template components for storage with variables replaced
          interface ProcessedComponent {
            format?: string;
            text?: string;
            media_url?: string | null;
          }
          
          interface ProcessedButton {
            type: string;
            text: string;
            url?: string;
            phone_number?: string;
          }
          
          const processedComponents = {
            header: null as ProcessedComponent | null,
            body: null as ProcessedComponent | null,
            footer: null as ProcessedComponent | null,
            buttons: [] as ProcessedButton[]
          };

          templateData.components?.forEach((component: { type: string; format?: string; text?: string; buttons?: ProcessedButton[] }) => {
            switch (component.type) {
              case 'HEADER':
                processedComponents.header = {
                  format: component.format || 'TEXT',
                  text: component.text && variables?.header ? replaceVariables(component.text, variables.header) : component.text,
                  media_url: null
                };
                break;
              case 'BODY':
                processedComponents.body = {
                  text: component.text && variables?.body ? replaceVariables(component.text, variables.body) : component.text
                };
                break;
              case 'FOOTER':
                processedComponents.footer = {
                  text: component.text && variables?.footer ? replaceVariables(component.text, variables.footer) : component.text
                };
                break;
              case 'BUTTONS':
                if (component.buttons) {
                  processedComponents.buttons = component.buttons.map((button) => ({
                    type: button.type,
                    text: button.text,
                    url: button.url,
                    phone_number: button.phone_number
                  }));
                }
                break;
            }
          });

          // Generate display content from body with variables replaced
          const bodyComponent = templateData.components?.find((c: { type: string }) => c.type === 'BODY');
          messageContent = bodyComponent?.text && variables?.body 
            ? replaceVariables(bodyComponent.text, variables.body)
            : (message || `Template: ${templateName}`);

          // Store template info in media_data for display
          messageMediaData = JSON.stringify({
            type: 'template',
            template_name: templateName,
            template_id: templateData.id,
            language: templateData.language,
            variables: variables,
            original_content: bodyComponent?.text || templateName,
            header: processedComponents.header,
            body: processedComponents.body,
            footer: processedComponents.footer,
            buttons: processedComponents.buttons,
            broadcast_group_id: groupId // Mark as broadcast message
          });
        } else {
          if (!whatsappApiUrl || !accessToken) {
            throw new Error('WhatsApp credentials not configured');
          }
          // Send text message via WhatsApp API
          const textMessage = {
            messaging_product: 'whatsapp',
            to: cleanPhoneNumber,
            type: 'text',
            text: {
              body: message
            }
          };

          logWhatsAppGraphCall(`broadcast: POST /messages (text) → ${cleanPhoneNumber}`, {
            url: whatsappApiUrl,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            jsonBody: textMessage,
          });

          whatsappResponse = await fetch(whatsappApiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(textMessage),
          });
          
          // Mark text message as broadcast
          messageMediaData = JSON.stringify({
            broadcast_group_id: groupId
          });
        }

        const responseData = await whatsappResponse.json();

        if (whatsappResponse.ok) {
          results.success++;

          // Store the broadcast message in the database for this recipient
          const messageId =
            provider === 'green_api'
              ? responseData.idMessage || `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
              : responseData.messages?.[0]?.id ||
                `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          const messageObject = {
            id: messageId,
            sender_id: cleanPhoneNumber, // The recipient's phone number
            receiver_id: user.id, // The broadcaster (current user)
            content: messageContent,
            timestamp: timestamp,
            is_sent_by_me: true, // Sent by the current user
            is_read: true, // Outgoing messages are already "read"
            message_type: templateName ? 'template' : 'text',
            media_data: messageMediaData
          };

          // Store in database
          const { error: dbError } = await supabase
            .from('messages')
            .insert([messageObject]);

          if (dbError) {
            console.error(`Error storing broadcast message for ${member.user_id}:`, dbError);
          } else {
            console.log(`Broadcast message stored for ${member.user_id}`);
          }
        } else {
          results.failed++;
          results.errors.push(`${member.user_id}: ${responseData.error?.message || 'Unknown error'}`);
          console.error(`WhatsApp API error for ${member.user_id}:`, responseData);
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`${member.user_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error(`Error sending to ${member.user_id}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Broadcast sent to ${results.success}/${members.length} members`,
      provider,
      results: {
        total: members.length,
        success: results.success,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
      },
    });

  } catch (error) {
    console.error('Error in broadcast API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

