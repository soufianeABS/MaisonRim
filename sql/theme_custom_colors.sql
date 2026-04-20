-- Per-user UI theme overrides (CSS variable triplets). Run in Supabase SQL Editor.

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS theme_custom_colors JSONB DEFAULT NULL;
