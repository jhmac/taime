ALTER TABLE "ai_scheduling_settings"
  ADD COLUMN IF NOT EXISTS "min_staffing_pre_hours" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "min_staffing_during_hours" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "min_staffing_post_hours" INTEGER NOT NULL DEFAULT 1;

-- Backfill zone minimums from existing minimum_staffing so existing stores
-- are not silently downgraded to the column defaults.
-- min_staffing_during_hours (peak zone) takes the existing minimum as its floor.
-- pre/post default to 1 only when minimum_staffing is also 1, otherwise keep 1
-- as a sensible opening/closing floor (managers can raise it in settings).
UPDATE "ai_scheduling_settings"
  SET "min_staffing_during_hours" = GREATEST("minimum_staffing", 2)
  WHERE "minimum_staffing" IS NOT NULL AND "minimum_staffing" > 2;

CREATE TABLE IF NOT EXISTS "special_circumstances" (
  "id" VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" VARCHAR REFERENCES "work_locations"("id") ON DELETE CASCADE,
  "name" VARCHAR NOT NULL,
  "description" TEXT,
  "category" VARCHAR,
  "is_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_special_circumstances_store" ON "special_circumstances"("store_id");
