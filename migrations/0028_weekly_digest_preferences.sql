-- Migration: Add weekly insights digest delivery preferences to company_settings
-- Lets owners pick the weekly digest day-of-week (0=Sun..6=Sat) and hour (0-23)
-- in their store's local timezone, and opt out entirely.

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "weekly_digest_enabled" boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS "weekly_digest_day_of_week" integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "weekly_digest_hour" integer DEFAULT 17;
