-- =============================================================================
-- Default contact status per user
-- =============================================================================
-- Adds a single column on user_settings to store the default status id
-- used when creating a new contact/chat.
--
-- Apply this in Supabase SQL editor / migration pipeline.
--
-- NOTE: status id lives in public.contact_statuses(id)
-- =============================================================================

alter table public.user_settings
  add column if not exists default_contact_status_id uuid null;

-- Optional FK (commented out to avoid issues if you manage migrations differently)
-- alter table public.user_settings
--   add constraint user_settings_default_contact_status_fk
--   foreign key (default_contact_status_id)
--   references public.contact_statuses(id)
--   on delete set null;

