import { db } from "../server/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent migration to fix missing DB columns and tables that were
 * causing 500 errors in:
 *   - /api/company-settings (missing require_mobile_clock_in)
 *   - /api/gamification/notices (missing score_notices table)
 *   - /api/users/:id/notes (missing manager_id on manager_notes)
 *   - /api/users/:id/resend-invite (depends on company-settings)
 *
 * All statements use IF NOT EXISTS guards and are safe to run multiple times.
 */
async function migrate() {
  console.log("=== Fix Missing DB Columns & Tables Migration ===");

  console.log("1. Adding require_mobile_clock_in to company_settings...");
  await db.execute(
    sql`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS require_mobile_clock_in boolean DEFAULT false`
  );
  console.log("   Done.");

  console.log("2. Creating score_notices table...");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS score_notices (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id varchar NOT NULL REFERENCES users(id),
      category varchar NOT NULL,
      severity varchar NOT NULL DEFAULT 'info',
      message text NOT NULL,
      is_read boolean DEFAULT false,
      created_at timestamp DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_score_notices_user ON score_notices(user_id)`
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_score_notices_user_category ON score_notices(user_id, category)`
  );
  console.log("   Done.");

  console.log("3. Adding manager_id and related columns to manager_notes...");
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS manager_id varchar`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS note text`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS category varchar`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false`);
  await db.execute(sql`ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT now()`);
  console.log("   Done.");

  console.log("=== Migration complete ===");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
