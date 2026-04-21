CREATE TABLE IF NOT EXISTS "user_availability_overrides" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar NOT NULL,
  "date" varchar NOT NULL,
  "start_time" varchar,
  "end_time" varchar,
  "unavailable" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "user_availability_overrides_user_id_date_unique" UNIQUE("user_id", "date")
);
