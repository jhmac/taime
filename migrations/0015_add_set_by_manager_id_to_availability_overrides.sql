ALTER TABLE "user_availability_overrides" ADD COLUMN IF NOT EXISTS "set_by_manager_id" varchar REFERENCES "users"("id");
