-- Migration: Add review_status column to offsite_sessions
-- Allows admins to mark a trip as 'approved' or 'flagged' from the trip map view.

ALTER TABLE "offsite_sessions"
  ADD COLUMN IF NOT EXISTS "review_status" varchar;
