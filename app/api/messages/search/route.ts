import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Escape `%`, `_`, and `\` for PostgreSQL ILIKE patterns. */
function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/** Align contact ids across messages and contact_data_entries (digits-only phone). */
function normalizeContactKey(raw: string): string {
  const d = String(raw).replace(/\D/g, '');
  if (d.length >= 6) return d;
  return String(raw).trim();
}

/** Case-insensitive substring: every term must appear in field_key or field_value. */
function entryMatchesTerms(
  row: { field_key: string; field_value: string },
  terms: string[],
): boolean {
  const k = (row.field_key ?? '').toLowerCase();
  const v = (row.field_value ?? '').toLowerCase();
  return terms.every((term) => {
    const t = term.toLowerCase();
    return k.includes(t) || v.includes(t);
  });
}

export type MessageSearchMatch = {
  contactId: string;
  preview: string;
  matchCount: number;
  lastAt: string;
};

/**
 * GET ?q=... — search message bodies and contact notebook data (field_key / field_value)
 * across conversations for the signed-in user. RLS applies to both tables.
 * Multiple words are ANDed (each term must match somewhere in the message body, or in
 * field_key or field_value for the same entry).
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

    const entryQuery = supabase
      .from('contact_data_entries')
      .select('contact_phone, field_key, field_value, updated_at')
      .eq('owner_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(6000);

    const [
      { data: rows, error },
      { data: allEntries, error: entryError },
    ] = await Promise.all([query, entryQuery]);

    if (error) {
      console.error('messages/search:', error);
      return NextResponse.json(
        { error: 'Search failed', details: error.message },
        { status: 500 },
      );
    }

    if (entryError) {
      console.error('messages/search contact_data_entries:', entryError);
    }

    const entryRows = (allEntries || []).filter((row) =>
      entryMatchesTerms(
        {
          field_key: String(row.field_key ?? ''),
          field_value: String(row.field_value ?? ''),
        },
        terms,
      ),
    );

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

      const contactKey = normalizeContactKey(String(other));
      if (!contactKey) continue;

      countByContact.set(contactKey, (countByContact.get(contactKey) || 0) + 1);
      if (!previewByContact.has(contactKey)) {
        const text = (m.content ?? '').replace(/\s+/g, ' ').trim();
        previewByContact.set(contactKey, text.slice(0, 200));
        lastAtByContact.set(contactKey, m.timestamp);
      }
    }

    for (const row of entryRows || []) {
      const contactId = normalizeContactKey(String(row.contact_phone ?? ''));
      if (!contactId) continue;

      countByContact.set(contactId, (countByContact.get(contactId) || 0) + 1);

      const valueSnippet = (row.field_value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      const previewLine = `${row.field_key}: ${valueSnippet}`.slice(0, 180);
      if (!previewByContact.has(contactId)) {
        previewByContact.set(contactId, `Contact data — ${previewLine}`);
      }

      const t = row.updated_at as string;
      const prevLast = lastAtByContact.get(contactId);
      if (!prevLast || new Date(t).getTime() > new Date(prevLast).getTime()) {
        lastAtByContact.set(contactId, t);
      }
    }

    const matches: MessageSearchMatch[] = [];
    for (const contactId of countByContact.keys()) {
      matches.push({
        contactId,
        preview: previewByContact.get(contactId) || '',
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
