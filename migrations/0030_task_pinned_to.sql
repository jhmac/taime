-- Migration: Add pinned_to column to tasks for deferred manual pin intent.
-- When a manager pins a task to an employee who is not currently clocked in,
-- pinned_to stores the intended assignee. assigned_to remains null until that
-- employee clocks in, at which point activateDeferredPins() sets assigned_to.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "pinned_to" varchar REFERENCES "users"("id");
