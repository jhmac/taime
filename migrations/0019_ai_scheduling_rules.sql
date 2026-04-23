-- Add scheduling classifications to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS scheduling_classifications jsonb DEFAULT '[]'::jsonb;

-- Add custom AI instructions column to ai_scheduling_settings (schema history).
-- Note: at runtime, per-store custom instructions are stored as a ruleType='custom_instructions'
-- singleton row in ai_scheduling_rules (store-scoped), not read from this column.
ALTER TABLE ai_scheduling_settings ADD COLUMN IF NOT EXISTS custom_ai_instructions text;

-- Create AI scheduling rules table (store_id included in CREATE to avoid redundant ALTER)
CREATE TABLE IF NOT EXISTS ai_scheduling_rules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id varchar,
  rule_type varchar NOT NULL,
  params jsonb DEFAULT '{}'::jsonb,
  is_enabled boolean DEFAULT true,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
