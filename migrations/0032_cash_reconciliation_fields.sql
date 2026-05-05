-- Migration: Add three-source drawer reconciliation columns to cash_deposits
-- and linkage/source-detail columns to cash_discrepancy_log.
-- These columns are populated by reconcileDrawer() which runs after deposit
-- slip analysis and compares Shopify expected cash, physical count, and
-- AI-extracted deposit slip amount.

ALTER TABLE "cash_deposits"
  ADD COLUMN IF NOT EXISTS "shopify_expected_cash"    NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "physical_count_cash"      NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "shopify_vs_count_delta"   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "count_vs_deposit_delta"   NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "shopify_vs_deposit_delta" NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS "reconciliation_status"    TEXT;

ALTER TABLE "cash_discrepancy_log"
  ADD COLUMN IF NOT EXISTS "deposit_id"          VARCHAR,
  ADD COLUMN IF NOT EXISTS "discrepancy_sources"  JSONB;
