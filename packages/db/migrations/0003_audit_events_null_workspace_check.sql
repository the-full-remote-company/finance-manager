-- audit_events must accept a NULL-workspace write from the app role: a
-- failed sign-in and a retained account_deleted row have no workspace to
-- attribute (data-model.md), and both are written while `app.workspace_id`
-- is unset.
--
-- The original policy's WITH CHECK compared `workspace_id` to
-- `current_setting` with a plain `=`. When both sides are NULL, `NULL = NULL`
-- is NULL, not TRUE, so the check silently rejected every such write once
-- exercised by the non-owner `app` role — invisible until now because every
-- test so far wrote through the owner connection, which bypasses RLS as a
-- superuser regardless of FORCE. Found while wiring `auth.signIn`'s failure
-- path (T064), which is the first code path to write a NULL-workspace audit
-- row as `app`.
--
-- `USING` is unchanged: a NULL `workspace_id` stays invisible to every
-- workspace-scoped read, which is the documented intent — these rows carry
-- only a type, a timestamp and a hashed IP, attributable to no tenant.

ALTER POLICY "audit_events_tenant" ON "audit_events"
  WITH CHECK (
    "workspace_id" IS NULL
    OR "workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid
  );
