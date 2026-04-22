-- Add Meta Messenger provider support to user_settings
-- Run this in Supabase SQL Editor (safe to re-run).

ALTER TABLE IF EXISTS public.user_settings
  ADD COLUMN IF NOT EXISTS messenger_page_id TEXT,
  ADD COLUMN IF NOT EXISTS messenger_page_access_token TEXT,
  ADD COLUMN IF NOT EXISTS messenger_app_secret TEXT;

-- Optional: if you want to restrict values, uncomment and adjust.
-- DO $$ BEGIN
--   ALTER TABLE public.user_settings
--     ADD CONSTRAINT user_settings_messaging_provider_chk
--     CHECK (messaging_provider IN ('whatsapp_cloud', 'green_api', 'meta_messenger'));
-- EXCEPTION
--   WHEN duplicate_object THEN NULL;
-- END $$;

