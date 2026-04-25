-- Add optional outbound message template per dynamic action.
-- Safe to re-run.
alter table public.api_actions
  add column if not exists message_template text not null default '';

comment on column public.api_actions.message_template is
  'Template rendered after action run. Supports {{received.*}} and {{given.*}} placeholders.';
