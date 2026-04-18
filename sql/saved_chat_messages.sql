-- Saved text snippets for Green API (and general use): pick in chat to paste into composer.
-- Run in Supabase SQL Editor after core auth tables exist.

CREATE TABLE IF NOT EXISTS public.saved_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_chat_messages_owner_idx
  ON public.saved_chat_messages (owner_id);

CREATE INDEX IF NOT EXISTS saved_chat_messages_owner_sort_idx
  ON public.saved_chat_messages (owner_id, sort_order);

ALTER TABLE public.saved_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_chat_messages_select_own" ON public.saved_chat_messages;
CREATE POLICY "saved_chat_messages_select_own"
  ON public.saved_chat_messages
  FOR SELECT
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "saved_chat_messages_insert_own" ON public.saved_chat_messages;
CREATE POLICY "saved_chat_messages_insert_own"
  ON public.saved_chat_messages
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "saved_chat_messages_update_own" ON public.saved_chat_messages;
CREATE POLICY "saved_chat_messages_update_own"
  ON public.saved_chat_messages
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "saved_chat_messages_delete_own" ON public.saved_chat_messages;
CREATE POLICY "saved_chat_messages_delete_own"
  ON public.saved_chat_messages
  FOR DELETE
  USING (owner_id = auth.uid());

COMMENT ON TABLE public.saved_chat_messages IS
  'Per-user canned messages; Green API chat uses these instead of Meta message templates.';
