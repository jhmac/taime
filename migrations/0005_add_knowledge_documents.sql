-- Create enum types for the knowledge base system
DO $$ BEGIN
  CREATE TYPE "knowledge_document_type" AS ENUM (
    'policy_manual',
    'sales_script',
    'sales_training',
    'style_guide',
    'operations_reference',
    'other'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "knowledge_processing_status" AS ENUM (
    'pending',
    'processing',
    'ready',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create knowledge_documents table for the AI Learning Center
CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id" varchar NOT NULL REFERENCES "work_locations"("id") ON DELETE CASCADE,
  "uploaded_by_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "original_file_name" text NOT NULL,
  "file_type" varchar(50) NOT NULL,
  "raw_content" text NOT NULL DEFAULT '',
  "extracted_text" text,
  "summary_from_claude" text,
  "document_type" "knowledge_document_type" NOT NULL DEFAULT 'other',
  "auto_tags" text[] NOT NULL DEFAULT '{}',
  "processing_status" "knowledge_processing_status" NOT NULL DEFAULT 'pending',
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Index for fast per-store queries (the primary tenant isolation axis)
CREATE INDEX IF NOT EXISTS "idx_knowledge_docs_store_id" ON "knowledge_documents" ("store_id");

-- Index for per-user queries (ownership lookups)
CREATE INDEX IF NOT EXISTS "idx_knowledge_docs_uploader" ON "knowledge_documents" ("uploaded_by_user_id");

-- Index for status filtering (polling for pending/processing documents)
CREATE INDEX IF NOT EXISTS "idx_knowledge_docs_status" ON "knowledge_documents" ("store_id", "processing_status");
