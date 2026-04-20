-- Translation preferences and per-message cached translations (Gemini).
-- Run in Supabase SQL Editor.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS translation_target_language TEXT;

CREATE TABLE IF NOT EXISTS public.message_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  target_language TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, target_language)
);

CREATE INDEX IF NOT EXISTS idx_message_translations_user_lang
  ON public.message_translations (user_id, target_language);

ALTER TABLE public.message_translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_translations_select_own" ON public.message_translations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "message_translations_insert_own" ON public.message_translations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "message_translations_update_own" ON public.message_translations
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "message_translations_delete_own" ON public.message_translations
  FOR DELETE USING (auth.uid() = user_id);
