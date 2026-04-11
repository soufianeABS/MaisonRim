-- Run this in Supabase SQL Editor (or psql) if your DB still has the broken function
-- that referenced auth.users() as a function (error 42883).

CREATE OR REPLACE FUNCTION get_conversation_messages(other_user_id TEXT)
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
    m.timestamp as message_timestamp,
    COALESCE(m.is_sent_by_me, m.sender_id = auth.uid()::text) as is_sent_by_me,
    m.message_type,
    m.media_data,
    m.is_read,
    m.read_at
  FROM messages m
  WHERE (
    (m.sender_id = other_user_id AND m.receiver_id = auth.uid()::text)
    OR (m.receiver_id = other_user_id AND m.sender_id = auth.uid()::text)
  )
  ORDER BY m.timestamp ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
