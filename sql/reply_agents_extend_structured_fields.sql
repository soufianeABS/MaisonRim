-- Adds persona, task, and rule lists to reply_agents (run once if you already created the table).
-- Safe to re-run: uses IF NOT EXISTS.

ALTER TABLE reply_agents ADD COLUMN IF NOT EXISTS persona TEXT NOT NULL DEFAULT '';
ALTER TABLE reply_agents ADD COLUMN IF NOT EXISTS task TEXT NOT NULL DEFAULT '';
ALTER TABLE reply_agents ADD COLUMN IF NOT EXISTS output_rules JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE reply_agents ADD COLUMN IF NOT EXISTS business_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE reply_agents ALTER COLUMN system_prompt DROP NOT NULL;
ALTER TABLE reply_agents ALTER COLUMN system_prompt SET DEFAULT '';

UPDATE reply_agents SET system_prompt = '' WHERE system_prompt IS NULL;
