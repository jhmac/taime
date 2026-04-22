DO $$ BEGIN
  CREATE TYPE task_assignee_status AS ENUM ('pending', 'in_progress', 'completed', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "task_assignees" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" varchar NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "assigned_by" varchar NOT NULL REFERENCES "users"("id"),
  "broadcast_group_id" varchar NOT NULL,
  "status" task_assignee_status DEFAULT 'pending',
  "started_at" timestamp,
  "completed_at" timestamp,
  "completion_note" text,
  "completion_image_url" text,
  "previous_image_url" text,
  "manager_approved_at" timestamp,
  "approved_by" varchar REFERENCES "users"("id"),
  "rejected_at" timestamp,
  "rejection_note" text,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_task_assignees_task_id" ON "task_assignees" ("task_id");
CREATE INDEX IF NOT EXISTS "idx_task_assignees_user_id" ON "task_assignees" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_task_assignees_broadcast_group" ON "task_assignees" ("broadcast_group_id");
CREATE INDEX IF NOT EXISTS "idx_task_assignees_status" ON "task_assignees" ("status");
