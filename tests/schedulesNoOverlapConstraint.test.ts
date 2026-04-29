/**
 * Task #432 — Database constraint that prevents overlapping shifts for the
 * same employee.
 *
 * The /api/ai-scheduling/apply route enforces an application-level overlap
 * guard (Task #328), but two concurrent requests can race past the
 * read-then-write window and end up with two overlapping rows in the
 * `schedules` table. The fix is a Postgres EXCLUDE constraint over
 * (user_id, [start_time, end_time)) that makes the database itself reject
 * the second insert atomically.
 *
 * These tests hit the real database (`server/db`) to verify:
 *   1. Two non-overlapping shifts for the same user insert cleanly.
 *   2. Two shifts that touch at a single instant (one ends 13:00, next
 *      starts 13:00) DO NOT collide — the constraint uses a half-open
 *      `[start, end)` range.
 *   3. Two shifts that overlap by even one second for the same user are
 *      rejected with Postgres exclusion-violation error code 23P01.
 *   4. Two overlapping shifts for DIFFERENT users insert cleanly — the
 *      constraint is per-user.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../server/db";
import { schedules, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

const userIdA = `test-overlap-user-A-${randomUUID()}`;
const userIdB = `test-overlap-user-B-${randomUUID()}`;

async function clearSchedulesForTestUsers() {
  await db.delete(schedules).where(inArray(schedules.userId, [userIdA, userIdB]));
}

describe("schedules_no_overlap_per_user EXCLUDE constraint (Task #432)", () => {
  beforeAll(async () => {
    // Insert two throwaway users so the FK schedules.userId → users.id holds.
    // Both have isActive=false so they're invisible to all UI surfaces.
    await db.insert(users).values([
      { id: userIdA, email: `${userIdA}@test.invalid`, isActive: false },
      { id: userIdB, email: `${userIdB}@test.invalid`, isActive: false },
    ]).onConflictDoNothing();
  });

  afterAll(async () => {
    await clearSchedulesForTestUsers();
    await db.delete(users).where(inArray(users.id, [userIdA, userIdB]));
  });

  beforeEach(async () => {
    await clearSchedulesForTestUsers();
  });

  it("allows two non-overlapping shifts for the same user", async () => {
    await db.insert(schedules).values({
      userId: userIdA,
      startTime: new Date("2026-05-01T09:00:00Z"),
      endTime: new Date("2026-05-01T13:00:00Z"),
      title: "morning",
    });
    await db.insert(schedules).values({
      userId: userIdA,
      startTime: new Date("2026-05-01T14:00:00Z"),
      endTime: new Date("2026-05-01T18:00:00Z"),
      title: "afternoon",
    });
    const rows = await db.select().from(schedules).where(eq(schedules.userId, userIdA));
    expect(rows).toHaveLength(2);
  });

  it("allows two shifts that touch at a single instant (half-open range)", async () => {
    // 09:00–13:00 followed by 13:00–17:00 — back-to-back shifts that share
    // the exact boundary instant must NOT be flagged as overlapping. This
    // matches both the application-level overlap predicate and the typical
    // shift-handoff flow where one employee's shift ends exactly when the
    // next employee's begins for the same user (e.g. split shifts that
    // butt up against each other).
    await db.insert(schedules).values({
      userId: userIdA,
      startTime: new Date("2026-05-02T09:00:00Z"),
      endTime: new Date("2026-05-02T13:00:00Z"),
      title: "first",
    });
    await db.insert(schedules).values({
      userId: userIdA,
      startTime: new Date("2026-05-02T13:00:00Z"),
      endTime: new Date("2026-05-02T17:00:00Z"),
      title: "second",
    });
    const rows = await db.select().from(schedules).where(eq(schedules.userId, userIdA));
    expect(rows).toHaveLength(2);
  });

  it("rejects an overlapping insert with Postgres exclusion-violation 23P01", async () => {
    await db.insert(schedules).values({
      userId: userIdA,
      startTime: new Date("2026-05-03T09:00:00Z"),
      endTime: new Date("2026-05-03T13:00:00Z"),
      title: "existing",
    });
    let caught: { code?: string; constraint?: string } | null = null;
    try {
      // 11:00–15:00 overlaps the existing 09:00–13:00 by two hours.
      await db.insert(schedules).values({
        userId: userIdA,
        startTime: new Date("2026-05-03T11:00:00Z"),
        endTime: new Date("2026-05-03T15:00:00Z"),
        title: "conflict",
      });
    } catch (err) {
      caught = err as { code?: string; constraint?: string };
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe("23P01");
    expect(caught?.constraint).toBe("schedules_no_overlap_per_user");
    // The original shift should still be the only row for this user — the
    // constraint must reject atomically without partially writing.
    const rows = await db.select().from(schedules).where(eq(schedules.userId, userIdA));
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("existing");
  });

  it("rejects even a 1-second overlap", async () => {
    await db.insert(schedules).values({
      userId: userIdA,
      startTime: new Date("2026-05-04T09:00:00Z"),
      endTime: new Date("2026-05-04T13:00:00Z"),
      title: "existing",
    });
    let caught: { code?: string } | null = null;
    try {
      // Starts one second BEFORE the existing one ends.
      await db.insert(schedules).values({
        userId: userIdA,
        startTime: new Date("2026-05-04T12:59:59Z"),
        endTime: new Date("2026-05-04T17:00:00Z"),
        title: "one-second-overlap",
      });
    } catch (err) {
      caught = err as { code?: string };
    }
    expect(caught?.code).toBe("23P01");
  });

  it("allows two overlapping shifts for DIFFERENT users (per-user constraint)", async () => {
    await db.insert(schedules).values({
      userId: userIdA,
      startTime: new Date("2026-05-05T09:00:00Z"),
      endTime: new Date("2026-05-05T17:00:00Z"),
      title: "user-A shift",
    });
    // Same window, different user → no conflict, both are on the floor.
    await db.insert(schedules).values({
      userId: userIdB,
      startTime: new Date("2026-05-05T09:00:00Z"),
      endTime: new Date("2026-05-05T17:00:00Z"),
      title: "user-B shift",
    });
    const aRows = await db.select().from(schedules).where(eq(schedules.userId, userIdA));
    const bRows = await db.select().from(schedules).where(eq(schedules.userId, userIdB));
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
  });
});
