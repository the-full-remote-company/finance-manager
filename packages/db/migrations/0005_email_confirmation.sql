-- Feature 002: Email Verification for Registration
-- Adds confirmation columns to users and creates confirmation_tokens table

-- Add confirmation columns to users (FR-019). Default true so that every
-- pre-existing account is grandfathered as confirmed; register sets false
-- explicitly for new accounts.
ALTER TABLE "users"
  ADD COLUMN "confirmed" boolean NOT NULL DEFAULT true,
  ADD COLUMN "confirmed_at" timestamptz;--> statement-breakpoint

UPDATE "users"
  SET "confirmed_at" = now()
  WHERE "confirmed_at" IS NULL;--> statement-breakpoint

-- Create confirmation_tokens table (data-model.md)
CREATE TABLE "confirmation_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces" ("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "superseded_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),

  UNIQUE ("token_hash"),
  UNIQUE ("workspace_id", "id"),
  FOREIGN KEY ("workspace_id", "user_id") REFERENCES "users" ("workspace_id", "id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX "confirmation_tokens_workspace_idx" ON "confirmation_tokens" ("workspace_id");--> statement-breakpoint
CREATE INDEX "confirmation_tokens_user_idx" ON "confirmation_tokens" ("user_id");--> statement-breakpoint
CREATE INDEX "confirmation_tokens_expires_idx" ON "confirmation_tokens" ("expires_at");--> statement-breakpoint

-- Row Level Security (Article I). Same predicate as every other tenant table:
-- an unset workspace yields zero rows rather than an error.
ALTER TABLE "confirmation_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "confirmation_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "confirmation_tokens_tenant" ON "confirmation_tokens"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

-- Grant to app role (non-owner application role)
GRANT SELECT, INSERT, UPDATE, DELETE ON "confirmation_tokens" TO app;
