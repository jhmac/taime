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

-- Task #461 — Pre-cleanup of pre-existing overlapping rows. Earlier
-- environments accumulated overlapping `schedules` before this guard
-- existed (the very race the constraint is meant to prevent). Adding
-- the constraint to such a database fails with `conflicting key value
-- violates exclusion constraint`. Merge each per-user cluster of
-- mutually-overlapping shifts into a single covering row [min(start),
-- max(end)] and delete the duplicates. Cluster detection uses
-- gaps-and-islands with the half-open `[start, end)` rule
-- (`start >= prev_max_end` ⇒ new cluster) so back-to-back shifts that
-- merely touch at the boundary are NOT merged. Idempotent.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    WITH ordered AS (
      SELECT id, user_id, start_time, end_time,
        MAX(end_time) OVER (
          PARTITION BY user_id ORDER BY start_time, end_time
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS prev_max_end
      FROM schedules
    ),
    flagged AS (
      SELECT *,
        CASE WHEN prev_max_end IS NULL OR start_time >= prev_max_end
             THEN 1 ELSE 0 END AS is_new
      FROM ordered
    ),
    numbered AS (
      SELECT *, SUM(is_new) OVER (
        PARTITION BY user_id ORDER BY start_time, end_time
        ROWS UNBOUNDED PRECEDING
      ) AS cluster_id
      FROM flagged
    )
    SELECT user_id, cluster_id,
           MIN(start_time) AS new_start,
           MAX(end_time) AS new_end,
           (array_agg(id ORDER BY (end_time - start_time) DESC, id))[1] AS keep_id,
           array_agg(id) AS all_ids
    FROM numbered
    GROUP BY user_id, cluster_id
    HAVING count(*) > 1
  LOOP
    UPDATE schedules
      SET start_time = rec.new_start, end_time = rec.new_end
      WHERE id = rec.keep_id;
    DELETE FROM schedules
      WHERE id = ANY(rec.all_ids) AND id <> rec.keep_id;
  END LOOP;
END$$;

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
