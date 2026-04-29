-- Task #397 — Let managers configure the labor cost target band per store
-- Adds configurable upper/lower thresholds (in percent) for the daily labor cost
-- guardrail used by checkDailyLaborCostThresholds. Defaults match the previous
-- hardcoded values (30% over / 10% under).
ALTER TABLE ai_scheduling_settings
  ADD COLUMN IF NOT EXISTS labor_cost_over_pct numeric(5,2) DEFAULT 30;

ALTER TABLE ai_scheduling_settings
  ADD COLUMN IF NOT EXISTS labor_cost_under_pct numeric(5,2) DEFAULT 10;
