import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET - Fetch all groups for the authenticated user
 */
export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get groups with member counts using the database function
    const { data: groups, error: groupsError } = await supabase.rpc(
      'get_user_groups_with_counts'
    );

    if (groupsError) {
      console.error('Error fetching groups:', groupsError);
      return NextResponse.json(
        { error: 'Failed to fetch groups', details: groupsError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      groups: groups || [],
    });

  } catch (error) {
    console.error('Error in groups API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new group
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, description, memberIds } = body;

    // Validate input
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Group name is required' },
        { status: 400 }
      );
    }

    // Create the group
    const { data: group, error: createError } = await supabase
      .from('chat_groups')
      .insert([{
        owner_id: user.id,
        name: name.trim(),
        description: description?.trim() || null,
      }])
      .select()
      .single();

    if (createError) {
      console.error('Error creating group:', createError);
      return NextResponse.json(
        { error: 'Failed to create group', details: createError.message },
        { status: 500 }
      );
    }

    // Add members if provided
    if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
      const members = memberIds.map(userId => ({
        group_id: group.id,
        user_id: userId,
      }));

      const { error: membersError } = await supabase
        .from('group_members')
        .insert(members);

      if (membersError) {
        console.error('Error adding members:', membersError);
        // Don't fail the entire request, just log the error
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Group created successfully',
      group,
    });

  } catch (error) {
    console.error('Error in create group API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

