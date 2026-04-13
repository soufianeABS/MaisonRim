-- =============================================================================
-- Tenant isolation: per-account conversations + future admin role
-- =============================================================================
-- Run in Supabase SQL Editor AFTER the base schema from README.md (tables + RLS enabled).
--
-- What this does:
-- 1. Replaces permissive "authenticated users see all messages/users" policies with
--    row-level rules: a normal user only sees rows where they are sender_id or receiver_id
--    (both stored as text; auth user id is auth.uid()::text).
-- 2. Hardens SECURITY DEFINER RPCs (mark read, unread list, custom name) so they cannot
--    be abused across tenants.
-- 3. Adds public.is_conversation_admin() — true when JWT app_metadata.role = 'admin'.
--    Grant admin in Dashboard: Authentication → Users → user → App metadata:
--    { "role": "admin" }  (merge with existing keys)
--
-- After running, verify with two test accounts: each should only see their own rows in
-- Table Editor when using the anon key (or as that user in the app).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_conversation_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_conversation_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_admin() TO service_role;

-- -----------------------------------------------------------------------------
-- Drop legacy permissive policies (names from README)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view all users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can insert users" ON public.users;
DROP POLICY IF EXISTS "Authenticated users can update users" ON public.users;

DROP POLICY IF EXISTS "Users can view all messages" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update messages" ON public.messages;

-- Idempotent: drop our policies if re-running this migration
DROP POLICY IF EXISTS "users_select_tenant_or_admin" ON public.users;
DROP POLICY IF EXISTS "users_insert_self_or_admin" ON public.users;
DROP POLICY IF EXISTS "users_update_tenant_or_admin" ON public.users;

DROP POLICY IF EXISTS "messages_select_tenant_or_admin" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_tenant_or_admin" ON public.messages;
DROP POLICY IF EXISTS "messages_update_tenant_or_admin" ON public.messages;

DROP POLICY IF EXISTS "chat_groups_select_admin" ON public.chat_groups;
DROP POLICY IF EXISTS "group_members_select_admin" ON public.group_members;

-- -----------------------------------------------------------------------------
-- USERS (contacts + own business row keyed by auth uid as text)
-- -----------------------------------------------------------------------------
CREATE POLICY "users_select_tenant_or_admin"
  ON public.users
  FOR SELECT
  USING (
    public.is_conversation_admin()
    OR id = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE (
          (m.sender_id = public.users.id AND m.receiver_id = (SELECT auth.uid()::text))
          OR (m.receiver_id = public.users.id AND m.sender_id = (SELECT auth.uid()::text))
        )
    )
  );

CREATE POLICY "users_insert_self_or_admin"
  ON public.users
  FOR INSERT
  WITH CHECK (
    public.is_conversation_admin()
    OR id = (SELECT auth.uid()::text)
  );

CREATE POLICY "users_update_tenant_or_admin"
  ON public.users
  FOR UPDATE
  USING (
    public.is_conversation_admin()
    OR id = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE (
          (m.sender_id = public.users.id AND m.receiver_id = (SELECT auth.uid()::text))
          OR (m.receiver_id = public.users.id AND m.sender_id = (SELECT auth.uid()::text))
        )
    )
  )
  WITH CHECK (
    public.is_conversation_admin()
    OR id = (SELECT auth.uid()::text)
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE (
          (m.sender_id = public.users.id AND m.receiver_id = (SELECT auth.uid()::text))
          OR (m.receiver_id = public.users.id AND m.sender_id = (SELECT auth.uid()::text))
        )
    )
  );

-- -----------------------------------------------------------------------------
-- MESSAGES
-- -----------------------------------------------------------------------------
CREATE POLICY "messages_select_tenant_or_admin"
  ON public.messages
  FOR SELECT
  USING (
    public.is_conversation_admin()
    OR sender_id = (SELECT auth.uid()::text)
    OR receiver_id = (SELECT auth.uid()::text)
  );

CREATE POLICY "messages_insert_tenant_or_admin"
  ON public.messages
  FOR INSERT
  WITH CHECK (
    public.is_conversation_admin()
    OR sender_id = (SELECT auth.uid()::text)
    OR receiver_id = (SELECT auth.uid()::text)
  );

