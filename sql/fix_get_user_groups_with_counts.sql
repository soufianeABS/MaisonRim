-- Optional: run if your DB was created from an older README that used
-- `auth.users()` inside get_user_groups_with_counts (invalid in Postgres).

CREATE OR REPLACE FUNCTION get_user_groups_with_counts()
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
    COUNT(DISTINCT gm.id) AS member_count,
    COALESCE(SUM(
      (SELECT COUNT(*) 
       FROM messages m 
       WHERE m.sender_id = gm.user_id 
       AND m.receiver_id = auth.uid()::text
       AND m.is_read = false
      )
    ), 0) AS unread_count,
    cg.created_at,
    cg.updated_at
  FROM chat_groups cg
  LEFT JOIN group_members gm ON gm.group_id = cg.id
  WHERE cg.owner_id = auth.uid()
  GROUP BY cg.id, cg.name, cg.description, cg.created_at, cg.updated_at
  ORDER BY cg.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
