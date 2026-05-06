-- Migration: Add dashboard display settings to company_settings
-- These fields control the AdminOwnerDashboard business health monitor behavior.

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "dashboard_top_bottom_n"       INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "late_clock_in_alert_threshold" INTEGER DEFAULT 2;
