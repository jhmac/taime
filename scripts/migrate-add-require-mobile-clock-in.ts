import { db } from "../server/db";
import { sql } from "drizzle-orm";

async function migrate() {
  console.log("Adding require_mobile_clock_in column to company_settings...");
  await db.execute(
    sql`ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS require_mobile_clock_in boolean DEFAULT false`
  );
  console.log("Migration complete.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
