-- Migration: Add mileage reimbursements table and related columns for Task #44
-- Off-Site Trips Mileage Reimbursement & Timesheet Integration

CREATE TABLE IF NOT EXISTS "mileage_reimbursements" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" varchar NOT NULL REFERENCES "offsite_sessions"("id"),
  "time_entry_id" varchar REFERENCES "time_entries"("id"),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "miles_decimal" numeric(10, 4) NOT NULL,
  "rate_cents" integer NOT NULL,
  "total_cents" integer NOT NULL,
  "equivalent_minutes" integer NOT NULL DEFAULT 0,
  "applied_at" timestamp NOT NULL DEFAULT now(),
  "adjusted_by" varchar REFERENCES "users"("id"),
  "adjusted_at" timestamp,
  "adjusted_miles_decimal" numeric(10, 4)
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "mileage_reimbursements_session_id_unique" ON "mileage_reimbursements" ("session_id");
--> statement-breakpoint

ALTER TABLE "time_entries"
  ADD COLUMN IF NOT EXISTS "mileage_minutes" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mileage_total_cents" integer DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mileage_rate_cents_override" integer;
