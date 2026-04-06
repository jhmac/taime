import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("=== Settings & Roles Migration ===");

  console.log("1. Adding require_mobile_clock_in to company_settings...");
  await db.execute(
    sql`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS require_mobile_clock_in boolean DEFAULT false`
  );

  console.log("2. Adding scope column to shops table...");
  await db.execute(
    sql`ALTER TABLE shops ADD COLUMN IF NOT EXISTS scope varchar`
  );

  console.log("3. Creating score_notices table (idempotent)...");
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
  await db.execute(sql`ALTER TABLE score_notices ADD COLUMN IF NOT EXISTS severity varchar NOT NULL DEFAULT 'info'`);
  await db.execute(sql`ALTER TABLE score_notices ADD COLUMN IF NOT EXISTS message text`);
  await db.execute(sql`ALTER TABLE score_notices ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false`);
  await db.execute(sql`ALTER TABLE score_notices DROP COLUMN IF EXISTS last_notified_at`);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS idx_score_notices_user ON score_notices(user_id)`
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_score_notices_user_category ON score_notices(user_id, category)`
  );

  console.log("4. Fixing Jh Mac role to owner (user id: 46870047)...");
  const ownerRole = await db.execute(
    sql`SELECT id FROM roles WHERE name = 'owner' LIMIT 1`
  );
  const adminRole = await db.execute(
    sql`SELECT id FROM roles WHERE name = 'admin' LIMIT 1`
  );
  const ownerRows = ownerRole.rows as Array<{ id: string }>;
  const adminRows = adminRole.rows as Array<{ id: string }>;
  const targetRoleId = ownerRows[0]?.id ?? adminRows[0]?.id;
  if (targetRoleId) {
    await db.execute(
      sql`UPDATE users SET role_id = ${targetRoleId} WHERE id = '46870047'`
    );
    const roleName = ownerRows[0]?.id ? "owner" : "admin";
    console.log(`   Updated user 46870047 to ${roleName} role (${targetRoleId})`);
  } else {
    throw new Error("Neither owner nor admin role found — cannot fix Jh Mac access");
  }

  console.log("=== Migration complete ===");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