CREATE POLICY "messages_update_tenant_or_admin"
  ON public.messages
  FOR UPDATE
  USING (
    public.is_conversation_admin()
    OR sender_id = (SELECT auth.uid()::text)
    OR receiver_id = (SELECT auth.uid()::text)
  )
  WITH CHECK (
    public.is_conversation_admin()
    OR sender_id = (SELECT auth.uid()::text)
    OR receiver_id = (SELECT auth.uid()::text)
  );

-- -----------------------------------------------------------------------------
-- Optional: admins can read extra rows (future admin UI)
-- reply_agents table exists only if sql/reply_agents.sql was applied
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.reply_agents') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Admins can view all reply agents" ON public.reply_agents';
    EXECUTE 'CREATE POLICY "Admins can view all reply agents" ON public.reply_agents FOR SELECT USING (public.is_conversation_admin())';
  END IF;
END;
$$;

CREATE POLICY "chat_groups_select_admin"
  ON public.chat_groups
  FOR SELECT
  USING (public.is_conversation_admin());

CREATE POLICY "group_members_select_admin"
  ON public.group_members
  FOR SELECT
  USING (public.is_conversation_admin());

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(current_user_id TEXT, other_user_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  affected_rows INTEGER;
BEGIN
  IF NOT public.is_conversation_admin() AND current_user_id IS DISTINCT FROM (SELECT auth.uid()::text) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.messages
  SET is_read = TRUE, read_at = NOW()
  WHERE receiver_id = current_user_id
    AND sender_id = other_user_id
    AND is_read = FALSE;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.mark_messages_as_read(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.update_user_custom_name(user_id TEXT, new_custom_name TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT public.is_conversation_admin() THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE (
          (m.sender_id = user_id AND m.receiver_id = (SELECT auth.uid()::text))
          OR (m.receiver_id = user_id AND m.sender_id = (SELECT auth.uid()::text))
        )
    ) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  UPDATE public.users
  SET custom_name = new_custom_name
  WHERE id = user_id;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.update_user_custom_name(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_user_custom_name(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_custom_name(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_unread_conversations(limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
  conversation_id TEXT,
  display_name TEXT,
  unread_count BIGINT,
  last_message_time TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.sender_id AS conversation_id,
    COALESCE(u.custom_name, u.whatsapp_name, u.name, u.id) AS display_name,
    COUNT(*)::BIGINT AS unread_count,
    MAX(m.timestamp) AS last_message_time
  FROM public.messages m
  LEFT JOIN public.users u ON u.id = m.sender_id
  WHERE m.is_read = FALSE
    AND (
      public.is_conversation_admin()
      OR m.receiver_id = (SELECT auth.uid()::text)
    )
  GROUP BY m.sender_id, u.custom_name, u.whatsapp_name, u.name, u.id
  ORDER BY last_message_time DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_unread_conversations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_conversations(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_conversations(INTEGER) TO service_role;

-- Keep in sync with sql/fix_get_conversation_messages.sql (tenant-safe by definition)
CREATE OR REPLACE FUNCTION public.get_conversation_messages(other_user_id TEXT)
RETURNS TABLE (
  id TEXT,
  sender_id TEXT,
  receiver_id TEXT,
  content TEXT,
  message_timestamp TIMESTAMP WITH TIME ZONE,
  is_sent_by_me BOOLEAN,
  message_type TEXT,
  media_data JSONB,
  is_read BOOLEAN,
  read_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.sender_id,
    m.receiver_id,
    m.content,
    m.timestamp AS message_timestamp,
    COALESCE(m.is_sent_by_me, m.sender_id = (SELECT auth.uid()::text)) AS is_sent_by_me,
    m.message_type,
    m.media_data,
    m.is_read,
    m.read_at
  FROM public.messages m
  WHERE (
    (m.sender_id = other_user_id AND m.receiver_id = (SELECT auth.uid()::text))
    OR (m.receiver_id = other_user_id AND m.sender_id = (SELECT auth.uid()::text))
  )
  ORDER BY m.timestamp ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.get_conversation_messages(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_conversation_messages(TEXT) TO service_role;
