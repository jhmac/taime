-- Migration: Add destination and mileage rate fields to offsite_allowance_rules
-- Add global default mileage rate to company_settings

ALTER TABLE "offsite_allowance_rules"
  ADD COLUMN IF NOT EXISTS "destination_address" text,
  ADD COLUMN IF NOT EXISTS "destination_place_id" varchar(500),
  ADD COLUMN IF NOT EXISTS "destination_lat" numeric(10, 8),
  ADD COLUMN IF NOT EXISTS "destination_lng" numeric(11, 8),
  ADD COLUMN IF NOT EXISTS "destination_name" varchar(500),
  ADD COLUMN IF NOT EXISTS "mileage_rate_cents" integer DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "default_mileage_rate_cents" integer DEFAULT 0;
