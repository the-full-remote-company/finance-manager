-- Runs once, on first container start, as the `owner` superuser.
--
-- Article I: "The application MUST connect as a role that is neither superuser
-- nor table owner, because RLS does not apply to either." This script creates
-- that role. Everything the application can do it can do only through the
-- policies added by the migrations.

CREATE ROLE app WITH LOGIN PASSWORD 'app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT CONNECT ON DATABASE finance TO app;
GRANT USAGE ON SCHEMA public TO app;

-- No blanket table grants here. Each migration grants exactly the privileges
-- its tables need, so a new table is unreachable by the application until its
-- migration says otherwise — and, per Article I, until its policy exists.
--
-- Deliberately NOT granted: CREATE on schema public, so the application role
-- cannot create a table and thereby own one.
REVOKE CREATE ON SCHEMA public FROM app;
