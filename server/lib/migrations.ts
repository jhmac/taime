import { db } from "../db";
import { sql } from "drizzle-orm";
import { workLocations } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Adds store_id columns to singleton tables for multi-tenancy isolation.
 * Safe to run multiple times (uses IF NOT EXISTS / DO NOTHING patterns).
 * Each ALTER is wrapped individually so one failure doesn't block the rest.
 */
export async function runSchemaMigrations(): Promise<void> {
  const alterations: Array<{ table: string; sql: string }> = [
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    {
      table: "sop_categories",
      sql: `ALTER TABLE sop_categories ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    {
      table: "training_modules",
      sql: `ALTER TABLE training_modules ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    {
      table: "company_ai_context",
      sql: `ALTER TABLE company_ai_context ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    {
      table: "generation_jobs",
      sql: `ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
  ];

  let altered = 0;
  for (const { table, sql: statement } of alterations) {
    try {
      await db.execute(sql.raw(statement));
      altered++;
    } catch (err: any) {
      if (err?.code === "42P01") {
        console.log(`[Migration] Table '${table}' does not exist yet — skipping column add`);
      } else {
        console.warn(`[Migration] Failed to alter '${table}':`, err?.message ?? err);
      }
    }
  }

  if (altered === 0) {
    console.log("[Migration] No tables were altered");
    return;
  }

  // Backfill: assign existing rows to the first active store if store_id is null
  try {
    const [firstStore] = await db
      .select({ id: workLocations.id })
      .from(workLocations)
      .where(eq(workLocations.isActive, true))
      .limit(1);

    if (firstStore) {
      const storeId = firstStore.id;

      const backfills: Array<{ table: string; sql: string }> = [
        { table: "company_settings", sql: `UPDATE company_settings SET store_id = '${storeId}' WHERE store_id IS NULL` },
        { table: "sop_categories", sql: `UPDATE sop_categories SET store_id = '${storeId}' WHERE store_id IS NULL` },
        { table: "training_modules", sql: `UPDATE training_modules SET store_id = '${storeId}' WHERE store_id IS NULL` },
        { table: "company_ai_context", sql: `UPDATE company_ai_context SET store_id = '${storeId}' WHERE store_id IS NULL` },
        { table: "generation_jobs", sql: `UPDATE generation_jobs SET store_id = '${storeId}' WHERE store_id IS NULL` },
      ];

      for (const { table, sql: statement } of backfills) {
        try {
          await db.execute(sql.raw(statement));
        } catch {
          // Table may not exist yet; silently skip
        }
      }

      console.log(`[Migration] Backfilled singleton table store_id to storeId=${storeId}`);
    } else {
      console.log(`[Migration] No active store found — skipping singleton store_id backfill`);
    }
  } catch (err) {
    console.warn("[Migration] Backfill step failed (non-fatal):", err);
  }

  console.log(`[Migration] Schema migrations complete (${altered} table(s) altered)`);
}
