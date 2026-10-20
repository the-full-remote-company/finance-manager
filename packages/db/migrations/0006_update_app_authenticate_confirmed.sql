-- Feature 002: Update app_authenticate to return confirmed field

DROP FUNCTION IF EXISTS "app_authenticate"(text);--> statement-breakpoint

CREATE FUNCTION "app_authenticate"(p_email text)
RETURNS TABLE (
  user_id uuid,
  workspace_id uuid,
  password_hash text,
  confirmed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT u.id, u.workspace_id, u.password_hash, u.confirmed
  FROM public.users u
  WHERE lower(u.email) = lower(p_email)
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "app_authenticate"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app_authenticate"(text) TO app;
