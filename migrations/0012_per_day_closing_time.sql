ALTER TABLE "cash_management_settings"
  ALTER COLUMN "closing_time" TYPE text
  USING closing_time::text;
