CREATE TABLE IF NOT EXISTS "supplies" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar NOT NULL,
  "notes" text,
  "requested_by" varchar NOT NULL,
  "company_id" varchar,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "purchased" boolean DEFAULT false NOT NULL,
  "purchased_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_supplies_company_id" ON "supplies" ("company_id");
CREATE INDEX IF NOT EXISTS "idx_supplies_requested_at" ON "supplies" ("requested_at");
CREATE INDEX IF NOT EXISTS "idx_supplies_purchased" ON "supplies" ("purchased");
