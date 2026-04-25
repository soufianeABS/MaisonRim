-- =============================================================================
-- Dynamic Action Engine (Tag -> API mappings + logs + metadata storage)
-- =============================================================================
-- Apply in Supabase SQL editor. Safe to re-run.
--
-- "Conversation" in this app maps to public.contacts(owner_id, phone).
-- We store raw API responses in contacts.metadata (JSONB).
-- =============================================================================

create extension if not exists pgcrypto;

-- Store raw API responses + extracted values (per contact)
alter table public.contacts
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- ApiAction table: configuration for each tag (status)
create table if not exists public.api_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  -- Link to contact_statuses when using "tags" (recommended).
  status_id uuid null references public.contact_statuses(id) on delete cascade,
  tag_name text not null default '',
  url text not null,
  method text not null default 'POST',
  payload_template jsonb not null default '{}'::jsonb,
  response_map jsonb not null default '{}'::jsonb,
  message_template text not null default '',
  auto_send_message boolean not null default false,
  use_server_proxy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint api_actions_method_check check (method in ('GET','POST'))
);

create index if not exists api_actions_owner_status_idx
  on public.api_actions (owner_id, status_id);

create unique index if not exists api_actions_owner_status_unique
  on public.api_actions (owner_id, status_id)
  where status_id is not null;

alter table public.api_actions enable row level security;

drop policy if exists "api_actions_select_own_or_admin" on public.api_actions;
create policy "api_actions_select_own_or_admin"
  on public.api_actions
  for select
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "api_actions_insert_own_or_admin" on public.api_actions;
create policy "api_actions_insert_own_or_admin"
  on public.api_actions
  for insert
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "api_actions_update_own_or_admin" on public.api_actions;
create policy "api_actions_update_own_or_admin"
  on public.api_actions
  for update
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  )
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "api_actions_delete_own_or_admin" on public.api_actions;
create policy "api_actions_delete_own_or_admin"
  on public.api_actions
  for delete
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

-- Logs table (errors / traces)
create table if not exists public.action_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  contact_id text null,
  action_id uuid null references public.api_actions(id) on delete set null,
  tag_name text null,
  level text not null default 'error',
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint action_logs_level_check check (level in ('debug','info','warn','error'))
);

create index if not exists action_logs_owner_created_idx
  on public.action_logs (owner_id, created_at desc);

alter table public.action_logs enable row level security;

drop policy if exists "action_logs_select_own_or_admin" on public.action_logs;
create policy "action_logs_select_own_or_admin"
  on public.action_logs
  for select
  using (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

drop policy if exists "action_logs_insert_own_or_admin" on public.action_logs;
create policy "action_logs_insert_own_or_admin"
  on public.action_logs
  for insert
  with check (
    public.is_conversation_admin()
    or owner_id = (select auth.uid()::text)
  );

-- updated_at triggers if available
do $$
begin
  if to_regclass('public.update_updated_at_column') is not null then
    execute 'drop trigger if exists update_api_actions_updated_at on public.api_actions';
    execute 'create trigger update_api_actions_updated_at before update on public.api_actions for each row execute function public.update_updated_at_column()';
  end if;
end $$;

