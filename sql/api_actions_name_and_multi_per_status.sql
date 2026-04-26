alter table public.api_actions
  add column if not exists action_name text not null default '';

drop index if exists public.api_actions_owner_status_unique;

comment on column public.api_actions.action_name is
  'Human-friendly action name shown in UI and run button labels.';
