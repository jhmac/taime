-- Task #435 — Let each store keep its own labor cost band (multi-tenant)
-- Scopes ai_scheduling_settings per store. Before this migration the table
-- was a singleton: every tenant on the same DB shared the SAME row, which
-- the route returned with `limit(1)` and no store filter. After this
-- migration each work_location gets its own row.

ALTER TABLE ai_scheduling_settings
  ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE;

-- For each existing row whose store_id is NULL, copy its values into a new
-- row for every active work_location that doesn't already have one. Preserves
-- previous "shared" config across all stores so nobody loses their staffing
-- tiers / store hours / labor cost band.
INSERT INTO ai_scheduling_settings (
  shift_blocks, staffing_tiers, minimum_staffing, updated_by, updated_at,
  store_hours, shift_overlap_minutes, overlap_budget_limit, custom_ai_instructions,
  labor_cost_over_pct, labor_cost_under_pct, store_id
)
SELECT
  s.shift_blocks, s.staffing_tiers, s.minimum_staffing, s.updated_by, NOW(),
  s.store_hours, s.shift_overlap_minutes, s.overlap_budget_limit, s.custom_ai_instructions,
  s.labor_cost_over_pct, s.labor_cost_under_pct, w.id
FROM ai_scheduling_settings s
CROSS JOIN work_locations w
WHERE s.store_id IS NULL
  AND w.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM ai_scheduling_settings s2 WHERE s2.store_id = w.id
  );

-- Drop the leftover NULL-store_id rows.
DELETE FROM ai_scheduling_settings WHERE store_id IS NULL;

-- Enforce one row per store.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_scheduling_settings_store_id
  ON ai_scheduling_settings (store_id);
