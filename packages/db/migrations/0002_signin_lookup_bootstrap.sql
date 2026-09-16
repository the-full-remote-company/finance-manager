-- Sign-in lookup bootstrap. Extends ADR 0007's reasoning to credential
-- verification; recorded in full as ADR 0008.
--
-- The same circularity ADR 0007 solved for a session token applies to sign-in:
-- a request carries only an email, not a workspace; to know the workspace the
-- server must read the matching `users` row; to read it under RLS,
-- `app.workspace_id` must already be set; to set it, the workspace must
-- already be known.
--
-- Narrow on the same terms as `app_resolve_session`:
--   - takes an already-lowercased email, never a caller-controlled predicate
--   - returns exactly the three fields sign-in needs — user_id, workspace_id,
--     password_hash — and nothing else from `users`: no email, no display
--     name
--   - returns at most one row, since `users_email_lower_key` is a unique
--     index on `lower(email)`
--   - search_path is pinned, so the function cannot be hijacked through a
--     caller-controlled schema
--   - EXECUTE revoked from PUBLIC, granted only to app
--
-- A test asserts these two functions remain the ONLY SECURITY DEFINER
-- functions in the schema.

CREATE FUNCTION "app_authenticate"(p_email text)
RETURNS TABLE (
  user_id uuid,
  workspace_id uuid,
  password_hash text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, u.workspace_id, u.password_hash
  FROM public.users u
  WHERE lower(u.email) = p_email
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "app_authenticate"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_authenticate"(text) TO app;
