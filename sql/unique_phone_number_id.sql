-- Phone Number ID must be unique across accounts (WhatsApp routes webhooks by phone_number_id).
-- Run in Supabase SQL Editor after user_settings exists.
-- Application also checks before save; this enforces at DB level.

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_phone_number_id_unique
  ON public.user_settings (phone_number_id)
  WHERE phone_number_id IS NOT NULL AND phone_number_id <> '';
