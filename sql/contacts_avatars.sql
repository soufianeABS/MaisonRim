-- Add avatar_url to contacts + expose in contact_conversations view
-- Run in Supabase SQL Editor (safe to re-run).

ALTER TABLE IF EXISTS public.contacts
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Update view to include avatar_url
CREATE OR REPLACE VIEW public.contact_conversations AS
WITH my_messages AS (
  SELECT *
  FROM public.messages
  WHERE receiver_id = (SELECT auth.uid()::text)
),
unread_counts AS (
  SELECT
    sender_id,
    COUNT(*) AS unread_count
  FROM my_messages
  WHERE is_read = false
  GROUP BY sender_id
),
latest_messages AS (
  SELECT DISTINCT ON (sender_id)
    sender_id,
    content,
    message_type,
    timestamp AS last_message_time,
    sender_id AS last_message_sender
  FROM my_messages
  ORDER BY sender_id, timestamp DESC
)
SELECT
  c.phone AS id,
  COALESCE(c.custom_name, c.whatsapp_name, c.phone) AS display_name,
  c.custom_name,
  c.whatsapp_name,
  c.phone AS original_name,
  c.last_active,
  c.avatar_url,
  COALESCE(uc.unread_count, 0) AS unread_count,
  lm.content AS last_message,
  lm.message_type AS last_message_type,
  lm.last_message_time,
  lm.last_message_sender,
  CASE WHEN COALESCE(uc.unread_count, 0) > 0 THEN 1 ELSE 0 END AS has_unread,
  a.status_id,
  s.name AS status_name,
  s.color AS status_color,
  s.rule AS status_rule
FROM public.contacts c
LEFT JOIN unread_counts uc ON c.phone = uc.sender_id
LEFT JOIN latest_messages lm ON c.phone = lm.sender_id
LEFT JOIN public.contact_status_assignments a
  ON a.contact_id = c.phone
  AND a.owner_id = (SELECT auth.uid()::text)
LEFT JOIN public.contact_statuses s
  ON s.id = a.status_id
  AND s.owner_id = (SELECT auth.uid()::text)
WHERE c.owner_id = (SELECT auth.uid()::text)
ORDER BY has_unread DESC, last_message_time DESC NULLS LAST;

