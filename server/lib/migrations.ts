import { db } from "../db";
import { sql } from "drizzle-orm";
import { workLocations } from "@shared/schema";
import { eq } from "drizzle-orm";

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

  // AI Content Studio table creation — all columns must match shared/schema.ts definitions
  const tableCreations: Array<{ name: string; ddl: string; indexes: string[] }> = [
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

  console.log(`[Migration] Schema migrations complete (${altered} column alteration(s))`);
}
