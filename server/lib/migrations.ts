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
    // users.location_id: proper FK to work_locations replacing fragile name-based matching
    {
      table: "users",
      sql: `ALTER TABLE users ADD COLUMN IF NOT EXISTS location_id varchar REFERENCES work_locations(id) ON DELETE SET NULL`,
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

  // Index on users.location_id for fast store-scoped queries
  try {
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS idx_users_location_id ON users (location_id)`));
  } catch (err: unknown) {
    const pgErr = err as { message?: string };
    console.warn("[Migration] idx_users_location_id creation failed (non-fatal):", pgErr?.message ?? err);
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
      { name: 'sales.view_all',             displayName: 'View All Sales',             description: 'View sales data for all team members',                category: 'sales' },
      { name: 'sales.view_reports',         displayName: 'View Sales Reports',         description: 'Access full sales reports and analytics dashboards',   category: 'sales' },
      { name: 'sales.view',                 displayName: 'View Sales Data',            description: 'Access sales analytics, Shopify data, and revenue dashboards', category: 'sales' },
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
      'sales.view_all', 'sales.view_reports', 'sales.view',
      'enable_clock_out_on_focus_loss',
    ];
    const managerPerms = [
      'hr.view_team', 'hr.edit_team', 'hr.edit_pay_rates',
      'schedule.view_all', 'schedule.edit_all', 'schedule.edit_own', 'schedule.create', 'schedule.view_own',
      'time.view_all', 'time.edit_all', 'time.view_own', 'time.edit_own', 'time.clock_in_out', 'time.approve',
      'tasks.view_all', 'tasks.edit_all', 'tasks.view_own', 'tasks.edit_own', 'tasks.create', 'tasks.ai_assign',
      'comm.view_messages', 'comm.send_messages', 'comm.send_announcements',
      'communication.create_groups', 'communication.manage_groups',
      'sales.view_all', 'sales.view_reports', 'sales.view_own', 'sales.view',
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
