-- =============================================================================
-- Default "Field name" for contact data library (new entries)
-- =============================================================================
-- Stores the text used to pre-fill the Field name input on the contact data
-- page when adding a suggested field name.
--
-- Apply this in Supabase SQL editor / migration pipeline.
-- =============================================================================

alter table public.user_settings
  add column if not exists contact_data_default_field_name text null;
