-- Migration: Add trip receipt summary and admin review fields to offsite_sessions

ALTER TABLE "offsite_sessions"
  ADD COLUMN IF NOT EXISTS "total_distance_miles" numeric(8, 2),
  ADD COLUMN IF NOT EXISTS "deviation_event_count" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "max_deviation_miles" numeric(8, 2),
  ADD COLUMN IF NOT EXISTS "destination_reached" boolean,
  ADD COLUMN IF NOT EXISTS "reimbursement_cents" integer,
  ADD COLUMN IF NOT EXISTS "breadcrumbs" jsonb,
  ADD COLUMN IF NOT EXISTS "reviewed_by" varchar REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "admin_note" text;
