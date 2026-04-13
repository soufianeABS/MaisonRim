-- =============================================================================
-- Drop legacy foreign keys from messages -> users
-- =============================================================================
-- After introducing public.contacts (owner-scoped), messages.sender_id is a contact phone
-- and receiver_id is the owner auth user id. Keeping FK constraints to public.users breaks
-- inserts (especially in dev/test), because we no longer create contact rows in public.users.
--
-- Run this in Supabase SQL Editor.
-- =============================================================================

do $$
begin
  -- Drop constraints if they exist (names may vary by install)
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_sender_id_fkey'
  ) then
    execute 'alter table public.messages drop constraint messages_sender_id_fkey';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_receiver_id_fkey'
  ) then
    execute 'alter table public.messages drop constraint messages_receiver_id_fkey';
  end if;
end $$;

