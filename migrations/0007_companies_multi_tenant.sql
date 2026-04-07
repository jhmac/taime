-- Multi-tenant foundation: companies table as the root tenant entity
-- Every user and every Shopify shop belongs to exactly one company.
CREATE TABLE IF NOT EXISTS companies (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL DEFAULT 'My Company',
  created_at timestamp DEFAULT now()
);

-- Add company_id to users (tenant membership)
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id varchar REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users (company_id);

-- Add company_id to shops (tenant ownership)
ALTER TABLE shops ADD COLUMN IF NOT EXISTS company_id varchar REFERENCES companies(id);
CREATE INDEX IF NOT EXISTS idx_shops_company_id ON shops (company_id);

-- Unique constraint on user_shops to prevent duplicate links under concurrent requests
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_shops_unique ON user_shops (user_id, shop_domain);

-- Seed default company from existing company_settings name (idempotent)
INSERT INTO companies (name)
SELECT COALESCE(company_name, 'My Company')
FROM company_settings
WHERE NOT EXISTS (SELECT 1 FROM companies)
LIMIT 1;

-- Backfill existing users to the default company (covers pre-migration rows)
UPDATE users SET company_id = (SELECT id FROM companies LIMIT 1)
WHERE company_id IS NULL;

-- Backfill existing shops to the default company (covers pre-migration rows)
UPDATE shops SET company_id = (SELECT id FROM companies LIMIT 1)
WHERE company_id IS NULL;
