ALTER TABLE "thread_messages"
  ADD COLUMN IF NOT EXISTS "reactions" jsonb,
  ADD COLUMN IF NOT EXISTS "to_employee_id" text,
  ADD COLUMN IF NOT EXISTS "kudo_category" text;

ALTER TABLE "kudos"
  ADD COLUMN IF NOT EXISTS "reactions" jsonb;
