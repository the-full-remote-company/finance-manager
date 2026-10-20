-- Feature 002: audit event types for the confirmation flow (FR-015).
-- Without these, recordAuditEvent() raises "invalid input value for enum"
-- the first time a link is confirmed, resent or refused.

ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'account_confirmed';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'confirmation_resent';--> statement-breakpoint
ALTER TYPE "public"."audit_event_type" ADD VALUE IF NOT EXISTS 'confirmation_failed';
