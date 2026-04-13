-- If you already ran tenant_isolation.sql before DELETE on messages was added, run this once.

DROP POLICY IF EXISTS "messages_delete_tenant_or_admin" ON public.messages;

CREATE POLICY "messages_delete_tenant_or_admin"
  ON public.messages
  FOR DELETE
  USING (
    public.is_conversation_admin()
    OR sender_id = (SELECT auth.uid()::text)
    OR receiver_id = (SELECT auth.uid()::text)
  );
