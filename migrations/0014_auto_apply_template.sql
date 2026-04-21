ALTER TABLE "availability_templates" ADD COLUMN IF NOT EXISTS "auto_apply_template" boolean NOT NULL DEFAULT false;
