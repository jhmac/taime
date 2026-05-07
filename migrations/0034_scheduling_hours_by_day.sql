-- Migration: Add per-day scheduling hours to company_settings
-- Allows admins to set different open/closed status and hours for each day of the week.

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "scheduling_hours_by_day" JSONB;
