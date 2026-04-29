-- Task #432 — Database constraint that prevents overlapping shifts for the same employee
--
-- Application-level overlap guards (Task #328) catch the common case but two
-- concurrent /api/ai-scheduling/apply requests can race past the read-then-write
-- window and end up with two overlapping rows in `schedules`. A Postgres
-- exclusion constraint over (user_id, [start_time, end_time)) makes the database
-- itself reject the second insert atomically — no app-level locking required.
--
-- The half-open `[start, end)` range matches the convention used by the
-- existing app overlap predicate (`existing.start < new.end AND existing.end >
-- new.start`), so two shifts that touch at a single instant (one ending at
-- 13:00 and the next starting at 13:00) are NOT considered overlapping.
--
-- Note: `start_time`/`end_time` are `timestamp without time zone` in this
-- schema, so we use `tsrange` (NOT `tstzrange`). The latter would require
-- a STABLE cast through the session timezone, which Postgres rejects in
-- index expressions ("functions in index expression must be marked
-- IMMUTABLE"). The route layer already converts wall-clock entries to
-- the correct UTC instants before insert, so a wall-clock `tsrange`
-- comparison is the right semantics.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedules_no_overlap_per_user'
  ) THEN
    ALTER TABLE schedules
      ADD CONSTRAINT schedules_no_overlap_per_user
      EXCLUDE USING gist (
        user_id WITH =,
        tsrange(start_time, end_time, '[)') WITH &&
      );
  END IF;
END$$;
