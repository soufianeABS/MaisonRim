-- =============================================================================
-- Contact statuses (per account) + per-contact assignment
-- =============================================================================
-- This adds:
-- - public.contact_statuses: a user-owned list of statuses (name + color)
-- - public.contact_status_assignments: assigns one status to a contact for a user
-- - extends public.user_conversations view to include the assigned status
--
-- Why assignments are separate from public.users:
-- `public.users.id` is the contact phone number (shared across tenants). Storing a status
-- directly on `users` would leak/collide across accounts that talk to the same phone number.
-- Keeping assignments keyed by (owner_id, contact_id) avoids that.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Status definitions (per user)
-- -----------------------------------------------------------------------------
create table if not exists public.contact_statuses (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  name text not null,
  color text not null,
  rule text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_statuses_name_len check (char_length(name) between 1 and 120),
  constraint contact_statuses_rule_len check (char_length(rule) <= 4000),
  -- Accept hex colors like #10b981
  constraint contact_statuses_color_hex check (color ~ '^#[0-9a-fA-F]{6}$')
);

create unique index if not exists contact_statuses_owner_name_unique
  on public.contact_statuses (owner_id, lower(name));

alter table public.contact_statuses enable row level security;

drop policy if exists "contact_statuses_select_own_or_admin" on public.contact_statuses;
create policy "contact_statuses_select_own_or_admin"
  on public.contact_statuses
  for select
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contact_statuses_insert_own_or_admin" on public.contact_statuses;
create policy "contact_statuses_insert_own_or_admin"
  on public.contact_statuses
  for insert
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contact_statuses_update_own_or_admin" on public.contact_statuses;
create policy "contact_statuses_update_own_or_admin"
  on public.contact_statuses
  for update
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  )
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contact_statuses_delete_own_or_admin" on public.contact_statuses;
create policy "contact_statuses_delete_own_or_admin"
  on public.contact_statuses
  for delete
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

-- -----------------------------------------------------------------------------
-- Status assignment (one per owner+contact)
-- -----------------------------------------------------------------------------
create table if not exists public.contact_status_assignments (
  owner_id text not null,
  contact_id text not null,
  status_id uuid not null references public.contact_statuses(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, contact_id)
);

create index if not exists contact_status_assignments_owner_status_idx
  on public.contact_status_assignments (owner_id, status_id);

alter table public.contact_status_assignments enable row level security;

drop policy if exists "contact_status_assignments_select_own_or_admin" on public.contact_status_assignments;
create policy "contact_status_assignments_select_own_or_admin"
  on public.contact_status_assignments
  for select
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contact_status_assignments_insert_own_or_admin" on public.contact_status_assignments;
create policy "contact_status_assignments_insert_own_or_admin"
  on public.contact_status_assignments
  for insert
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contact_status_assignments_update_own_or_admin" on public.contact_status_assignments;
create policy "contact_status_assignments_update_own_or_admin"
  on public.contact_status_assignments
  for update
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  )
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "contact_status_assignments_delete_own_or_admin" on public.contact_status_assignments;
create policy "contact_status_assignments_delete_own_or_admin"
  on public.contact_status_assignments
  for delete
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

-- -----------------------------------------------------------------------------
-- Updated-at triggers (re-use the function from README if present)
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.update_updated_at_column') is not null then
    execute 'drop trigger if exists update_contact_statuses_updated_at on public.contact_statuses';
    execute 'create trigger update_contact_statuses_updated_at before update on public.contact_statuses for each row execute function public.update_updated_at_column()';

    execute 'drop trigger if exists update_contact_status_assignments_updated_at on public.contact_status_assignments';
    execute 'create trigger update_contact_status_assignments_updated_at before update on public.contact_status_assignments for each row execute function public.update_updated_at_column()';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Extend user_conversations view to include status info
-- -----------------------------------------------------------------------------
create or replace view public.user_conversations as
with unread_counts as (
  select
    sender_id,
    count(*) as unread_count
  from public.messages
  where is_read = false
  group by sender_id
),
latest_messages as (
  select distinct on (
    case
      when sender_id < receiver_id then sender_id || '-' || receiver_id
      else receiver_id || '-' || sender_id
    end
  )
    sender_id,
    receiver_id,
    content,
    message_type,
    timestamp as last_message_time,
    sender_id as last_message_sender
  from public.messages
  order by
    case
      when sender_id < receiver_id then sender_id || '-' || receiver_id
      else receiver_id || '-' || sender_id
    end,
    timestamp desc
)
select distinct
  u.id,
  coalesce(u.custom_name, u.whatsapp_name, u.name, u.id) as display_name,
  u.custom_name,
  u.whatsapp_name,
  u.name as original_name,
  u.last_active,
  coalesce(unread_counts.unread_count, 0) as unread_count,
  lm.content as last_message,
  lm.message_type as last_message_type,
  lm.last_message_time,
  lm.last_message_sender,
  case when unread_counts.unread_count > 0 then 1 else 0 end as has_unread,
  a.status_id,
  s.name as status_name,
  s.color as status_color,
  s.rule as status_rule
from public.users u
left join unread_counts on u.id = unread_counts.sender_id
left join latest_messages lm on u.id = lm.sender_id or u.id = lm.receiver_id
left join public.contact_status_assignments a
  on a.contact_id = u.id
  and a.owner_id = (select auth.uid()::text)
left join public.contact_statuses s
  on s.id = a.status_id
  and s.owner_id = (select auth.uid()::text)
where
  -- Only show contacts that have an actual conversation with the signed-in user
  u.id = (select auth.uid()::text)
  or exists (
    select 1
    from public.messages m
    where
      (m.sender_id = u.id and m.receiver_id = (select auth.uid()::text))
      or (m.receiver_id = u.id and m.sender_id = (select auth.uid()::text))
  )
order by has_unread desc, last_message_time desc nulls last;

