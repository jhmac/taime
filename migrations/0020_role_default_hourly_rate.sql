-- Add per-role default hourly rate used as a fallback by the live margin meter
-- in CreateShiftSplitPanel when an employee row has no explicit hourly rate.
-- Nullable: NULL means "no role-level default; fall back to settings default".
ALTER TABLE roles ADD COLUMN IF NOT EXISTS default_hourly_rate DECIMAL(10,2);
