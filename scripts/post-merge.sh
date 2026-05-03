#!/bin/bash
set -e
npm install

# Apply pending schema changes non-interactively using raw SQL.
# We do NOT use `drizzle-kit push` here because it requires TTY interaction
# even with --force (prompts for rename-vs-create decisions). Instead, we apply
# schema changes directly using the same idempotent SQL approach as the app's
# own startup migration logic in server/services/migrations.ts.
node --input-type=module << 'JSEOF'
import pkg from 'pg';
const { Client } = pkg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const run = async (label, sql) => {
  try {
    await client.query(sql);
    console.log('[post-merge] OK:', label);
  } catch (e) {
    // Most errors here are "already exists" — log and continue.
    console.log('[post-merge] SKIP:', label, '-', e.message.split('\n')[0]);
  }
};

// ── Enum types ──────────────────────────────────────────────────────────────
await run('enum knowledge_document_type', `
  CREATE TYPE knowledge_document_type AS ENUM (
    'policy_manual','sales_script','sales_training',
    'style_guide','operations_reference','other'
  )
`);
await run('enum knowledge_processing_status', `
  CREATE TYPE knowledge_processing_status AS ENUM (
    'pending','processing','ready','failed'
  )
`);
await run('enum meeting_status', `
  CREATE TYPE meeting_status AS ENUM (
    'recording','processing','ready','failed'
  )
`);
await run('enum meeting_task_recommendation_status', `
  CREATE TYPE meeting_task_recommendation_status AS ENUM (
    'pending','accepted','rejected'
  )
`);

// ── New tables ───────────────────────────────────────────────────────────────
await run('table store_entitlements', `
  CREATE TABLE IF NOT EXISTS store_entitlements (
    id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE,
    feature_key varchar(100) NOT NULL,
    created_at timestamp DEFAULT now()
  )
`);
await run('index uq_store_entitlements_store_key', `
  CREATE UNIQUE INDEX IF NOT EXISTS uq_store_entitlements_store_key
  ON store_entitlements (store_id, feature_key)
`);
await run('index idx_store_entitlements_store_id', `
  CREATE INDEX IF NOT EXISTS idx_store_entitlements_store_id
  ON store_entitlements (store_id)
`);

// ── Column additions ─────────────────────────────────────────────────────────
// training_modules
await run('training_modules.content', `ALTER TABLE training_modules ADD COLUMN IF NOT EXISTS content text`);
await run('training_modules.category', `ALTER TABLE training_modules ADD COLUMN IF NOT EXISTS category varchar`);

// employee_training_progress
await run('employee_training_progress.score', `ALTER TABLE employee_training_progress ADD COLUMN IF NOT EXISTS score integer`);
await run('employee_training_progress.updated_at', `ALTER TABLE employee_training_progress ADD COLUMN IF NOT EXISTS updated_at timestamp`);

// commute_alerts
await run('commute_alerts.type', `ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS type varchar`);
await run('commute_alerts.title', `ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS title varchar`);
await run('commute_alerts.severity', `ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS severity varchar DEFAULT 'info'`);
await run('commute_alerts.is_read', `ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false`);
await run('commute_alerts.metadata', `ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS metadata jsonb`);

// manager_notes
await run('manager_notes.note', `ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS note text`);
await run('manager_notes.category', `ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS category varchar`);
await run('manager_notes.is_private', `ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false`);
await run('manager_notes.updated_at', `ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS updated_at timestamp`);

// messages
await run('messages.group_id', `ALTER TABLE messages ADD COLUMN IF NOT EXISTS group_id varchar`);

// thread_messages
await run('thread_messages.text', `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS text text`);

