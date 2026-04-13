import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST handler to update user custom name
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
    const { userId, customName } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing userId parameter' },
        { status: 400 }
      );
    }

    // Validate custom name length
    if (customName && customName.length > 100) {
      return NextResponse.json(
        { 
          error: 'Custom name too long', 
          message: 'Custom name must be 100 characters or less' 
        }, 
        { status: 400 }
      );
    }

    console.log(`Updating custom name for user ${userId} to "${customName}"`);

    // Update the contact's custom name (per owner)
    const { data: updatedUser, error: updateError } = await supabase
      .from('contacts')
      .update({ custom_name: customName })
      .eq('owner_id', user.id)
      .eq('phone', userId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating user name:', updateError);
      return NextResponse.json(
        { error: 'Failed to update user name', details: updateError.message },
        { status: 500 }
      );
    }

    if (!updatedUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    console.log('User name updated successfully:', updatedUser);

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.phone,
        name: updatedUser.custom_name || updatedUser.whatsapp_name || updatedUser.phone,
        custom_name: updatedUser.custom_name,
        whatsapp_name: updatedUser.whatsapp_name,
        last_active: updatedUser.last_active
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in update-name API:', error);
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
 * GET handler for checking API status
 */
export async function GET() {
  return NextResponse.json({
    status: 'Update User Name API',
    timestamp: new Date().toISOString()
  });
}