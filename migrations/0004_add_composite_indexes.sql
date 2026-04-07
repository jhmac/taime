-- Add composite index on tasks(assigned_to, created_at) for dashboard hot queries
CREATE INDEX IF NOT EXISTS "idx_tasks_assigned_created" ON "tasks" ("assigned_to","created_at");

-- Add composite index on morning_huddles(store_id, huddle_date) for daily briefing lookups
CREATE INDEX IF NOT EXISTS "idx_morning_huddles_store_date" ON "morning_huddles" ("store_id","huddle_date");

-- Add composite index on daily_quotes(store_id, quote_date) for daily quote lookups
CREATE INDEX IF NOT EXISTS "idx_daily_quotes_store_date" ON "daily_quotes" ("store_id","quote_date");
