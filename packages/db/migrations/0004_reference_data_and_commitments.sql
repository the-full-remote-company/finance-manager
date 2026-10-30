CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "accounts_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "accounts_workspace_id_name_key" UNIQUE("workspace_id","name"),
	CONSTRAINT "accounts_name_length" CHECK (length(btrim("accounts"."name")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"direction" "direction" NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "categories_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "categories_workspace_id_name_key" UNIQUE("workspace_id","name"),
	CONSTRAINT "categories_name_length" CHECK (length(btrim("categories"."name")) between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "amount_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"month" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "amount_overrides_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "amount_overrides_commitment_id_month_key" UNIQUE("commitment_id","month"),
	CONSTRAINT "amount_overrides_amount_non_negative" CHECK ("amount_overrides"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commitment_amounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_month" integer GENERATED ALWAYS AS ((EXTRACT(YEAR FROM effective_from)::int * 12 + EXTRACT(MONTH FROM effective_from)::int - 1)) STORED,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commitment_amounts_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "commitment_amounts_commitment_id_effective_month_key" UNIQUE("commitment_id","effective_month"),
	CONSTRAINT "commitment_amounts_amount_non_negative" CHECK ("commitment_amounts"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"direction" "direction" NOT NULL,
	"kind" "commitment_kind" DEFAULT 'expense' NOT NULL,
	"category_id" uuid NOT NULL,
	"source_account_id" uuid NOT NULL,
	"transfer_account_id" uuid,
	"share_percent" smallint DEFAULT 100 NOT NULL,
	"rhythm" "rhythm" NOT NULL,
	"anchor_month" integer,
	"start_date" date NOT NULL,
	"start_month" integer GENERATED ALWAYS AS ((EXTRACT(YEAR FROM start_date)::int * 12 + EXTRACT(MONTH FROM start_date)::int - 1)) STORED,
	"end_date" date,
	"end_month" integer GENERATED ALWAYS AS ((EXTRACT(YEAR FROM end_date)::int * 12 + EXTRACT(MONTH FROM end_date)::int - 1)) STORED,
	"notice_deadline" date,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "commitments_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "commitments_anchor_required" CHECK ("commitments"."rhythm" = 'monthly' OR "commitments"."anchor_month" IS NOT NULL),
	CONSTRAINT "commitments_transfer_not_source" CHECK ("commitments"."transfer_account_id" IS NULL OR "commitments"."transfer_account_id" <> "commitments"."source_account_id"),
	CONSTRAINT "commitments_end_after_start" CHECK ("commitments"."end_date" IS NULL OR "commitments"."end_date" >= "commitments"."start_date"),
	CONSTRAINT "commitments_share_percent_range" CHECK ("commitments"."share_percent" between 0 and 100),
	CONSTRAINT "commitments_name_length" CHECK (length(btrim("commitments"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amount_overrides" ADD CONSTRAINT "amount_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amount_overrides" ADD CONSTRAINT "amount_overrides_commitment_fk" FOREIGN KEY ("workspace_id","commitment_id") REFERENCES "public"."commitments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_amounts" ADD CONSTRAINT "commitment_amounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_amounts" ADD CONSTRAINT "commitment_amounts_commitment_fk" FOREIGN KEY ("workspace_id","commitment_id") REFERENCES "public"."commitments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."categories"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_source_account_fk" FOREIGN KEY ("workspace_id","source_account_id") REFERENCES "public"."accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_transfer_account_fk" FOREIGN KEY ("workspace_id","transfer_account_id") REFERENCES "public"."accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_workspace_idx" ON "accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "categories_workspace_idx" ON "categories" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "amount_overrides_workspace_commitment_idx" ON "amount_overrides" USING btree ("workspace_id","commitment_id");--> statement-breakpoint
CREATE INDEX "commitment_amounts_workspace_commitment_idx" ON "commitment_amounts" USING btree ("workspace_id","commitment_id");--> statement-breakpoint
CREATE INDEX "commitments_workspace_category_idx" ON "commitments" USING btree ("workspace_id","category_id");--> statement-breakpoint
CREATE INDEX "commitments_workspace_source_account_idx" ON "commitments" USING btree ("workspace_id","source_account_id");--> statement-breakpoint
CREATE INDEX "commitments_workspace_transfer_account_idx" ON "commitments" USING btree ("workspace_id","transfer_account_id");--> statement-breakpoint
CREATE INDEX "commitments_workspace_horizon_idx" ON "commitments" USING btree ("workspace_id","start_month","end_month");--> statement-breakpoint

-- ============================================================================
-- Row level security (Article I)
-- ============================================================================
-- Hand-added after `drizzle-kit generate`, per the convention `0000_initial_schema.sql`
-- established: the generator writes the structure, and the tenancy rules are
-- authored and reviewed as plain SQL rather than hidden behind it.

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "accounts_tenant" ON "accounts"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "categories_tenant" ON "categories"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "commitments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commitments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "commitments_tenant" ON "commitments"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "commitment_amounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commitment_amounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "commitment_amounts_tenant" ON "commitment_amounts"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "amount_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "amount_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "amount_overrides_tenant" ON "amount_overrides"
  USING      ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);--> statement-breakpoint

-- ============================================================================
-- Grants for the non-owner application role
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON "accounts" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "categories" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "commitments" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "commitment_amounts" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "amount_overrides" TO app;