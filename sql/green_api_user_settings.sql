-- Add Green API provider support to user_settings
-- Run this in Supabase SQL Editor (safe to re-run).

ALTER TABLE IF EXISTS public.user_settings
  ADD COLUMN IF NOT EXISTS messaging_provider TEXT DEFAULT 'whatsapp_cloud',
  ADD COLUMN IF NOT EXISTS provider_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS green_api_url TEXT,
  ADD COLUMN IF NOT EXISTS green_media_url TEXT,
  ADD COLUMN IF NOT EXISTS green_id_instance TEXT,
  ADD COLUMN IF NOT EXISTS green_api_token_instance TEXT;

-- Optional: if you want to restrict values, uncomment and adjust.
-- DO $$ BEGIN
--   ALTER TABLE public.user_settings
--     ADD CONSTRAINT user_settings_messaging_provider_chk
--     CHECK (messaging_provider IN ('whatsapp_cloud', 'green_api'));
-- EXCEPTION
--   WHEN duplicate_object THEN NULL;
-- END $$;

