-- Add company_id to work_locations for proper multi-tenant data isolation.
-- Backfills all existing rows to the first company so geofencing keeps working.

ALTER TABLE "work_locations"
  ADD COLUMN IF NOT EXISTS "company_id" varchar REFERENCES "companies"("id");

-- Backfill: assign all un-scoped locations to the first (oldest) company.
-- Safe for single-tenant deployments; in multi-tenant envs an admin can
-- re-assign locations to the correct company via the settings UI.
UPDATE "work_locations"
  SET "company_id" = (SELECT id FROM companies ORDER BY created_at ASC LIMIT 1)
WHERE "company_id" IS NULL;
