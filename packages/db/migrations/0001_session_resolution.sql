-- Session resolution bootstrap, per ADR 0007.
--
-- A request carries only an opaque token. To know its workspace the server must
-- read `sessions`; to read `sessions` under RLS, `app.workspace_id` must already
-- be set; to set it, the workspace must already be known. This function is the
-- one narrow way out of that circle.
--
-- Narrow on purpose:
--   - takes a hash, never a token and never a caller-controlled predicate
--   - returns five non-secret fields: no token_hash, no password_hash, nothing
--     from users
--   - returns at most one row, since token_hash is unique
--   - search_path is pinned, so the function cannot be hijacked through a
--     caller-controlled schema — the standard SECURITY DEFINER failure mode
--   - EXECUTE revoked from PUBLIC, granted only to app
--
-- A test asserts this remains the ONLY SECURITY DEFINER function in the schema.

CREATE FUNCTION "app_resolve_session"(p_token_hash text)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  workspace_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT s.id, s.user_id, s.workspace_id, s.expires_at, s.revoked_at
  FROM public.sessions s
  WHERE s.token_hash = p_token_hash
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "app_resolve_session"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_resolve_session"(text) TO app;
