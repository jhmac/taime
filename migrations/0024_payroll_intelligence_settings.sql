-- Migration 0024: Add payroll intelligence settings to ai_scheduling_settings
-- Adds payroll_target_pct (default 30%) and store_type (default 'fashion_boutique')
-- These persist the Benchmark tab selections across sessions.

ALTER TABLE ai_scheduling_settings
  ADD COLUMN IF NOT EXISTS payroll_target_pct decimal(5,2) DEFAULT 30,
  ADD COLUMN IF NOT EXISTS store_type varchar DEFAULT 'fashion_boutique';
