-- =============================================================================
-- Contacts v2: separate business users from WhatsApp contacts (per account)
-- =============================================================================
-- This migration introduces:
-- - public.contacts(owner_id, phone, whatsapp_name, custom_name, last_active)
-- - public.contact_conversations view (replaces user_conversations in the app)
-- - Backfill contacts from existing public.messages rows
--
-- Notes:
-- - We keep the legacy public.users table for now (backwards compatibility).
-- - Messages remain stored as they are today: sender_id = contact phone, receiver_id = owner user id.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Contacts table (per owner)
-- -----------------------------------------------------------------------------
create table if not exists public.contacts (
  owner_id text not null,
  phone text not null,
  whatsapp_name text,
  custom_name text,
  last_active timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_phone_len check (char_length(phone) between 6 and 20),
  constraint contacts_custom_name_len check (custom_name is null or char_length(custom_name) <= 100),
  primary key (owner_id, phone)
);

alter table public.contacts enable row level security;

drop policy if exists "contacts_select_own_or_admin" on public.contacts;
create policy "contacts_select_own_or_admin"
  on public.contacts
  for select
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contacts_insert_own_or_admin" on public.contacts;
create policy "contacts_insert_own_or_admin"
  on public.contacts
  for insert
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contacts_update_own_or_admin" on public.contacts;
create policy "contacts_update_own_or_admin"
  on public.contacts
  for update
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  )
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contacts_delete_own_or_admin" on public.contacts;
create policy "contacts_delete_own_or_admin"
  on public.contacts
  for delete
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

-- -----------------------------------------------------------------------------
-- Updated-at trigger (re-use function from README if present)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.update_updated_at_column') is not null then
    execute 'drop trigger if exists update_contacts_updated_at on public.contacts';
    execute 'create trigger update_contacts_updated_at before update on public.contacts for each row execute function public.update_updated_at_column()';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Backfill contacts from existing messages
-- -----------------------------------------------------------------------------
insert into public.contacts (owner_id, phone, whatsapp_name, custom_name, last_active)
select
  m.receiver_id as owner_id,
  m.sender_id as phone,
  null as whatsapp_name,
  null as custom_name,
  max(m.timestamp) as last_active
from public.messages m
where m.receiver_id is not null
  and m.sender_id is not null
group by m.receiver_id, m.sender_id
on conflict (owner_id, phone) do nothing;

-- -----------------------------------------------------------------------------
-- Conversations view (owner-scoped) with optional status join if present
-- -----------------------------------------------------------------------------
create or replace view public.contact_conversations as
with my_messages as (
  select *
  from public.messages
  where receiver_id = (select auth.uid()::text)
),
unread_counts as (
  select
    sender_id,
    count(*) as unread_count
  from my_messages
  where is_read = false
  group by sender_id
),
latest_messages as (
  select distinct on (sender_id)
    sender_id,
    content,
    message_type,
    timestamp as last_message_time,
    sender_id as last_message_sender
  from my_messages
  order by sender_id, timestamp desc
)
select
  c.phone as id,
  coalesce(c.custom_name, c.whatsapp_name, c.phone) as display_name,
  c.custom_name,
  c.whatsapp_name,
  c.phone as original_name,
  c.last_active,
  coalesce(uc.unread_count, 0) as unread_count,
  lm.content as last_message,
  lm.message_type as last_message_type,
  lm.last_message_time,
  lm.last_message_sender,
  case when coalesce(uc.unread_count, 0) > 0 then 1 else 0 end as has_unread,
  a.status_id,
  s.name as status_name,
  s.color as status_color,
  s.rule as status_rule
from public.contacts c
left join unread_counts uc on c.phone = uc.sender_id
left join latest_messages lm on c.phone = lm.sender_id
left join public.contact_status_assignments a
  on a.contact_id = c.phone
  and a.owner_id = (select auth.uid()::text)
left join public.contact_statuses s
  on s.id = a.status_id
  and s.owner_id = (select auth.uid()::text)
where c.owner_id = (select auth.uid()::text)
order by has_unread desc, last_message_time desc nulls last;