// offsite_allowance_rules
await run('offsite_allowance_rules.destination_address', `ALTER TABLE offsite_allowance_rules ADD COLUMN IF NOT EXISTS destination_address text`);
await run('offsite_allowance_rules.destination_place_id', `ALTER TABLE offsite_allowance_rules ADD COLUMN IF NOT EXISTS destination_place_id varchar`);
await run('offsite_allowance_rules.destination_lat', `ALTER TABLE offsite_allowance_rules ADD COLUMN IF NOT EXISTS destination_lat decimal(10,8)`);

// users
await run('users.invite_token', `ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token varchar`);

// score_notices.title was added NOT NULL in an older migration but is not
// populated by gamificationService.ts, causing crashes on every cron tick.
// Make it nullable — it's harmless and stops the constraint violation.
await run('score_notices.title nullable', `ALTER TABLE score_notices ALTER COLUMN title DROP NOT NULL`);

// ── Unique indexes (avoids drizzle "truncate?" prompt) ───────────────────────
await run('idx shops_shop_domain_unique', `CREATE UNIQUE INDEX IF NOT EXISTS shops_shop_domain_unique ON shops (shop_domain)`);
await run('idx permissions_name_unique', `CREATE UNIQUE INDEX IF NOT EXISTS permissions_name_unique ON permissions (name)`);
await run('idx roles_name_unique', `CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique ON roles (name)`);
await run('idx users_invite_token_unique', `CREATE UNIQUE INDEX IF NOT EXISTS users_invite_token_unique ON users (invite_token)`);
await run('idx cash_mgmt_store_id_unique', `CREATE UNIQUE INDEX IF NOT EXISTS cash_management_settings_store_id_unique ON cash_management_settings (store_id)`);
await run('idx uq_thread_participant', `CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_participant ON thread_participants (thread_id, user_id)`);
await run('idx uq_native_push_token', `CREATE UNIQUE INDEX IF NOT EXISTS uq_native_push_token ON native_push_tokens (token)`);

// ── AI usage tracking ────────────────────────────────────────────────────────
await run('ai_usage_events', `CREATE TABLE IF NOT EXISTS ai_usage_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  provider varchar(32) NOT NULL,
  model varchar(96) NOT NULL,
  operation varchar(32) NOT NULL,
  feature varchar(64) NOT NULL,
  store_id varchar,
  user_id varchar,
  is_background boolean NOT NULL DEFAULT false,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  audio_seconds decimal(10,3),
  cost_usd decimal(12,6) NOT NULL,
  latency_ms integer,
  status varchar(16) NOT NULL,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now()
)`);
await run('idx_ai_usage_events_created', `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created ON ai_usage_events (created_at)`);
await run('idx_ai_usage_events_store_created', `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_store_created ON ai_usage_events (store_id, created_at)`);
await run('idx_ai_usage_events_feature_created', `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_feature_created ON ai_usage_events (feature, created_at)`);
await run('idx_ai_usage_events_model_created', `CREATE INDEX IF NOT EXISTS idx_ai_usage_events_model_created ON ai_usage_events (model, created_at)`);

await run('ai_budgets', `CREATE TABLE IF NOT EXISTS ai_budgets (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  scope varchar(16) NOT NULL,
  store_id varchar,
  monthly_limit_usd decimal(12,2) NOT NULL,
  alert_threshold_percent integer NOT NULL DEFAULT 80,
  hard_block boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
)`);
await run('uq_ai_budgets_scope_store', `CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_budgets_scope_store ON ai_budgets (scope, store_id)`);

await run('ai_budget_alerts', `CREATE TABLE IF NOT EXISTS ai_budget_alerts (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id varchar NOT NULL,
  period_key varchar(7) NOT NULL,
  threshold_percent integer NOT NULL,
  spend_at_alert decimal(12,4) NOT NULL,
  sent_at timestamp DEFAULT now()
)`);
await run('uq_ai_budget_alerts_budget_period_threshold', `CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_budget_alerts_budget_period_threshold ON ai_budget_alerts (budget_id, period_key, threshold_percent)`);

console.log('[post-merge] Schema pre-migration complete');
await client.end();
JSEOF
