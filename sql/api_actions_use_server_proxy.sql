-- Add optional server-side "browser-like" proxy fetch for dynamic actions.
-- Apply in Supabase SQL editor. Safe to re-run.

alter table public.api_actions
  add column if not exists use_server_proxy boolean not null default false;

comment on column public.api_actions.use_server_proxy is
  'When true, /api/actions/run fetches the target URL with browser-like headers from the server.';
