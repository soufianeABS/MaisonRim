-- Per-contact key/value data + owner-wide suggested field names (Green API / general).
-- Run in Supabase SQL Editor after auth.users exists.

-- Suggested names shown when adding data in a chat (user can also type a custom name).
CREATE TABLE IF NOT EXISTS public.contact_data_field_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_data_field_templates_name_len CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT contact_data_field_templates_owner_name_unique UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS contact_data_field_templates_owner_idx
  ON public.contact_data_field_templates (owner_id, sort_order);

-- Values stored per contact (phone = digits only, same as contacts.phone).
CREATE TABLE IF NOT EXISTS public.contact_data_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  contact_phone text NOT NULL,
  field_key text NOT NULL,
  field_value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_data_entries_phone_len CHECK (char_length(contact_phone) BETWEEN 6 AND 20),
  CONSTRAINT contact_data_entries_key_len CHECK (char_length(field_key) BETWEEN 1 AND 200),
  CONSTRAINT contact_data_entries_value_len CHECK (char_length(field_value) <= 8000),
  CONSTRAINT contact_data_entries_owner_phone_key_unique UNIQUE (owner_id, contact_phone, field_key)
);

CREATE INDEX IF NOT EXISTS contact_data_entries_owner_phone_idx
  ON public.contact_data_entries (owner_id, contact_phone);

CREATE INDEX IF NOT EXISTS contact_data_entries_owner_updated_idx
  ON public.contact_data_entries (owner_id, updated_at DESC);

ALTER TABLE public.contact_data_field_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_data_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_data_field_templates_select_own" ON public.contact_data_field_templates;
CREATE POLICY "contact_data_field_templates_select_own"
  ON public.contact_data_field_templates FOR SELECT
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "contact_data_field_templates_insert_own" ON public.contact_data_field_templates;
CREATE POLICY "contact_data_field_templates_insert_own"
  ON public.contact_data_field_templates FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "contact_data_field_templates_update_own" ON public.contact_data_field_templates;
CREATE POLICY "contact_data_field_templates_update_own"
  ON public.contact_data_field_templates FOR UPDATE
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "contact_data_field_templates_delete_own" ON public.contact_data_field_templates;
CREATE POLICY "contact_data_field_templates_delete_own"
  ON public.contact_data_field_templates FOR DELETE
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "contact_data_entries_select_own" ON public.contact_data_entries;
CREATE POLICY "contact_data_entries_select_own"
  ON public.contact_data_entries FOR SELECT
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "contact_data_entries_insert_own" ON public.contact_data_entries;
CREATE POLICY "contact_data_entries_insert_own"
  ON public.contact_data_entries FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "contact_data_entries_update_own" ON public.contact_data_entries;
CREATE POLICY "contact_data_entries_update_own"
  ON public.contact_data_entries FOR UPDATE
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "contact_data_entries_delete_own" ON public.contact_data_entries;
CREATE POLICY "contact_data_entries_delete_own"
  ON public.contact_data_entries FOR DELETE
  USING (owner_id = auth.uid());

COMMENT ON TABLE public.contact_data_field_templates IS
  'Suggested field labels when adding contact-linked data from chat.';
COMMENT ON TABLE public.contact_data_entries IS
  'Key/value facts linked to a contact (owner_id + contact_phone).';
