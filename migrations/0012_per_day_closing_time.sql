ALTER TABLE "cash_management_settings"
  ALTER COLUMN "closing_time" TYPE jsonb
  USING CASE
    WHEN closing_time IS NULL THEN NULL
    ELSE json_build_object(
      'sunday', closing_time,
      'monday', closing_time,
      'tuesday', closing_time,
      'wednesday', closing_time,
      'thursday', closing_time,
      'friday', closing_time,
      'saturday', closing_time
    )
  END;
