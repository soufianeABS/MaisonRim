-- Per-user saved prompts for "Analyze image" in chat (Supabase auth).
-- Run in Supabase SQL Editor after auth.users exists (same as sql/reply_agents.sql).
-- Requires public.update_updated_at_column() from reply_agents migration, or define it below.

CREATE TABLE IF NOT EXISTS image_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_image_prompts_user_id ON image_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_image_prompts_user_updated ON image_prompts(user_id, updated_at DESC);

ALTER TABLE image_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their image prompts"
  ON image_prompts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create image prompts"
  ON image_prompts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their image prompts"
  ON image_prompts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their image prompts"
  ON image_prompts FOR DELETE
  USING (auth.uid() = user_id);

-- Reuse trigger helper if already present (reply_agents.sql).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_image_prompts_updated_at ON image_prompts;
CREATE TRIGGER update_image_prompts_updated_at
  BEFORE UPDATE ON image_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
