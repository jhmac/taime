-- Migration: Add eligible_roles to tasks for role-gated auto-assignment
-- eligible_roles is a text array storing which roles can be auto-assigned this task.
-- Default of ARRAY['all'] means any role is eligible (backwards-compatible).
-- assigned_to is cleared for non-terminal tasks so auto-assign can distribute them fresh.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "eligible_roles" text[] DEFAULT ARRAY['all']::text[];

UPDATE "tasks"
  SET "assigned_to" = NULL
  WHERE "status" IN ('pending', 'in_progress')
    AND "assigned_to" IS NOT NULL;
