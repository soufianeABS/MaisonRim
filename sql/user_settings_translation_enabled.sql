-- In-chat translation toggle (hides translate icon when off).
-- Run in Supabase SQL Editor if you already applied translation_message_translations.sql.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS translation_enabled BOOLEAN NOT NULL DEFAULT true;
