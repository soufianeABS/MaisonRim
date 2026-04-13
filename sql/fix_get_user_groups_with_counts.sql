-- Run in Supabase SQL Editor if GET /api/groups fails with:
--   function auth.users() does not exist (42883)
--   or: Returned type numeric does not match expected type bigint (42804)
-- Older README versions wrongly referenced auth.users() as a function; use auth.uid() instead.
-- SUM(...) is numeric in Postgres; cast to bigint to match RETURNS TABLE.

CREATE OR REPLACE FUNCTION public.get_user_groups_with_counts()
RETURNS TABLE (
  group_id UUID,
  group_name TEXT,
  group_description TEXT,
  member_count BIGINT,
  unread_count BIGINT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    cg.id AS group_id,
    cg.name AS group_name,
    cg.description AS group_description,
    COUNT(DISTINCT gm.id)::bigint AS member_count,
    COALESCE(SUM(
      (SELECT COUNT(*)::bigint
       FROM public.messages m
       WHERE m.sender_id = gm.user_id
         AND m.receiver_id = (SELECT auth.uid()::text)
         AND m.is_read = false
      )
    ), 0)::bigint AS unread_count,
    cg.created_at,
    cg.updated_at
  FROM public.chat_groups cg
  LEFT JOIN public.group_members gm ON gm.group_id = cg.id
  WHERE cg.owner_id = auth.uid()
  GROUP BY cg.id, cg.name, cg.description, cg.created_at, cg.updated_at
  ORDER BY cg.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_user_groups_with_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_groups_with_counts() TO service_role;
