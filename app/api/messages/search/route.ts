import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Escape `%`, `_`, and `\` for PostgreSQL ILIKE patterns. */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export type MessageSearchMatch = {
  contactId: string;
  preview: string;
  matchCount: number;
  lastAt: string;
};

/**
 * GET ?q=... — search message bodies across all conversations for the signed-in user.
 * RLS limits rows to messages where sender_id or receiver_id is the current user.
 * Multiple words are ANDed (each must appear somewhere in content).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const raw = (searchParams.get('q') || '').trim();
    if (raw.length < 2) {
      return NextResponse.json({
        matches: [] as MessageSearchMatch[],
        contactIds: [] as string[],
      });
    }

    const terms = raw
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 12);

    if (terms.length === 0) {
      return NextResponse.json({ matches: [], contactIds: [] });
    }

    let query = supabase
      .from('messages')
      .select('id, sender_id, receiver_id, content, timestamp, message_type')
      .order('timestamp', { ascending: false })
      .limit(2500);

    for (const term of terms) {
      const esc = escapeLikePattern(term);
      query = query.ilike('content', `%${esc}%`);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('messages/search:', error);
      return NextResponse.json(
        { error: 'Search failed', details: error.message },
        { status: 500 },
      );
    }

    const uid = user.id;
    const countByContact = new Map<string, number>();
    const previewByContact = new Map<string, string>();
    const lastAtByContact = new Map<string, string>();

    for (const m of rows || []) {
      const other =
        m.sender_id === uid
          ? m.receiver_id
          : m.receiver_id === uid
            ? m.sender_id
            : null;
      if (!other || other === uid) continue;

      countByContact.set(other, (countByContact.get(other) || 0) + 1);
      if (!previewByContact.has(other)) {
        const text = (m.content ?? '').replace(/\s+/g, ' ').trim();
        previewByContact.set(other, text.slice(0, 200));
        lastAtByContact.set(other, m.timestamp);
      }
    }

    const matches: MessageSearchMatch[] = [];
    for (const [contactId, preview] of previewByContact) {
      matches.push({
        contactId,
        preview,
        matchCount: countByContact.get(contactId) || 0,
        lastAt: lastAtByContact.get(contactId) || '',
      });
    }

    matches.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
    });

    return NextResponse.json({
      matches,
      contactIds: matches.map((m) => m.contactId),
    });
  } catch (e) {
    console.error('messages/search:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
