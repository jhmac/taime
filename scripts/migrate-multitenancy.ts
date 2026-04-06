import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Running multitenancy schema sync migration...");

  console.log("1. Adding score_notices table...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS score_notices (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL REFERENCES users(id),
      category VARCHAR NOT NULL,
      severity VARCHAR NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_score_notices_user ON score_notices(user_id)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_score_notices_user_category ON score_notices(user_id, category)`);
  console.log("   score_notices table ready.");

  console.log("2. Adding require_mobile_clock_in to company_settings...");
  await db.execute(sql`
    ALTER TABLE company_settings
    ADD COLUMN IF NOT EXISTS require_mobile_clock_in BOOLEAN DEFAULT false
  `);
  console.log("   require_mobile_clock_in column ready.");

  console.log("3. Syncing shops table columns...");
  await db.execute(sql`ALTER TABLE shops ADD COLUMN IF NOT EXISTS scope VARCHAR`);
  await db.execute(sql`ALTER TABLE shops ADD COLUMN IF NOT EXISTS installed_at TIMESTAMP DEFAULT NOW()`);
  console.log("   shops table ready.");

  console.log("4. Syncing user_shops table columns...");
  await db.execute(sql`ALTER TABLE user_shops ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  console.log("   user_shops table ready.");

  console.log("5. Syncing training_modules table columns...");
  await db.execute(sql`ALTER TABLE training_modules ADD COLUMN IF NOT EXISTS content TEXT`);
  await db.execute(sql`ALTER TABLE training_modules ADD COLUMN IF NOT EXISTS category VARCHAR`);
  console.log("   training_modules table ready.");

  console.log("6. Syncing employee_training_progress table columns...");
  await db.execute(sql`ALTER TABLE employee_training_progress ADD COLUMN IF NOT EXISTS score INTEGER`);
  await db.execute(sql`ALTER TABLE employee_training_progress ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
  console.log("   employee_training_progress table ready.");

  console.log("7. Syncing commute_alerts table columns...");
  await db.execute(sql`ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS type VARCHAR`);
  await db.execute(sql`ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS title VARCHAR`);
  await db.execute(sql`ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS severity VARCHAR DEFAULT 'info'`);
  await db.execute(sql`ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false`);
  await db.execute(sql`ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS metadata JSONB`);
  await db.execute(sql`ALTER TABLE commute_alerts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  console.log("   commute_alerts table ready.");

  console.log("8. Syncing manager_notes table columns...");
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS manager_id VARCHAR`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS note TEXT`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS category VARCHAR`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
  console.log("   manager_notes table ready.");

  console.log("9. Syncing user_work_patterns table columns...");
  await db.execute(sql`ALTER TABLE user_work_patterns ADD COLUMN IF NOT EXISTS custom_pattern JSONB`);
  await db.execute(sql`ALTER TABLE user_work_patterns ADD COLUMN IF NOT EXISTS effective_from TIMESTAMP`);
  await db.execute(sql`ALTER TABLE user_work_patterns ADD COLUMN IF NOT EXISTS effective_to TIMESTAMP`);
  await db.execute(sql`ALTER TABLE user_work_patterns ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
  await db.execute(sql`ALTER TABLE user_work_patterns ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
  console.log("   user_work_patterns table ready.");

  console.log("10. Syncing work_pattern_templates table columns...");
  await db.execute(sql`ALTER TABLE work_pattern_templates ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
  console.log("    work_pattern_templates table ready.");

  console.log("11. Adding missing unique constraints...");
  const constraints = [
    { table: "shops", name: "shops_shop_domain_unique", cols: "shop_domain" },
    { table: "permissions", name: "permissions_name_unique", cols: "name" },
    { table: "roles", name: "roles_name_unique", cols: "name" },
    { table: "users", name: "users_invite_token_unique", cols: "invite_token" },
    { table: "thread_participants", name: "uq_thread_participant", cols: "thread_id, user_id" },
    { table: "cash_management_settings", name: "cash_management_settings_store_id_unique", cols: "store_id" },
  ];
  for (const c of constraints) {
    try {
      await db.execute(sql.raw(`ALTER TABLE ${c.table} ADD CONSTRAINT ${c.name} UNIQUE (${c.cols})`));
      console.log(`    Added constraint: ${c.name}`);
    } catch {
      console.log(`    Constraint already exists: ${c.name}`);
    }
  }

  console.log("Migration complete!");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
