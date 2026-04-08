-- AI Content Studio: source documents library and generated content review workflow
-- All table definitions must match shared/schema.ts exactly.

-- Enum for knowledge document type (matches knowledgeDocumentTypeEnum in schema.ts)
DO $$ BEGIN
  CREATE TYPE knowledge_document_type AS ENUM (
    'policy_manual', 'sales_script', 'sales_training',
    'style_guide', 'operations_reference', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enum for knowledge processing status (matches knowledgeProcessingStatusEnum in schema.ts)
DO $$ BEGIN
  CREATE TYPE knowledge_processing_status AS ENUM (
    'pending', 'processing', 'ready', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Source column on sop_documents to track AI-generated SOPs
ALTER TABLE sop_documents ADD COLUMN IF NOT EXISTS source varchar DEFAULT 'manual';

-- Knowledge documents: source files uploaded by managers for AI generation
-- Columns match shared/schema.ts knowledgeDocuments exactly
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar REFERENCES work_locations(id),
  uploaded_by_user_id varchar REFERENCES users(id) NOT NULL,
  original_file_name varchar NOT NULL,
  file_type varchar NOT NULL,
  raw_content text,
  extracted_text text,
  summary_from_claude text,
  document_type knowledge_document_type DEFAULT 'other',
  auto_tags text[] DEFAULT '{}',
  processing_status knowledge_processing_status DEFAULT 'pending',
  error_message text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_store_status ON knowledge_documents (store_id, processing_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_store_created ON knowledge_documents (store_id, created_at);

-- Backfill: if table was created with old schema (processed_content column), add missing columns
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS extracted_text text;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS summary_from_claude text;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS auto_tags text[] DEFAULT '{}';

-- Company AI context: store-level branding/voice settings for generation
-- Columns match shared/schema.ts companyAiContext exactly
CREATE TABLE IF NOT EXISTS company_ai_context (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar REFERENCES work_locations(id),
  store_name varchar NOT NULL DEFAULT 'My Store',
  business_type varchar NOT NULL DEFAULT 'Fashion Boutique',
  brand_voice text,
  team_roles jsonb DEFAULT '["New Associate", "Lead", "Manager"]',
  goals jsonb DEFAULT '[]',
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_ai_context_store ON company_ai_context (store_id);

-- Backfill: rename key_processes to goals if old column name exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_ai_context' AND column_name = 'key_processes'
  ) THEN
    ALTER TABLE company_ai_context RENAME COLUMN key_processes TO goals;
  END IF;
END $$;
ALTER TABLE company_ai_context ADD COLUMN IF NOT EXISTS goals jsonb DEFAULT '[]';

-- Generation jobs: tracks async Claude generation runs
-- Columns match shared/schema.ts generationJobs exactly (includes results_json)
CREATE TABLE IF NOT EXISTS generation_jobs (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar REFERENCES work_locations(id),
  status varchar NOT NULL DEFAULT 'pending',
  selected_document_ids jsonb DEFAULT '[]',
  output_types jsonb DEFAULT '[]',
  target_roles jsonb DEFAULT '[]',
  selected_categories jsonb DEFAULT '[]',
  results_json jsonb,
  progress_log jsonb DEFAULT '[]',
  created_by varchar REFERENCES users(id),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
-- Backfill: add results_json if table was created without it
ALTER TABLE generation_jobs ADD COLUMN IF NOT EXISTS results_json jsonb;
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs (status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_created_by ON generation_jobs (created_by);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_store_id ON generation_jobs (store_id);

-- AI generated items: output of Claude generation, waiting for review/publish
-- Columns match shared/schema.ts aiGeneratedItems exactly
CREATE TABLE IF NOT EXISTS ai_generated_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar REFERENCES work_locations(id),
  job_id varchar REFERENCES generation_jobs(id),
  type varchar NOT NULL,
  title varchar NOT NULL,
  content jsonb NOT NULL DEFAULT '{}',
  source_document_ids jsonb DEFAULT '[]',
  status varchar NOT NULL DEFAULT 'in_review',
  feedback_notes text,
  created_by varchar REFERENCES users(id),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_gen_items_store_type ON ai_generated_items (store_id, type);
CREATE INDEX IF NOT EXISTS idx_ai_gen_items_job ON ai_generated_items (job_id);
CREATE INDEX IF NOT EXISTS idx_ai_gen_items_status ON ai_generated_items (status);
