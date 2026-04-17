-- =============================================================================
-- Contact statuses: add rule_mode (ai vs hard)
-- =============================================================================
-- When rule_mode = 'ai', the rule is appended to the AI prompt.
-- When rule_mode = 'hard', the rule is returned verbatim as the suggested reply
-- (no model call).
--
-- Apply this in Supabase SQL editor / migration pipeline.
-- =============================================================================

alter table public.contact_statuses
  add column if not exists rule_mode text not null default 'ai';

do $$
begin
  -- Add/repair the check constraint if missing.
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.contact_statuses'::regclass
      and conname = 'contact_statuses_rule_mode_check'
  ) then
    execute $$alter table public.contact_statuses
      add constraint contact_statuses_rule_mode_check
      check (rule_mode in ('ai','hard'))$$;
  end if;
end $$;

