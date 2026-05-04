import { db } from "../db";
import { sql } from "drizzle-orm";
import { workLocations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";

/**
 * Applies idempotent schema alterations at server startup.
 * Uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS patterns so it is safe to run on every boot.
 * New columns and tables are always brought in sync with shared/schema.ts definitions.
 */
export async function runSchemaMigrations(): Promise<void> {
  // Column additions to existing tables (idempotent — safe to re-run on every boot)
  const columnAlterations: Array<{ table: string; sql: string }> = [
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
    // AI Content Studio: source column tracks whether a SOP was AI-generated
    {
      table: "sop_documents",
      sql: `ALTER TABLE sop_documents ADD COLUMN IF NOT EXISTS source varchar DEFAULT 'manual'`,
    },
    // --- Critical backfills for generation_jobs ---
    // generation_jobs.results_json: written by runAiStudioGenerationJob — must exist.
    {
      table: "generation_jobs",
      sql: `ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS results_json jsonb`,
    },
    // generation_jobs.store_id (ensure it exists for store scoping)
    {
      table: "generation_jobs",
      sql: `ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    // --- Critical backfills for company_ai_context ---
    // company_ai_context.goals: matches schema.ts; old migration had 'key_processes' instead.
    {
      table: "company_ai_context",
      sql: `ALTER TABLE company_ai_context ADD COLUMN IF NOT EXISTS goals jsonb DEFAULT '[]'`,
    },
    // company_ai_context.store_id (ensure it exists for store scoping)
    {
      table: "company_ai_context",
      sql: `ALTER TABLE company_ai_context ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    // --- Critical backfills for knowledge_documents ---
    // These repair envs where table was created with old schema (e.g. processed_content instead of extracted_text)
    {
      table: "knowledge_documents",
      sql: `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS extracted_text text`,
    },
    {
      table: "knowledge_documents",
      sql: `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS summary_from_claude text`,
    },
    {
      table: "knowledge_documents",
      sql: `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS error_message text`,
    },
    {
      table: "knowledge_documents",
      sql: `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS document_type varchar DEFAULT 'other'`,
    },
    {
      table: "knowledge_documents",
      sql: `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS auto_tags text[] DEFAULT '{}'`,
    },
    // sop_templates.tags: array column used by SOPIndexer and SOP creation
    {
      table: "sop_templates",
      sql: `ALTER TABLE sop_templates ADD COLUMN IF NOT EXISTS tags text[]`,
    },
    // users.company_id and shops.company_id: Shopify multi-tenant support
    {
      table: "users",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id varchar`,
    },
    {
      table: "shops",
      sql: `ALTER TABLE shops ADD COLUMN IF NOT EXISTS company_id varchar`,
    },
    // company_settings: mobile clock-in enforcement flag
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS require_mobile_clock_in boolean DEFAULT false`,
    },
    // cash_management_settings: store closing time for end-of-day prompts
    {
      table: "cash_management_settings",
      sql: `ALTER TABLE cash_management_settings ADD COLUMN IF NOT EXISTS closing_time varchar`,
    },
    // company_settings: default mileage rate (cents) — missing column crashes resend invite endpoint
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS default_mileage_rate_cents integer DEFAULT 0`,
    },
    // company_settings: task auto-assign toggle
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS task_auto_assign boolean DEFAULT false`,
    },
    // company_settings: daily sales goal feature
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS daily_sales_goal_enabled boolean DEFAULT false`,
    },
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS sales_goal_increase_type varchar DEFAULT 'percentage'`,
    },
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS sales_goal_increase_value numeric(10,2) DEFAULT 0`,
    },
    // offsite_sessions: route polyline for map rendering
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS route_polyline text`,
    },
    // manager_notes: manager_id foreign key
    {
      table: "manager_notes",
      sql: `ALTER TABLE manager_notes ADD COLUMN IF NOT EXISTS manager_id varchar`,
    },
    // shops.installed_at: Shopify OAuth callback requires this column
    {
      table: "shops",
      sql: `ALTER TABLE shops ADD COLUMN IF NOT EXISTS installed_at TIMESTAMP DEFAULT NOW()`,
    },
    // user_quiz_progress: pending_boss_battle flag — set after full topic rotation completes
    {
      table: "user_quiz_progress",
      sql: `ALTER TABLE user_quiz_progress ADD COLUMN IF NOT EXISTS pending_boss_battle boolean DEFAULT false`,
    },
    // user_quiz_progress: scenario_participation_count — tracks "What Would You Do?" engagements
    {
      table: "user_quiz_progress",
      sql: `ALTER TABLE user_quiz_progress ADD COLUMN IF NOT EXISTS scenario_participation_count integer DEFAULT 0`,
    },
    // user_quiz_progress: scenario_last_awarded_date — weekly lock to prevent point farming
    {
      table: "user_quiz_progress",
      sql: `ALTER TABLE user_quiz_progress ADD COLUMN IF NOT EXISTS scenario_last_awarded_date date`,
    },
    // user_shops.created_at: OAuth callback writes to this column; missing on older installs
    {
      table: "user_shops",
      sql: `ALTER TABLE user_shops ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
    },
    // work_pattern_templates.is_active: queried by aiScheduling routes
    {
      table: "work_pattern_templates",
      sql: `ALTER TABLE work_pattern_templates ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true`,
    },
    // user_work_patterns.custom_pattern: queried by aiScheduling routes
    {
      table: "user_work_patterns",
      sql: `ALTER TABLE user_work_patterns ADD COLUMN IF NOT EXISTS custom_pattern jsonb`,
    },
    // ── ai_chat_conversations.context: CRITICAL — missing column breaks every /api/ai/ask call ──
    {
      table: "ai_chat_conversations",
      sql: `ALTER TABLE ai_chat_conversations ADD COLUMN IF NOT EXISTS context jsonb`,
    },
    // ── offsite_sessions: trip tracking columns added in later schema versions ──
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS route_distance_meters integer`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS route_duration_seconds integer`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS estimated_return_time timestamp`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS destination_arrived_at timestamp`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS deviation_alerts_sent integer DEFAULT 0`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS destination_not_reached_alert_sent boolean DEFAULT false`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS overdue_return_alert_sent boolean DEFAULT false`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS total_distance_miles decimal(8,2)`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS deviation_event_count integer DEFAULT 0`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS max_deviation_miles decimal(8,2)`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS destination_reached boolean`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS reimbursement_cents integer`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS breadcrumbs jsonb`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS reviewed_by varchar REFERENCES users(id)`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS reviewed_at timestamp`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS admin_note text`,
    },
    // --- unanswered_questions column guards (idempotent for partial-schema environments) ---
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'pending'`,
    },
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS asked_at timestamp DEFAULT now()`,
    },
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS created_at timestamp DEFAULT now()`,
    },
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS ai_answer text`,
    },
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS answer text`,
    },
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS answered_by_user_id varchar REFERENCES users(id)`,
    },
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS answered_at timestamp`,
    },
    {
      table: "unanswered_questions",
      sql: `ALTER TABLE unanswered_questions ADD COLUMN IF NOT EXISTS conversation_id varchar REFERENCES ai_chat_conversations(id)`,
    },
    {
      table: "users",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS federal_withholding_pct decimal(5,2) DEFAULT 12`,
    },
    {
      table: "users",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS state_withholding_pct decimal(5,2) DEFAULT 5`,
    },
    {
      table: "users",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS other_deductions_cents integer DEFAULT 0`,
    },
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS show_pay_summary_to_employees boolean DEFAULT false`,
    },
    {
      table: "company_settings",
      sql: `ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS show_pay_summary_to_managers boolean DEFAULT false`,
    },
    // users.location_id: proper FK to work_locations replacing fragile name-based matching
    {
      table: "users",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    // Task #256 — Shopify POS register data pull
    {
      table: "drawer_sessions",
      sql: `ALTER TABLE drawer_sessions ADD COLUMN IF NOT EXISTS notes text`,
    },
    {
      table: "cash_deposits",
      sql: `ALTER TABLE cash_deposits ADD COLUMN IF NOT EXISTS drawer_session_id varchar`,
    },
    // Task #297 — manager override indicator in schedule grid
    {
      table: "user_availability_overrides",
      sql: `ALTER TABLE user_availability_overrides ADD COLUMN IF NOT EXISTS set_by_manager_id varchar REFERENCES users(id)`,
    },
    // Task #281 — employee break clock (Start/End Break)
    {
      table: "time_entries",
      sql: `ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS break_start_time TIMESTAMP`,
    },
    // Task #331 — availability_templates.auto_apply_template: missing from runtime runner despite having SQL migration file
    {
      table: "availability_templates",
      sql: `ALTER TABLE availability_templates ADD COLUMN IF NOT EXISTS auto_apply_template boolean NOT NULL DEFAULT false`,
    },
    // Task #397 — configurable per-store labor cost target band for daily warnings
    {
      table: "ai_scheduling_settings",
      sql: `ALTER TABLE ai_scheduling_settings ADD COLUMN IF NOT EXISTS labor_cost_over_pct numeric(5,2) DEFAULT 30`,
    },
    {
      table: "ai_scheduling_settings",
      sql: `ALTER TABLE ai_scheduling_settings ADD COLUMN IF NOT EXISTS labor_cost_under_pct numeric(5,2) DEFAULT 10`,
    },
    // Task #435 — scope ai_scheduling_settings per store. The column is added
    // here; the unique index, backfill, and orphan cleanup are handled in the
    // dedicated block below so a single column-add failure can't block them.
    {
      table: "ai_scheduling_settings",
      sql: `ALTER TABLE ai_scheduling_settings ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE`,
    },
    // score_notices.title was added as NOT NULL in an older migration but is
    // not in the Drizzle schema and not populated by gamificationService.ts,
    // causing "null value in column title" crashes. Make it nullable so inserts
    // without a title succeed. The column is harmless as nullable; drizzle-push
    // will eventually clean it up.
    {
      table: "score_notices",
      sql: `ALTER TABLE score_notices ALTER COLUMN title DROP NOT NULL`,
    },
    // Photo verification toggle for broadcast tasks (Task #photo-verify).
    // When enabled, team members must submit a photo before the task is accepted.
    // The manager's verification queue already shows the previous week's photo
    // alongside the new one for a side-by-side comparison.
    {
      table: "tasks",
      sql: `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS requires_photo boolean DEFAULT false`,
    },
    // Task #496 — Timesheet approval workflow: add per-store scoping to workflow settings
    {
      table: "timesheet_workflow_settings",
      sql: `ALTER TABLE timesheet_workflow_settings ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    // Task #496 — Timesheet reminder log: add per-store scoping
    {
      table: "timesheet_reminder_log",
      sql: `ALTER TABLE timesheet_reminder_log ADD COLUMN IF NOT EXISTS store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
    },
    // Task #496 — Optional email reminder channel
    {
      table: "timesheet_workflow_settings",
      sql: `ALTER TABLE timesheet_workflow_settings ADD COLUMN IF NOT EXISTS email_reminders_enabled boolean DEFAULT false`,
    },
    {
      table: "timesheet_workflow_settings",
      sql: `ALTER TABLE timesheet_workflow_settings ADD COLUMN IF NOT EXISTS reminder_from_email varchar`,
    },
    // Task #488 — Off-site route overhaul: multi-stop waypoints, daily trip limit,
    // configurable deviation tolerance, chosen route polyline.
    {
      table: "offsite_allowance_rules",
      sql: `ALTER TABLE offsite_allowance_rules ADD COLUMN IF NOT EXISTS max_trips_per_day integer`,
    },
    {
      table: "offsite_allowance_rules",
      sql: `ALTER TABLE offsite_allowance_rules ADD COLUMN IF NOT EXISTS deviation_tolerance_meters integer DEFAULT 200`,
    },
    {
      table: "offsite_allowance_rules",
      sql: `ALTER TABLE offsite_allowance_rules ADD COLUMN IF NOT EXISTS waypoints jsonb`,
    },
    {
      table: "offsite_allowance_rules",
      sql: `ALTER TABLE offsite_allowance_rules ADD COLUMN IF NOT EXISTS chosen_route_polyline text`,
    },
    // Task #488 — offsite_sessions tracking columns for multi-leg routes and consecutive deviation auto clock-out.
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS session_waypoints jsonb`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS current_leg_index integer DEFAULT 0`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS consecutive_off_route_count integer DEFAULT 0`,
    },
    {
      table: "offsite_sessions",
      sql: `ALTER TABLE offsite_sessions ADD COLUMN IF NOT EXISTS clocked_out_off_route boolean DEFAULT false`,
    },
    // Task #474 — Operational Insights: "why it matters" rationale separate
    // from the observation, populated by the AI generator and rendered on
    // dashboard widget + insights page.
    {
      table: "operational_insights",
      sql: `ALTER TABLE operational_insights ADD COLUMN IF NOT EXISTS why_it_matters text`,
    },
    // Task #529 — Fix "Failed to send message": thread_messages was created
    // without the reactions/kudo columns that migration 0025 adds via Drizzle.
    // These three ADD COLUMN IF NOT EXISTS calls are idempotent.
    {
      table: "thread_messages",
      sql: `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS "reactions" jsonb DEFAULT '[]'::jsonb`,
    },
    {
      table: "thread_messages",
      sql: `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS "to_employee_id" text`,
    },
    {
      table: "thread_messages",
      sql: `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS "kudo_category" text`,
    },
  ];

  let altered = 0;
  for (const { table, sql: statement } of columnAlterations) {
    try {
      await db.execute(sql.raw(statement));
      altered++;
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr?.code === "42P01") {
        // Table not yet created — skip, it will be created below
      } else if (pgErr?.code === "42701") {
        // Column already exists — this is fine
        altered++;
      } else {
        console.warn(`[Migration] Failed to alter '${table}':`, pgErr?.message ?? err);
      }
    }
  }

  // Backfill: tasks created before location scoping was enforced have
  // location_id = NULL, making them invisible to store-scoped queries.
  // Assign them to the first work_location (safe for single-store installs).
  try {
    await db.execute(sql.raw(`
      UPDATE tasks
      SET location_id = (SELECT id FROM work_locations ORDER BY name LIMIT 1)
      WHERE location_id IS NULL
        AND EXISTS (SELECT 1 FROM work_locations LIMIT 1)
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] tasks location_id backfill failed (non-fatal):", pgErr?.message ?? err);
  }

  // Backfill: users without a location_id cannot access any store-scoped feature.
  // On a single-store install this is always an oversight — assign them to the
  // one active store so they can clock in, see training, etc.
  try {
    await db.execute(sql.raw(`
      UPDATE users
      SET location_id = (SELECT id FROM work_locations WHERE is_active = true ORDER BY name LIMIT 1)
      WHERE location_id IS NULL
        AND (SELECT count(*) FROM work_locations WHERE is_active = true) = 1
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] users location_id backfill failed (non-fatal):", pgErr?.message ?? err);
  }

  // Index on users.location_id for fast store-scoped queries
  try {
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_users_location_id ON users (location_id)`));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] idx_users_location_id creation failed (non-fatal):", pgErr?.message ?? err);
  }

  // Task #432 — Database-enforced overlap guard for schedules.
  // Two concurrent /api/ai-scheduling/apply requests can race past the
  // application-level overlap check (Task #328) and write two overlapping
  // shifts for the same employee. A Postgres EXCLUDE constraint over
  // (user_id, [start_time, end_time)) makes the DB itself reject the second
  // insert atomically. The half-open `[start, end)` range matches the
  // existing app-level overlap predicate so two shifts that touch at a
  // single instant (one ending at 13:00, the next starting at 13:00) are
  // NOT considered overlapping. We use `tsrange` (not `tstzrange`) because
  // start_time/end_time are `timestamp without time zone` — `tstzrange`
  // would require a STABLE session-timezone cast that Postgres refuses
  // inside an index expression ("functions in index expression must be
  // marked IMMUTABLE"). The route layer already maps wall-clock entries
  // to the correct UTC instants before they hit the DB.
  //
  // Task #461 — Pre-cleanup of pre-existing overlapping rows. Earlier
  // environments accumulated overlapping `schedules` before this guard
  // existed (the very race the constraint is meant to prevent). Adding
  // the constraint to such a database fails with `conflicting key value
  // violates exclusion constraint`, leaving the DB unprotected. To make
  // this migration self-healing, we first merge each per-user cluster of
  // mutually-overlapping shifts into a single covering row [min(start),
  // max(end)] and delete the duplicates. The kept row is the one with
  // the widest range (deterministic tiebreak by id). Cluster detection
  // uses gaps-and-islands with the half-open `[start, end)` rule
  // (`start >= prev_max_end` ⇒ new cluster) so back-to-back shifts that
  // merely touch at the boundary are NOT merged. Wrapped in a DO block
  // so the loop and DDL run in a single round-trip; the whole step is
  // idempotent (no clusters of size > 1 ⇒ no rows updated/deleted).
  try {
    await db.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS btree_gist`));
    await db.execute(sql.raw(`
      DO $$
      DECLARE
        rec RECORD;
      BEGIN
        FOR rec IN
          WITH ordered AS (
            SELECT id, user_id, start_time, end_time,
              MAX(end_time) OVER (
                PARTITION BY user_id ORDER BY start_time, end_time
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
              ) AS prev_max_end
            FROM schedules
          ),
          flagged AS (
            SELECT *,
              CASE WHEN prev_max_end IS NULL OR start_time >= prev_max_end
                   THEN 1 ELSE 0 END AS is_new
            FROM ordered
          ),
          numbered AS (
            SELECT *, SUM(is_new) OVER (
              PARTITION BY user_id ORDER BY start_time, end_time
              ROWS UNBOUNDED PRECEDING
            ) AS cluster_id
            FROM flagged
          )
          SELECT user_id, cluster_id,
                 MIN(start_time) AS new_start,
                 MAX(end_time) AS new_end,
                 (array_agg(id ORDER BY (end_time - start_time) DESC, id))[1] AS keep_id,
                 array_agg(id) AS all_ids
          FROM numbered
          GROUP BY user_id, cluster_id
          HAVING count(*) > 1
        LOOP
          UPDATE schedules
            SET start_time = rec.new_start, end_time = rec.new_end
            WHERE id = rec.keep_id;
          DELETE FROM schedules
            WHERE id = ANY(rec.all_ids) AND id <> rec.keep_id;
        END LOOP;
      END$$;
    `));
    await db.execute(sql.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'schedules_no_overlap_per_user'
        ) THEN
          ALTER TABLE schedules
            ADD CONSTRAINT schedules_no_overlap_per_user
            EXCLUDE USING gist (
              user_id WITH =,
              tsrange(start_time, end_time, '[)') WITH &&
            );
        END IF;
      END$$;
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn(
      "[Migration] schedules_no_overlap_per_user constraint creation failed (non-fatal — likely existing overlapping rows):",
      pgErr?.message ?? err,
    );
  }

  // Task #435 — Per-store ai_scheduling_settings backfill + uniqueness.
  // Before this migration the table was a singleton: every tenant on the same
  // DB shared the SAME row, which the route returned with `limit(1)` and no
  // store filter. We:
  //   1) For each existing row whose store_id is NULL, copy its values into a
  //      new row for every active work_location that doesn't already have one.
  //      That preserves the previous "shared" config across all stores so
  //      nobody loses their staffing tiers / store hours / labor cost band.
  //   2) Delete the leftover NULL-store_id rows.
  //   3) Enforce one row per store via a unique index.
  // All three steps are idempotent — re-running them on a fully-migrated DB
  // is a no-op.
  try {
    await db.execute(sql.raw(`
      INSERT INTO ai_scheduling_settings (
        shift_blocks, staffing_tiers, minimum_staffing, updated_by, updated_at,
        store_hours, shift_overlap_minutes, overlap_budget_limit, custom_ai_instructions,
        labor_cost_over_pct, labor_cost_under_pct, store_id
      )
      SELECT
        s.shift_blocks, s.staffing_tiers, s.minimum_staffing, s.updated_by, NOW(),
        s.store_hours, s.shift_overlap_minutes, s.overlap_budget_limit, s.custom_ai_instructions,
        s.labor_cost_over_pct, s.labor_cost_under_pct, w.id
      FROM ai_scheduling_settings s
      CROSS JOIN work_locations w
      WHERE s.store_id IS NULL
        AND w.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM ai_scheduling_settings s2 WHERE s2.store_id = w.id
        )
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn(
      "[Migration] ai_scheduling_settings per-store backfill failed (non-fatal):",
      pgErr?.message ?? err,
    );
  }
  try {
    await db.execute(sql.raw(`DELETE FROM ai_scheduling_settings WHERE store_id IS NULL`));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn(
      "[Migration] ai_scheduling_settings NULL store_id cleanup failed (non-fatal):",
      pgErr?.message ?? err,
    );
  }
  try {
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_scheduling_settings_store_id ON ai_scheduling_settings (store_id)`
    ));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn(
      "[Migration] uq_ai_scheduling_settings_store_id creation failed (non-fatal):",
      pgErr?.message ?? err,
    );
  }

  // Backfill users.location_id from the existing locationName→work_locations.name match
  // Only updates rows where location_id is still NULL but location_name is set, so it is
  // safe and idempotent to run on every boot.
  try {
    await db.execute(sql.raw(`
      UPDATE users u
      SET location_id = wl.id
      FROM work_locations wl
      WHERE u.location_id IS NULL
        AND u.location_name IS NOT NULL
        AND u.location_name = wl.name
        AND wl.is_active = true
    `));
    console.log("[Migration] Backfilled users.location_id from location_name match");
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] users.location_id backfill failed (non-fatal):", pgErr?.message ?? err);
  }

  // Fuzzy-match fallback: catch users whose location_name is a substring of a work location name
  // (e.g., "Libby Story" → "Libby Story Ridgeland"). Runs only on rows still missing location_id
  // after the exact-match pass above.
  try {
    const fuzzyResult = await db.execute(sql.raw(`
      UPDATE users u
      SET location_id = wl.id,
          location_name = wl.name
      FROM work_locations wl
      WHERE u.location_id IS NULL
        AND u.location_name IS NOT NULL
        AND wl.is_active = true
        AND wl.name ILIKE '%' || u.location_name || '%'
    `));
    const fuzzyCount = (fuzzyResult as { rowCount?: number }).rowCount ?? 0;
    if (fuzzyCount > 0) {
      console.log(`[Migration] Fuzzy-matched location_id for ${fuzzyCount} user(s) with partial location_name`);
    }
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] users.location_id fuzzy backfill failed (non-fatal):", pgErr?.message ?? err);
  }

  // Backfill users.location_name from the linked work_locations.name.
  // Corrects any stale names on existing team profiles where the store was renamed
  // before the rename-sync fix (task #251) was deployed. Safe to run on every boot
  // because IS DISTINCT FROM ensures it only touches rows that are actually out of sync.
  try {
    const result = await db.execute(sql.raw(`
      UPDATE users u
      SET location_name = wl.name
      FROM work_locations wl
      WHERE u.location_id = wl.id
        AND u.location_name IS DISTINCT FROM wl.name
    `));
    const count = (result as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) {
      console.log(`[Migration] Backfilled location_name for ${count} user(s) whose store had been renamed`);
    }
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] users.location_name backfill failed (non-fatal):", pgErr?.message ?? err);
  }

  // Special step: ensure cash_management_settings.closing_time is text (not jsonb or varchar with special cast)
  // The column stores a JSON string representing { sunday: "HH:MM", ... }. Using text avoids auto-migration issues.
  try {
    const ctCheck = await db.execute(sql.raw(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'cash_management_settings' AND column_name = 'closing_time'
    `));
    const ctRows = ctCheck.rows as Array<{ data_type: string }>;
    if (ctRows.length > 0 && ctRows[0].data_type === "jsonb") {
      await db.execute(sql.raw(`
        ALTER TABLE cash_management_settings
          ALTER COLUMN closing_time TYPE text
          USING closing_time::text
      `));
      console.log("[Migration] Converted cash_management_settings.closing_time from jsonb to text");
    }
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] closing_time type normalization failed (non-fatal):", pgErr?.message ?? err);
  }

  // Special step: rename company_ai_context.key_processes → goals if the old column name exists
  // (from an early version of migration 0008 that used the wrong name)
  try {
    const checkResult = await db.execute(sql.raw(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'company_ai_context' AND column_name = 'key_processes'
    `));
    const rows = checkResult.rows as Array<{ column_name: string }>;
    if (rows.length > 0) {
      await db.execute(sql.raw(`ALTER TABLE company_ai_context RENAME COLUMN key_processes TO goals`));
      console.log("[Migration] Renamed company_ai_context.key_processes → goals");
    }
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] key_processes rename check failed (non-fatal):", pgErr?.message ?? err);
  }

  // Core and AI Content Studio table creation — idempotent CREATE TABLE IF NOT EXISTS
  const tableCreations: Array<{ name: string; ddl: string; indexes: string[] }> = [
    {
      name: "companies",
      ddl: `CREATE TABLE IF NOT EXISTS companies (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        slug varchar UNIQUE,
        domain varchar,
        plan varchar DEFAULT 'free',
        is_active boolean DEFAULT true,
        created_at timestamp DEFAULT now()
      )`,
      indexes: [],
    },
    {
      name: "knowledge_documents",
      ddl: `CREATE TABLE IF NOT EXISTS knowledge_documents (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL,
        uploaded_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL NOT NULL,
        original_file_name varchar NOT NULL,
        file_type varchar NOT NULL,
        raw_content text,
        extracted_text text,
        summary_from_claude text,
        document_type varchar DEFAULT 'other',
        auto_tags text[] DEFAULT '{}',
        processing_status varchar DEFAULT 'pending',
        error_message text,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_knowledge_docs_store_status ON knowledge_documents (store_id, processing_status)`,
        `CREATE INDEX IF NOT EXISTS idx_knowledge_docs_store_created ON knowledge_documents (store_id, created_at)`,
      ],
    },
    {
      name: "company_ai_context",
      ddl: `CREATE TABLE IF NOT EXISTS company_ai_context (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE,
        store_name varchar NOT NULL DEFAULT 'My Store',
        business_type varchar NOT NULL DEFAULT 'Fashion Boutique',
        brand_voice text,
        team_roles jsonb DEFAULT '["New Associate", "Lead", "Manager"]',
        goals jsonb DEFAULT '[]',
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_company_ai_context_store ON company_ai_context (store_id)`,
      ],
    },
    {
      name: "generation_jobs",
      ddl: `CREATE TABLE IF NOT EXISTS generation_jobs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE,
        status varchar NOT NULL DEFAULT 'pending',
        selected_document_ids jsonb DEFAULT '[]',
        output_types jsonb DEFAULT '[]',
        target_roles jsonb DEFAULT '[]',
        selected_categories jsonb DEFAULT '[]',
        results_json jsonb,
        progress_log jsonb DEFAULT '[]',
        created_by varchar REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs (status)`,
        `CREATE INDEX IF NOT EXISTS idx_generation_jobs_created_by ON generation_jobs (created_by)`,
        `CREATE INDEX IF NOT EXISTS idx_generation_jobs_store_id ON generation_jobs (store_id)`,
      ],
    },
    {
      name: "ai_generated_items",
      ddl: `CREATE TABLE IF NOT EXISTS ai_generated_items (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE,
        job_id varchar REFERENCES generation_jobs(id) ON DELETE SET NULL,
        type varchar NOT NULL,
        title varchar NOT NULL,
        content jsonb NOT NULL DEFAULT '{}',
        source_document_ids jsonb DEFAULT '[]',
        status varchar NOT NULL DEFAULT 'in_review',
        feedback_notes text,
        created_by varchar REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_ai_gen_items_store_type ON ai_generated_items (store_id, type)`,
        `CREATE INDEX IF NOT EXISTS idx_ai_gen_items_job ON ai_generated_items (job_id)`,
        `CREATE INDEX IF NOT EXISTS idx_ai_gen_items_status ON ai_generated_items (status)`,
      ],
    },
    {
      name: "ai_store_qa_sessions",
      ddl: `CREATE TABLE IF NOT EXISTS ai_store_qa_sessions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        title varchar NOT NULL DEFAULT 'Store Q&A',
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_ai_store_qa_sessions_user ON ai_store_qa_sessions (user_id)`,
      ],
    },
    {
      name: "ai_store_qa_messages",
      ddl: `CREATE TABLE IF NOT EXISTS ai_store_qa_messages (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id varchar REFERENCES ai_store_qa_sessions(id) ON DELETE CASCADE NOT NULL,
        role varchar NOT NULL,
        content text NOT NULL,
        source_document_ids jsonb DEFAULT '[]',
        created_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_ai_store_qa_messages_session ON ai_store_qa_messages (session_id)`,
      ],
    },
    // ── Operational Insights (Queryable Company AI Intelligence) ─────────────
    {
      name: "operational_insights",
      ddl: `CREATE TABLE IF NOT EXISTS operational_insights (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE NOT NULL,
        insight_type varchar NOT NULL,
        affected_area varchar NOT NULL,
        severity varchar NOT NULL DEFAULT 'info',
        observation text NOT NULL,
        why_it_matters text,
        recommended_action text NOT NULL,
        data_payload jsonb,
        status varchar NOT NULL DEFAULT 'active',
        dismissed_by varchar REFERENCES users(id) ON DELETE SET NULL,
        dismissed_at timestamptz,
        dismiss_reason text,
        acted_on_by varchar REFERENCES users(id) ON DELETE SET NULL,
        acted_on_at timestamptz,
        linked_task_id varchar REFERENCES tasks(id) ON DELETE SET NULL,
        expires_at timestamptz,
        generated_at timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_op_insights_store_status_sev ON operational_insights (store_id, status, severity, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_op_insights_store_type ON operational_insights (store_id, insight_type)`,
      ],
    },
    // ── Unified AI Learning Platform ─────────────────────────────────────────
    {
      name: "quiz_questions",
      ddl: `CREATE TABLE IF NOT EXISTS quiz_questions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE CASCADE,
        source_document_id varchar REFERENCES knowledge_documents(id) ON DELETE SET NULL,
        job_id varchar REFERENCES generation_jobs(id) ON DELETE SET NULL,
        topic_tag varchar NOT NULL,
        difficulty varchar NOT NULL DEFAULT 'medium',
        question_text text NOT NULL,
        answer_choices jsonb NOT NULL DEFAULT '[]',
        correct_answer_index integer NOT NULL,
        coaching_text text,
        is_active boolean NOT NULL DEFAULT true,
        wrong_answer_count integer NOT NULL DEFAULT 0,
        total_answer_count integer NOT NULL DEFAULT 0,
        created_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_quiz_questions_store ON quiz_questions (store_id)`,
        `CREATE INDEX IF NOT EXISTS idx_quiz_questions_topic ON quiz_questions (store_id, topic_tag)`,
      ],
    },
    {
      name: "user_quiz_progress",
      ddl: `CREATE TABLE IF NOT EXISTS user_quiz_progress (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL,
        current_rotation_topics jsonb DEFAULT '[]',
        covered_topics_this_rotation jsonb DEFAULT '[]',
        total_quizzes_completed integer NOT NULL DEFAULT 0,
        total_questions_answered integer NOT NULL DEFAULT 0,
        total_correct_answers integer NOT NULL DEFAULT 0,
        current_streak_days integer NOT NULL DEFAULT 0,
        longest_streak_days integer NOT NULL DEFAULT 0,
        last_quiz_date date,
        season_points integer NOT NULL DEFAULT 0,
        current_season varchar,
        all_topics_covered_count integer NOT NULL DEFAULT 0,
        pending_boss_battle boolean DEFAULT false,
        scenario_participation_count integer DEFAULT 0,
        scenario_last_awarded_date date,
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_quiz_progress ON user_quiz_progress (user_id)`,
        `CREATE INDEX IF NOT EXISTS idx_user_quiz_progress_store ON user_quiz_progress (store_id)`,
      ],
    },
    {
      name: "quiz_sessions",
      ddl: `CREATE TABLE IF NOT EXISTS quiz_sessions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar REFERENCES users(id) ON DELETE CASCADE NOT NULL,
        store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL,
        session_date date NOT NULL,
        topic_tag varchar NOT NULL,
        session_type varchar NOT NULL DEFAULT 'daily',
        question_ids jsonb NOT NULL DEFAULT '[]',
        status varchar NOT NULL DEFAULT 'in_progress',
        score integer,
        total_questions integer NOT NULL DEFAULT 0,
        correct_answers integer NOT NULL DEFAULT 0,
        streak_multiplier integer NOT NULL DEFAULT 1,
        base_points integer NOT NULL DEFAULT 0,
        total_points integer NOT NULL DEFAULT 0,
        completed_at timestamp,
        created_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_date ON quiz_sessions (user_id, session_date)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_session_user_date_type ON quiz_sessions (user_id, session_date, session_type)`,
      ],
    },
    {
      name: "quiz_answers",
      ddl: `CREATE TABLE IF NOT EXISTS quiz_answers (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id varchar REFERENCES quiz_sessions(id) ON DELETE CASCADE NOT NULL,
        question_id varchar REFERENCES quiz_questions(id) ON DELETE CASCADE NOT NULL,
        selected_index integer NOT NULL,
        is_correct boolean NOT NULL,
        answered_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_quiz_answers_session ON quiz_answers (session_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_answer_session_question ON quiz_answers (session_id, question_id)`,
      ],
    },
    // ── Shopify Integration ────────────────────────────────────────────────────
    {
      name: "shops",
      ddl: `CREATE TABLE IF NOT EXISTS shops (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_domain varchar NOT NULL UNIQUE,
        shop_name varchar,
        shop_email varchar,
        access_token varchar,
        scope varchar,
        currency varchar DEFAULT 'USD',
        timezone varchar,
        is_active boolean DEFAULT true,
        last_sync_at timestamp,
        installed_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        company_id varchar REFERENCES companies(id)
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_shops_company_id ON shops (company_id)`,
      ],
    },
    {
      name: "user_shops",
      ddl: `CREATE TABLE IF NOT EXISTS user_shops (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar REFERENCES users(id) NOT NULL,
        shop_domain varchar REFERENCES shops(shop_domain) NOT NULL,
        created_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_shops_unique ON user_shops (user_id, shop_domain)`,
      ],
    },
    {
      name: "shopify_daily_sales",
      ddl: `CREATE TABLE IF NOT EXISTS shopify_daily_sales (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_domain varchar NOT NULL,
        date timestamp NOT NULL,
        day_of_week integer,
        order_count integer DEFAULT 0,
        total_revenue decimal(12,2) DEFAULT 0.00,
        item_count integer DEFAULT 0,
        average_order_value decimal(10,2) DEFAULT 0.00,
        created_at timestamp DEFAULT now()
      )`,
      indexes: [],
    },
    {
      name: "shopify_orders",
      ddl: `CREATE TABLE IF NOT EXISTS shopify_orders (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_domain varchar NOT NULL,
        order_id varchar NOT NULL,
        order_number varchar,
        email varchar,
        total_price decimal(12,2),
        currency varchar,
        financial_status varchar,
        fulfillment_status varchar,
        line_items jsonb,
        customer_data jsonb,
        order_created_at timestamp,
        processed_at timestamp,
        synced_at timestamp DEFAULT now(),
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "IDX_shopify_orders_shop_date" ON shopify_orders (shop_domain, order_created_at)`,
        `CREATE INDEX IF NOT EXISTS "IDX_shopify_orders_order_id" ON shopify_orders (order_id)`,
      ],
    },
    {
      name: "shopify_report_schedules",
      ddl: `CREATE TABLE IF NOT EXISTS shopify_report_schedules (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        shop_domain varchar NOT NULL REFERENCES shops(shop_domain),
        frequency varchar NOT NULL DEFAULT 'weekly',
        recipient_email varchar NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        last_sent_at timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        UNIQUE(shop_domain)
      )`,
      indexes: [],
    },
    {
      name: "daily_questionnaires",
      ddl: `CREATE TABLE IF NOT EXISTS daily_questionnaires (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar NOT NULL REFERENCES work_locations(id),
        quiz_date date NOT NULL,
        topic varchar NOT NULL,
        questions jsonb NOT NULL,
        xp_reward integer DEFAULT 50,
        generated_by varchar REFERENCES users(id),
        created_at timestamp DEFAULT now(),
        UNIQUE(store_id, quiz_date)
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "IDX_daily_questionnaires_store" ON daily_questionnaires (store_id)`,
      ],
    },
    {
      name: "questionnaire_responses",
      ddl: `CREATE TABLE IF NOT EXISTS questionnaire_responses (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id),
        questionnaire_id varchar NOT NULL REFERENCES daily_questionnaires(id),
        answers jsonb NOT NULL,
        score integer NOT NULL,
        xp_earned integer NOT NULL,
        completed_at timestamp DEFAULT now(),
        duration_seconds integer,
        UNIQUE(user_id, questionnaire_id)
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "IDX_questionnaire_responses_user" ON questionnaire_responses (user_id)`,
        `CREATE INDEX IF NOT EXISTS "IDX_questionnaire_responses_questionnaire" ON questionnaire_responses (questionnaire_id)`,
      ],
    },
    {
      name: "user_badges",
      ddl: `CREATE TABLE IF NOT EXISTS user_badges (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id),
        store_id varchar NOT NULL REFERENCES work_locations(id),
        badge_type varchar NOT NULL,
        topic varchar,
        earned_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "IDX_user_badges_user" ON user_badges (user_id)`,
        `CREATE INDEX IF NOT EXISTS "IDX_user_badges_store" ON user_badges (store_id)`,
      ],
    },
    {
      name: "unanswered_questions",
      ddl: `CREATE TABLE IF NOT EXISTS unanswered_questions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar NOT NULL REFERENCES work_locations(id),
        asked_by_user_id varchar NOT NULL REFERENCES users(id),
        question text NOT NULL,
        ai_answer text,
        status varchar NOT NULL DEFAULT 'pending',
        answer text,
        answered_by_user_id varchar REFERENCES users(id),
        answered_at timestamp,
        conversation_id varchar REFERENCES ai_chat_conversations(id),
        asked_at timestamp DEFAULT now(),
        created_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "IDX_unanswered_questions_store" ON unanswered_questions (store_id)`,
        `CREATE INDEX IF NOT EXISTS "IDX_unanswered_questions_status" ON unanswered_questions (status)`,
        `CREATE INDEX IF NOT EXISTS "IDX_unanswered_questions_asked_by" ON unanswered_questions (asked_by_user_id)`,
      ],
    },
    {
      name: "native_push_tokens",
      ddl: `CREATE TABLE IF NOT EXISTS native_push_tokens (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id),
        token text NOT NULL,
        platform varchar(10) NOT NULL,
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "IDX_native_push_tokens_user" ON native_push_tokens (user_id)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_native_push_tokens_token" ON native_push_tokens (token)`,
      ],
    },
    {
      name: "push_credentials",
      ddl: `CREATE TABLE IF NOT EXISTS push_credentials (
        key varchar PRIMARY KEY,
        value text NOT NULL,
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [],
    },
    {
      name: "notification_delivery_logs",
      ddl: `CREATE TABLE IF NOT EXISTS notification_delivery_logs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id),
        notification_type varchar(64) NOT NULL,
        channel varchar(16) NOT NULL,
        status varchar(16) NOT NULL,
        error_message text,
        sent_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "idx_notif_delivery_logs_sent_at" ON notification_delivery_logs (sent_at)`,
      ],
    },
    // Task #457 — Entitlement read module
    // Read-side cache written exclusively by the Stripe webhook handler.
    // One row per (store_id, feature_key). When no rows exist for a store the
    // entitlement module defaults to full access (trial / pre-subscription state).
    {
      name: "store_entitlements",
      ddl: `CREATE TABLE IF NOT EXISTS store_entitlements (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar NOT NULL REFERENCES work_locations(id) ON DELETE CASCADE,
        feature_key varchar(100) NOT NULL,
        granted_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE UNIQUE INDEX IF NOT EXISTS "uq_store_entitlements_store_key" ON store_entitlements (store_id, feature_key)`,
        `CREATE INDEX IF NOT EXISTS "idx_store_entitlements_store_id" ON store_entitlements (store_id)`,
      ],
    },
    // Task #496 — Two-step timesheet period approval chain
    {
      name: "timesheet_period_approvals",
      ddl: `CREATE TABLE IF NOT EXISTS timesheet_period_approvals (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar NOT NULL REFERENCES work_locations(id) ON DELETE CASCADE,
        period_start varchar NOT NULL,
        period_end varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'pending',
        manager_approved_by varchar REFERENCES users(id) ON DELETE SET NULL,
        manager_approved_at timestamp,
        admin_approved_by varchar REFERENCES users(id) ON DELETE SET NULL,
        admin_approved_at timestamp,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS idx_timesheet_period_approvals_store_period ON timesheet_period_approvals (store_id, period_start, period_end)`,
      ],
    },
    // Task #256 — Shopify POS register data
    {
      name: "shopify_register_sessions",
      ddl: `CREATE TABLE IF NOT EXISTS shopify_register_sessions (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id text NOT NULL,
        session_date text NOT NULL,
        register_name text NOT NULL,
        shopify_session_id text NOT NULL,
        status text,
        opened_at timestamptz,
        closed_at timestamptz,
        opening_float decimal(10,2),
        expected_closing_cash decimal(10,2),
        reported_closing_cash decimal(10,2),
        cash_sales decimal(10,2),
        cash_refunds decimal(10,2),
        cash_adjustments decimal(10,2),
        total_sales decimal(10,2),
        tender_breakdown jsonb,
        cash_movements jsonb,
        raw_payload jsonb,
        synced_at timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now()
      )`,
      indexes: [
        `CREATE INDEX IF NOT EXISTS "idx_shopify_register_sessions_store_date" ON shopify_register_sessions (store_id, session_date)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_shopify_register_sessions_shopify_id" ON shopify_register_sessions (shopify_session_id)`,
      ],
    },
  ];

  for (const { name, ddl, indexes } of tableCreations) {
    try {
      await db.execute(sql.raw(ddl));
      for (const idxSql of indexes) {
        try {
          await db.execute(sql.raw(idxSql));
        } catch {
          // Index may already exist
        }
      }
    } catch (err: unknown) {
      const pgErr = err as { message?: string };
      console.warn(`[Migration] Failed to create '${name}':`, pgErr?.message ?? err);
    }
  }

  // Migrate native_push_tokens to support multiple devices per user:
  // Drop the old (user_id, token) unique constraint and replace with a token-only
  // unique index so each push token globally identifies exactly one device.
  try {
    await db.execute(sql.raw(
      `ALTER TABLE native_push_tokens DROP CONSTRAINT IF EXISTS uq_native_push_tokens_user_token`
    ));
    // Remove duplicate tokens deterministically: keep the most-recently-updated
    // row per token; break ties by id so every duplicate is removed even when
    // updated_at is identical or NULL.
    await db.execute(sql.raw(`
      DELETE FROM native_push_tokens
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY token
                   ORDER BY updated_at DESC NULLS LAST, id DESC
                 ) AS rn
          FROM native_push_tokens
        ) ranked
        WHERE rn > 1
      )
    `));
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_native_push_tokens_token" ON native_push_tokens (token)`
    ));
    console.log('[Migration] native_push_tokens: migrated to per-token unique index');
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.error(
      '[Migration] IMPORTANT: native_push_tokens token-unique migration failed. ' +
      'The uq_native_push_tokens_token unique index may be missing. ' +
      'Native push token upserts may fail until this is resolved. Error:',
      pgErr?.message ?? err
    );
  }

  // Backfill store_id for singleton tables: assign to the first active store
  try {
    const [firstStore] = await db
      .select({ id: workLocations.id })
      .from(workLocations)
      .where(eq(workLocations.isActive, true))
      .limit(1);

    if (firstStore) {
      const storeId = firstStore.id;
      const backfills: Array<{ table: string; condition: string }> = [
        { table: "company_settings", condition: "store_id IS NULL" },
        { table: "sop_categories", condition: "store_id IS NULL" },
        { table: "training_modules", condition: "store_id IS NULL" },
        { table: "company_ai_context", condition: "store_id IS NULL" },
        { table: "generation_jobs", condition: "store_id IS NULL" },
      ];

      for (const { table, condition } of backfills) {
        try {
          await db.execute(sql.raw(`UPDATE ${table} SET store_id = '${storeId}' WHERE ${condition}`));
        } catch {
          // Table may not exist yet — skip silently
        }
      }
      console.log(`[Migration] Backfilled singleton store_id → storeId=${storeId}`);
    } else {
      console.log(`[Migration] No active store found — skipping singleton store_id backfill`);
    }
  } catch (err) {
    console.warn("[Migration] Backfill step failed (non-fatal):", err);
  }

  // Normalize gamification_settings to 5-pillar model (attendance/tasks/sops/engagement/learning)
  // Existing rows with 4-pillar weights (no "learning" key) are updated to include learning=20
  // and all other weights are scaled so the total remains 100.
  try {
    const gsRows = await db.execute(sql.raw(`SELECT id, category_weights FROM gamification_settings LIMIT 10`));
    const gsData = (gsRows as any).rows ?? [];
    for (const row of gsData) {
      let weights: Record<string, number> = {};
      try { weights = typeof row.category_weights === 'string' ? JSON.parse(row.category_weights) : (row.category_weights ?? {}); } catch { continue; }
      if ('learning' in weights) continue; // Already migrated
      // Scale existing 4 pillars to 80% of total, add learning=20
      const total4 = (weights.attendance ?? 0) + (weights.tasks ?? 0) + (weights.sops ?? 0) + (weights.engagement ?? 0);
      const factor = total4 > 0 ? 80 / total4 : 1;
      weights.attendance = Math.round((weights.attendance ?? 0) * factor);
      weights.tasks = Math.round((weights.tasks ?? 0) * factor);
      weights.sops = Math.round((weights.sops ?? 0) * factor);
      weights.engagement = 80 - weights.attendance - weights.tasks - weights.sops; // Ensure sum=80
      weights.learning = 20;
      await db.execute(sql.raw(`UPDATE gamification_settings SET category_weights = '${JSON.stringify(weights)}' WHERE id = ${row.id}`));
      console.log(`[Migration] Normalized gamification_settings id=${row.id} to 5-pillar weights: ${JSON.stringify(weights)}`);
    }
  } catch {
    // Non-fatal — table may not exist yet on first boot
  }

  console.log(`[Migration] Schema migrations complete (${altered} column alteration(s))`);

  // Seed default roles and permissions on every boot (idempotent).
  await seedDefaultRoles();

  // Create location_permissions table if it doesn't exist (persists employee location
  // permission status across server restarts for the manager Today dashboard).
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS location_permissions (
        user_id varchar PRIMARY KEY REFERENCES users(id),
        status varchar(20) NOT NULL,
        reported_at timestamp NOT NULL DEFAULT now()
      )
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[Migration] location_permissions table creation failed (non-fatal):', pgErr?.message ?? err);
  }

  // Create user_permission_overrides table — allows per-user sales access overrides
  // independent of role assignments.
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS user_permission_overrides (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id),
        permission_name varchar NOT NULL,
        "grant" boolean NOT NULL,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now()
      )
    `));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_permission_overrides_unique
      ON user_permission_overrides (user_id, permission_name)
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[Migration] user_permission_overrides table creation failed (non-fatal):', pgErr?.message ?? err);
  }

  // Now that user_permission_overrides exists, consolidate the legacy
  // 'sales.view' permission into the canonical 'sales.view_all'.
  await consolidateLegacySalesPermission();

  // Recurring weekly availability templates — one row per user
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS availability_templates (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slots jsonb NOT NULL,
        updated_at timestamp DEFAULT now(),
        CONSTRAINT availability_templates_user_id_unique UNIQUE (user_id)
      )
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[Migration] availability_templates table creation failed (non-fatal):', pgErr?.message ?? err);
  }

  // Timesheet workflow settings table (Task #496)
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS timesheet_workflow_settings (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL,
        manager_reminder_days_after_period integer DEFAULT 2,
        manager_escalation_days_after_reminder integer DEFAULT 3,
        notify_admin_on_manager_approval boolean DEFAULT true,
        employee_self_review_reminder boolean DEFAULT false,
        single_step_approval boolean DEFAULT false,
        email_reminders_enabled boolean DEFAULT false,
        reminder_from_email varchar,
        manager_user_ids jsonb DEFAULT '[]'::jsonb,
        admin_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        updated_by varchar REFERENCES users(id) ON DELETE SET NULL,
        updated_at timestamp DEFAULT now()
      )
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[Migration] timesheet_workflow_settings table creation failed (non-fatal):', pgErr?.message ?? err);
  }

  // Timesheet reminder log table (Task #496)
  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS timesheet_reminder_log (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        store_id varchar REFERENCES work_locations(id) ON DELETE SET NULL,
        period_start varchar NOT NULL,
        period_end varchar NOT NULL,
        reminder_type varchar NOT NULL,
        user_id varchar REFERENCES users(id) ON DELETE SET NULL,
        sent_at timestamp DEFAULT now(),
        was_acted_on boolean DEFAULT false,
        acted_on_at timestamp
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_timesheet_reminder_log_period ON timesheet_reminder_log(period_start, period_end)
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[Migration] timesheet_reminder_log table creation failed (non-fatal):', pgErr?.message ?? err);
  }

  // Mark any generation jobs that were still "running" when the server last shut down.
  // These are orphaned — the setImmediate background task was lost on restart — so
  // they will never complete. Reset them to "failed" so users can retry.
  try {
    const orphanResult = await db.execute(
      sql.raw(`UPDATE generation_jobs SET status = 'failed', updated_at = NOW(), progress_log = (
        SELECT to_jsonb(array_agg(elem)) FROM (
          SELECT jsonb_array_elements_text(progress_log) AS elem
          UNION ALL
          SELECT 'Server restarted during generation — please click Generate again to retry.'
        ) t
      ) WHERE status = 'running'`)
    );
    const affected = (orphanResult as any).rowCount ?? 0;
    if (affected > 0) {
      console.log(`[Migration] Cleaned up ${affected} orphaned generation job(s) → marked as failed`);
    }
  } catch {
    // Non-fatal — table may not exist yet on first boot
  }
}

/**
 * Seeds the default roles (owner, admin, manager, employee) and their permission sets.
 * Fully idempotent — safe to call on every boot.  Exported so it can also be called
 * during first-time store setup to guarantee roles exist before assigning.
 */
export async function seedDefaultRoles(): Promise<void> {
  try {
    // --- 1. Seed all core permissions ---
    const permissionDefs = [
      { name: 'admin.manage_all',           displayName: 'Full Admin Access',          description: 'Superuser access to all features',                    category: 'admin' },
      { name: 'admin.system_settings',      displayName: 'System Settings',            description: 'Manage system settings',                              category: 'admin' },
      { name: 'admin.role_management',      displayName: 'Role Management',            description: 'Manage roles and permissions',                         category: 'admin' },
      { name: 'admin.location_management',  displayName: 'Location Management',        description: 'Manage work locations',                               category: 'admin' },
      { name: 'hr.view_team',               displayName: 'View Team',                  description: 'View team member profiles',                            category: 'hr' },
      { name: 'hr.edit_team',               displayName: 'Edit Team',                  description: 'Edit team member profiles',                            category: 'hr' },
      { name: 'hr.insights',                displayName: 'HR Insights',                description: 'View AI insights and analytics',                       category: 'hr' },
      { name: 'hr.payroll_view',            displayName: 'View Payroll',               description: 'View payroll information',                             category: 'hr' },
      { name: 'hr.payroll_process',         displayName: 'Process Payroll',            description: 'Process and manage payroll',                           category: 'hr' },
      { name: 'hr.edit_pay_rates',          displayName: 'Edit Pay Rates',             description: 'Edit hourly rates for team members',                   category: 'hr' },
      { name: 'schedule.view_own',          displayName: 'View Own Schedule',          description: 'View own schedule',                                   category: 'schedule' },
      { name: 'schedule.view_all',          displayName: 'View All Schedules',         description: 'View all team schedules',                             category: 'schedule' },
      { name: 'schedule.edit_own',          displayName: 'Edit Own Schedule',          description: 'Edit own schedule',                                   category: 'schedule' },
      { name: 'schedule.edit_all',          displayName: 'Edit All Schedules',         description: 'Edit any schedules',                                  category: 'schedule' },
      { name: 'schedule.create',            displayName: 'Create Schedules',           description: 'Create schedules for team',                           category: 'schedule' },
      { name: 'time.view_own',              displayName: 'View Own Time',              description: 'View own time entries',                               category: 'time' },
      { name: 'time.view_all',              displayName: 'View All Time',              description: 'View all time entries',                               category: 'time' },
      { name: 'time.edit_own',              displayName: 'Edit Own Time',              description: 'Edit own time entries',                               category: 'time' },
      { name: 'time.edit_all',              displayName: 'Edit All Time',              description: 'Edit any time entries',                               category: 'time' },
      { name: 'time.clock_in_out',          displayName: 'Clock In/Out',               description: 'Clock in and out',                                    category: 'time' },
      { name: 'time.approve',               displayName: 'Approve Time',               description: 'Approve time entries',                                category: 'time' },
      { name: 'tasks.view_own',             displayName: 'View Own Tasks',             description: 'View own tasks',                                      category: 'tasks' },
      { name: 'tasks.view_all',             displayName: 'View All Tasks',             description: 'View all tasks',                                      category: 'tasks' },
      { name: 'tasks.edit_own',             displayName: 'Edit Own Tasks',             description: 'Edit own tasks',                                      category: 'tasks' },
      { name: 'tasks.edit_all',             displayName: 'Edit All Tasks',             description: 'Edit any tasks',                                      category: 'tasks' },
      { name: 'tasks.create',               displayName: 'Create Tasks',               description: 'Create new tasks',                                    category: 'tasks' },
      { name: 'tasks.ai_assign',            displayName: 'AI Task Assignment',         description: 'Use AI to assign tasks',                              category: 'tasks' },
      { name: 'comm.view_messages',         displayName: 'View Messages',              description: 'View team messages',                                  category: 'communication' },
      { name: 'comm.send_messages',         displayName: 'Send Messages',              description: 'Send messages to team',                               category: 'communication' },
      { name: 'comm.send_announcements',    displayName: 'Send Announcements',         description: 'Send announcements to all',                           category: 'communication' },
      { name: 'communication.create_groups',displayName: 'Create Groups',              description: 'Create new chat groups and invite members',            category: 'communication' },
      { name: 'communication.manage_groups',displayName: 'Manage Groups',              description: 'Add/remove members from chat groups',                 category: 'communication' },
      { name: 'enable_clock_out_on_focus_loss', displayName: 'Enable clock-out on focus loss', description: 'Allow this role to be subject to automatic clock-out when the app loses focus', category: 'time_tracking' },
      { name: 'sales.view_own',             displayName: 'View Own Sales',             description: 'View own sales totals and commission data',            category: 'sales' },
      { name: 'sales.view_all',             displayName: 'View All Sales',             description: 'View sales data for all Employees',                   category: 'sales' },
      { name: 'sales.view_reports',         displayName: 'View Sales Reports',         description: 'Access full sales reports and analytics dashboards',   category: 'sales' },
    ];

    for (const perm of permissionDefs) {
      await db.execute(sql.raw(`
        INSERT INTO permissions (id, name, display_name, description, category)
        VALUES (gen_random_uuid(), '${perm.name}', '${perm.displayName.replace(/'/g, "''")}', '${perm.description.replace(/'/g, "''")}', '${perm.category}')
        ON CONFLICT (name) DO NOTHING
      `));
    }

    // --- 2. Seed default roles ---
    const roleDefs = [
      { name: 'owner',    displayName: 'Owner',    description: 'Full access to all features', isSystemRole: true },
      { name: 'admin',    displayName: 'Admin',    description: 'Administrative access',        isSystemRole: true },
      { name: 'manager',  displayName: 'Manager',  description: 'Team management access',       isSystemRole: true },
      { name: 'employee', displayName: 'Employee', description: 'Standard employee access',     isSystemRole: true },
    ];

    for (const role of roleDefs) {
      await db.execute(sql.raw(`
        INSERT INTO roles (id, name, display_name, description, is_system_role, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), '${role.name}', '${role.displayName}', '${role.description}', ${role.isSystemRole}, true, NOW(), NOW())
        ON CONFLICT (name) DO NOTHING
      `));
    }

    // --- 3. Assign permissions to roles ---
    const ownerPerms = permissionDefs.map(p => p.name);
    const adminPerms = [
      'admin.manage_all', 'admin.system_settings', 'admin.role_management', 'admin.location_management',
      'hr.view_team', 'hr.edit_team', 'hr.insights', 'hr.payroll_view', 'hr.payroll_process', 'hr.edit_pay_rates',
      'schedule.view_all', 'schedule.edit_all', 'schedule.create',
      'time.view_all', 'time.edit_all', 'time.approve', 'time.clock_in_out',
      'tasks.view_all', 'tasks.edit_all', 'tasks.create', 'tasks.ai_assign',
      'comm.view_messages', 'comm.send_messages', 'comm.send_announcements',
      'communication.create_groups', 'communication.manage_groups',
      'sales.view_all', 'sales.view_reports',
      'enable_clock_out_on_focus_loss',
    ];
    const managerPerms = [
      'hr.view_team', 'hr.edit_team', 'hr.edit_pay_rates',
      'schedule.view_all', 'schedule.edit_all', 'schedule.edit_own', 'schedule.create', 'schedule.view_own',
      'time.view_all', 'time.edit_all', 'time.view_own', 'time.edit_own', 'time.clock_in_out', 'time.approve',
      'tasks.view_all', 'tasks.edit_all', 'tasks.view_own', 'tasks.edit_own', 'tasks.create', 'tasks.ai_assign',
      'comm.view_messages', 'comm.send_messages', 'comm.send_announcements',
      'communication.create_groups', 'communication.manage_groups',
      'sales.view_all', 'sales.view_reports', 'sales.view_own',
    ];
    const employeePerms = [
      'schedule.view_own', 'schedule.edit_own',
      'time.view_own', 'time.edit_own', 'time.clock_in_out',
      'tasks.view_own', 'tasks.edit_own',
      'comm.view_messages', 'comm.send_messages',
      'sales.view_own',
    ];

    const rolePermMap: Record<string, string[]> = {
      owner: ownerPerms,
      admin: adminPerms,
      manager: managerPerms,
      employee: employeePerms,
    };

    for (const [roleName, perms] of Object.entries(rolePermMap)) {
      const roleRows = await db.execute(sql.raw(`SELECT id FROM roles WHERE name = '${roleName}' LIMIT 1`));
      const roleId = ((roleRows as any).rows ?? [])[0]?.id as string | undefined;
      if (!roleId) continue;

      for (const permName of perms) {
        const permRows = await db.execute(sql.raw(`SELECT id FROM permissions WHERE name = '${permName}' LIMIT 1`));
        const permId = ((permRows as any).rows ?? [])[0]?.id as string | undefined;
        if (!permId) continue;

        await db.execute(sql.raw(`
          INSERT INTO role_permissions (id, role_id, permission_id)
          SELECT gen_random_uuid(), '${roleId}', '${permId}'
          WHERE NOT EXISTS (
            SELECT 1 FROM role_permissions WHERE role_id = '${roleId}' AND permission_id = '${permId}'
          )
        `));
      }
    }

    console.log('[Migration] Default roles and permissions seeded successfully');
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[Migration] Default role seeding failed (non-fatal):', pgErr?.message ?? err);
  }
}

/**
 * Consolidates the legacy 'sales.view' permission into the canonical
 * 'sales.view_all'. Runs idempotently on every boot. Mapping:
 *   'sales.view' (legacy) -> 'sales.view_all' (canonical).
 *
 * MUST be called AFTER the user_permission_overrides table has been created,
 * otherwise the first statement throws and the cleanup is skipped for that
 * boot. Each statement is a no-op once the legacy data has been removed.
 */
export async function consolidateLegacySalesPermission(): Promise<void> {
  try {
    // (a) Migrate user-level overrides where the user has no canonical override yet.
    await db.execute(sql.raw(`
      UPDATE user_permission_overrides upo
      SET permission_name = 'sales.view_all'
      WHERE permission_name = 'sales.view'
        AND NOT EXISTS (
          SELECT 1 FROM user_permission_overrides u2
          WHERE u2.user_id = upo.user_id
            AND u2.permission_name = 'sales.view_all'
        )
    `));
    // (b) Drop any leftover legacy override rows (these are duplicates because
    // the user already had the canonical 'sales.view_all' override; the explicit
    // canonical row wins).
    await db.execute(sql.raw(`
      DELETE FROM user_permission_overrides WHERE permission_name = 'sales.view'
    `));
    // (c) Drop role_permissions rows linking to the legacy permission.
    await db.execute(sql.raw(`
      DELETE FROM role_permissions
      WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'sales.view')
    `));
    // (d) Drop the legacy permission row itself.
    await db.execute(sql.raw(`
      DELETE FROM permissions WHERE name = 'sales.view'
    `));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[Migration] sales.view consolidation failed (non-fatal):', pgErr?.message ?? err);
  }
}

/**
 * Registers a nightly job that deletes native_push_tokens rows whose updated_at
 * is older than STALE_TOKEN_DAYS (default 90 days). The job runs once immediately
 * on boot and then every 24 hours thereafter so stale rows are cleaned up even
 * when no delivery failures occur.
 */
const _parsedDays = parseInt(process.env.STALE_TOKEN_DAYS || '90', 10);
const STALE_TOKEN_DAYS = Number.isFinite(_parsedDays) && _parsedDays > 0 ? _parsedDays : 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function runStaleTokenCleanup(): Promise<void> {
  try {
    const deleted = await storage.deleteStaleNativePushTokens(STALE_TOKEN_DAYS);
    if (deleted > 0) {
      console.log(`[TokenCleanup] Deleted ${deleted} stale native push token(s) (threshold: ${STALE_TOKEN_DAYS} days)`);
    }
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[TokenCleanup] Stale token cleanup failed (non-fatal):', pgErr?.message ?? err);
  }
}

export function scheduleStaleTokenCleanup(): void {
  runStaleTokenCleanup();
  setInterval(runStaleTokenCleanup, CLEANUP_INTERVAL_MS);
}

/**
 * Registers a nightly job that deletes notification_delivery_logs rows whose sent_at
 * is older than DELIVERY_LOG_RETENTION_DAYS (default 30 days). Runs once on boot
 * and then every 24 hours so the log table stays lean and fast.
 */
const _parsedLogDays = parseInt(process.env.DELIVERY_LOG_RETENTION_DAYS || '30', 10);
const DELIVERY_LOG_RETENTION_DAYS = Number.isFinite(_parsedLogDays) && _parsedLogDays > 0 ? _parsedLogDays : 30;

async function runDeliveryLogCleanup(): Promise<void> {
  try {
    const deleted = await storage.deleteOldNotificationDeliveryLogs(DELIVERY_LOG_RETENTION_DAYS);
    if (deleted > 0) {
      console.log(`[DeliveryLogCleanup] Deleted ${deleted} old delivery log entry(ies) (threshold: ${DELIVERY_LOG_RETENTION_DAYS} days)`);
    }
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn('[DeliveryLogCleanup] Delivery log cleanup failed (non-fatal):', pgErr?.message ?? err);
  }
}

export function scheduleDeliveryLogCleanup(): void {
  runDeliveryLogCleanup();
  setInterval(runDeliveryLogCleanup, CLEANUP_INTERVAL_MS);
}
