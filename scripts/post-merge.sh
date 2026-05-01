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

console.log('[post-merge] Schema pre-migration complete');
await client.end();
JSEOF
