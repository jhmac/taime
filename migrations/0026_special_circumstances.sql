ALTER TABLE "ai_scheduling_settings"
  ADD COLUMN IF NOT EXISTS "min_staffing_pre_hours" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "min_staffing_during_hours" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "min_staffing_post_hours" INTEGER NOT NULL DEFAULT 1;

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
