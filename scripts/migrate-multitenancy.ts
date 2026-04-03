import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { companies } from "../shared/schema";

const DEFAULT_COMPANY_NAME = "Default Company";

interface CountRow {
  count: string;
}

async function backfillTable(tableName: string, companyId: string): Promise<{ updated: number; remaining: number }> {
  const updateResult = await db.execute<{ rowCount: number }>(
    sql`UPDATE ${sql.raw(`"${tableName}"`)} SET company_id = ${companyId} WHERE company_id IS NULL`
  );

  const countResult = await db.execute<CountRow>(
    sql`SELECT COUNT(*)::text AS count FROM ${sql.raw(`"${tableName}"`)} WHERE company_id IS NULL`
  );

  const remaining = parseInt(countResult.rows[0]?.count ?? "0", 10);
  const updated = updateResult.rowCount ?? 0;

  return { updated, remaining };
}

async function run() {
  console.log("[migrate-multitenancy] Starting...");

  let [existingCompany] = await db.select().from(companies).limit(1);

  let companyId: string;
  if (!existingCompany) {
    console.log("[migrate-multitenancy] Creating default company...");
    const [created] = await db.insert(companies).values({
      name: DEFAULT_COMPANY_NAME,
      plan: "starter",
    }).returning();
    companyId = created.id;
    console.log(`[migrate-multitenancy] Default company created: ${companyId}`);
  } else {
    companyId = existingCompany.id;
    console.log(`[migrate-multitenancy] Using existing company: ${companyId}`);
  }

  // Tables that have direct company_id columns — all must be fully backfilled.
  // Any NULL company_id remaining after backfill is a hard failure.
  const directCompanyIdTables = [
    "users",
    "time_entries",
    "schedules",
    "tasks",
    "messages",
    "work_locations",
    "payroll_periods",
    "user_availability",
    "time_off_requests",
    "pay_period_settings",
    "shoutouts",
    "ai_insights",
    "company_settings",
    "activity_logs",
    "clock_events",
    "holiday_pay_rules",
    "sop_categories",
    "sop_documents",
    "training_modules",
    "performance_score_settings",
    "geofence_events",
    "offsite_allowance_rules",
    "offsite_sessions",
    "overtime_alerts",
    "issues",
    "chat_groups",
    "employee_documents",
    "manager_notes",
    "ai_chat_conversations",
    "message_threads",
  ];

  console.log(`\n[migrate-multitenancy] Backfilling ${directCompanyIdTables.length} direct company_id tables...`);
  const failures: string[] = [];

  for (const table of directCompanyIdTables) {
    try {
      const { updated, remaining } = await backfillTable(table, companyId);
      if (remaining > 0) {
        const message = `${table}: ${remaining} rows still have NULL company_id after backfill`;
        console.error(`[migrate-multitenancy] FAIL: ${message}`);
        failures.push(message);
      } else {
        console.log(`[migrate-multitenancy] OK: ${table} — updated ${updated} rows, 0 remaining nulls`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[migrate-multitenancy] FAIL: ${table} — ${message}`);
      failures.push(`${table}: ${message}`);
    }
  }

  // Backfill schedule_confirmations.company_id from parent payroll_periods table (fail-closed)
  try {
    await db.execute(
      sql`UPDATE schedule_confirmations sc SET company_id = pp.company_id FROM payroll_periods pp WHERE sc.payroll_period_id = pp.id AND sc.company_id IS NULL AND pp.company_id IS NOT NULL`
    );
    const scRemaining = await db.execute<CountRow>(
      sql`SELECT COUNT(*)::text AS count FROM schedule_confirmations WHERE company_id IS NULL`
    );
    const scNulls = parseInt(scRemaining.rows[0]?.count ?? "0", 10);
    if (scNulls > 0) {
      const msg = `schedule_confirmations: ${scNulls} rows still have NULL company_id after JOIN backfill`;
      console.error(`[migrate-multitenancy] FAIL: ${msg}`);
      failures.push(msg);
    } else {
      console.log(`[migrate-multitenancy] OK: schedule_confirmations — backfilled via payroll_periods JOIN`);
    }
  } catch (err) {
    const msg = `schedule_confirmations: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[migrate-multitenancy] FAIL: ${msg}`);
    failures.push(msg);
  }

  // Backfill workflow_logs.company_id from parent payroll_periods table (fail-closed)
  try {
    await db.execute(
      sql`UPDATE workflow_logs wl SET company_id = pp.company_id FROM payroll_periods pp WHERE wl.payroll_period_id = pp.id AND wl.company_id IS NULL AND pp.company_id IS NOT NULL`
    );
    const wlRemaining = await db.execute<CountRow>(
      sql`SELECT COUNT(*)::text AS count FROM workflow_logs WHERE company_id IS NULL`
    );
    const wlNulls = parseInt(wlRemaining.rows[0]?.count ?? "0", 10);
    if (wlNulls > 0) {
      const msg = `workflow_logs: ${wlNulls} rows still have NULL company_id after JOIN backfill`;
      console.error(`[migrate-multitenancy] FAIL: ${msg}`);
      failures.push(msg);
    } else {
      console.log(`[migrate-multitenancy] OK: workflow_logs — backfilled via payroll_periods JOIN`);
    }
  } catch (err) {
    const msg = `workflow_logs: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`[migrate-multitenancy] FAIL: ${msg}`);
    failures.push(msg);
  }

  // JOIN-backfill tables that have direct company_id columns but get values from parent (fail-closed)
  const joinBackfills: Array<{ name: string; sql: string }> = [
    {
      name: "ai_chat_messages",
      sql: `UPDATE ai_chat_messages acm SET company_id = u.company_id FROM ai_chat_conversations acc JOIN users u ON acc.user_id = u.id WHERE acm.conversation_id = acc.id AND acm.company_id IS NULL AND u.company_id IS NOT NULL`,
    },
    {
      name: "thread_messages",
      sql: `UPDATE thread_messages tm SET company_id = mt.company_id FROM message_threads mt WHERE tm.thread_id = mt.id AND tm.company_id IS NULL AND mt.company_id IS NOT NULL`,
    },
    {
      name: "commute_alerts",
      sql: `UPDATE commute_alerts ca SET company_id = u.company_id FROM users u WHERE ca.user_id = u.id AND ca.company_id IS NULL AND u.company_id IS NOT NULL`,
    },
    {
      name: "time_entry_edits",
      sql: `UPDATE time_entry_edits tee SET company_id = te.company_id FROM time_entries te WHERE tee.time_entry_id = te.id AND tee.company_id IS NULL AND te.company_id IS NOT NULL`,
    },
    {
      name: "group_members",
      sql: `UPDATE group_members gm SET company_id = cg.company_id FROM chat_groups cg WHERE gm.group_id = cg.id AND gm.company_id IS NULL AND cg.company_id IS NOT NULL`,
    },
  ];

  console.log(`\n[migrate-multitenancy] JOIN-backfilling ${joinBackfills.length} child tables...`);
  for (const { name, sql: updateSql } of joinBackfills) {
    try {
      await db.execute(sql.raw(updateSql));
      const remaining = await db.execute<CountRow>(
        sql`SELECT COUNT(*)::text AS count FROM ${sql.raw(`"${name}"`)} WHERE company_id IS NULL`
      );
      const nullCount = parseInt(remaining.rows[0]?.count ?? "0", 10);
      if (nullCount > 0) {
        // Warn but do not fail — some rows may genuinely have NULL parent company_id
        console.warn(`[migrate-multitenancy] WARN: ${name}: ${nullCount} rows have NULL company_id (parent may lack company_id)`);
      } else {
        console.log(`[migrate-multitenancy] OK: ${name} — backfilled via parent JOIN`);
      }
    } catch (err) {
      // Table may not exist yet (e.g., group_members) — skip gracefully
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('does not exist')) {
        console.log(`[migrate-multitenancy] SKIP: ${name} — table not yet created (will be seeded correctly on first write)`);
      } else {
        const failure = `${name}: ${msg}`;
        console.error(`[migrate-multitenancy] FAIL: ${failure}`);
        failures.push(failure);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n[migrate-multitenancy] Migration FAILED with ${failures.length} error(s):`);
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.log("\n[migrate-multitenancy] Done — all direct company_id tables backfilled successfully.");
  console.log("[migrate-multitenancy] Parent-scoped tables rely on storage-layer JOIN enforcement for isolation.");
  process.exit(0);
}

run().catch(err => {
  console.error("[migrate-multitenancy] Fatal error:", err);
  process.exit(1);
});
