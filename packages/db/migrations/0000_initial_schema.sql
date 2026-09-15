-- Hand-edited after `drizzle-kit generate`, per ADR 0001: the generator writes
-- the structure, and the tenancy rules are authored and reviewed as plain SQL
-- rather than hidden behind it.
--
-- Everything below the "Row level security" banner is hand-written and is the
-- substance of Article I. A table added here without its policy and its leak
-- test is an incomplete change and MUST NOT merge.

CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."audit_event_type" AS ENUM('sign_in_succeeded', 'sign_in_failed', 'signed_out', 'export_performed', 'account_deleted');--> statement-breakpoint
CREATE TYPE "public"."commitment_kind" AS ENUM('expense', 'reserve');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."rhythm" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly', 'one_off');--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "sessions_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "users_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"type" "audit_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" "bytea",
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier_hash" "bytea" NOT NULL,
	"ip_hash" "bytea" NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "auth_attempts_window_key" UNIQUE("identifier_hash","ip_hash","window_start")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_currency" char(3) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"rate_numerator" bigint NOT NULL,
	"rate_denominator" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_pair_effective_key" UNIQUE("base_currency","quote_currency","effective_from")
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_workspace_idx" ON "sessions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_workspace_idx" ON "users" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_events_workspace_idx" ON "audit_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
-- Case-insensitive email uniqueness. A second registration differing only in
-- case is the same person, and sign-in must not depend on how they typed it.
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));--> statement-breakpoint

-- ============================================================================
-- Row level security (Article I)
-- ============================================================================
--
-- Every tenant-scoped table gets ENABLE + FORCE, and a policy carrying BOTH
-- USING and WITH CHECK. USING alone filters reads but still permits INSERTing
-- a row into another workspace, so WITH CHECK is mandatory, not decorative.
--
-- FORCE is what makes the policy apply to the table owner as well. Without it
-- a migration-time mistake, or any future code that connects as the owner,
-- bypasses tenancy silently.
--
-- current_setting(..., true) returns NULL rather than raising when the setting
-- is absent. NULL compares to nothing, so an unscoped connection sees zero
-- rows — the safe direction. An unset session must not mean "see everything".

ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "workspaces_tenant" ON "workspaces"
  USING      ("id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "users_tenant" ON "users"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "sessions_tenant" ON "sessions"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A retained account_deleted row has workspace_id NULL and belongs to no
-- tenant. It is readable by no workspace session, which is the intent: it
-- carries only an event type, a timestamp and a hashed IP.
CREATE POLICY "audit_events_tenant" ON "audit_events"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

-- ============================================================================
-- Grants for the non-owner application role
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON "workspaces" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO app;--> statement-breakpoint

-- Append-only, enforced by grant rather than by convention (Article VIII).
GRANT SELECT, INSERT ON "audit_events" TO app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "audit_events" FROM app;--> statement-breakpoint

-- Throttling state: consulted before any workspace is known, so no policy.
-- DELETE is granted because rows older than the window are pruned.
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_attempts" TO app;--> statement-breakpoint

-- A rate is a fact about the world, not about a household. Read-only to the
-- application; rates are loaded by an operator task, not by a user action.
GRANT SELECT ON "fx_rates" TO app;