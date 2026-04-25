-- Auto send rendered message after dynamic action runs.
-- Safe to re-run.
alter table public.api_actions
  add column if not exists auto_send_message boolean not null default false;

comment on column public.api_actions.auto_send_message is
  'When true, the server sends message_template result automatically after action run.';

