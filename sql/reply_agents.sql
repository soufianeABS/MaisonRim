-- Custom "Suggest reply" agents per Supabase auth user.
-- Run in Supabase SQL Editor after the base schema from README (requires auth.users and update_updated_at_column).

CREATE TABLE IF NOT EXISTS reply_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT '',
  task TEXT NOT NULL DEFAULT '',
  output_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  business_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  system_prompt TEXT DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.65,
  max_output_tokens INTEGER NOT NULL DEFAULT 512,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reply_agents_temperature_range CHECK (temperature >= 0 AND temperature <= 2),
  CONSTRAINT reply_agents_tokens_range CHECK (max_output_tokens >= 64 AND max_output_tokens <= 8192)
);

CREATE INDEX IF NOT EXISTS idx_reply_agents_user_id ON reply_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_reply_agents_user_created ON reply_agents(user_id, created_at DESC);

ALTER TABLE reply_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their reply agents"
  ON reply_agents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create reply agents"
  ON reply_agents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their reply agents"
  ON reply_agents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their reply agents"
  ON reply_agents FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_reply_agents_updated_at ON reply_agents;
CREATE TRIGGER update_reply_agents_updated_at
  BEFORE UPDATE ON reply_agents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
