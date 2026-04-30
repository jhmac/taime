/**
 * Unit tests for the clock-in SOP surfacing triggers in
 * `server/services/sopSurfacing.ts`:
 *   - getShiftHandoffSOPs       — fires when other employees are on shift
 *   - getOpeningSOPsForClockIn  — fires when the user is the first in today
 *
 * `server/db` is mocked with a queue-based chainable fake.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, responseQueue } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  responseQueue: [] as Array<unknown[]>,
}));

vi.mock("../server/db", () => ({
  db: { select: mockSelect },
}));

import {
  getShiftHandoffSOPs,
  getOpeningSOPsForClockIn,
} from "../server/services/sopSurfacing";
import { cache } from "../server/services/cache";

// Minimal shape of the chain we exercise in sopSurfacing.ts. The result
// of `.where(...)` is awaitable AND optionally exposes `.groupBy(...)`,
// since `getEmployeeExecutionCounts` calls `.where(...).groupBy(...)`.
interface WhereResult<T> extends PromiseLike<T[]> {
  groupBy: (..._args: unknown[]) => Promise<T[]>;
}
interface QueryChain<T> {
  from: (..._args: unknown[]) => QueryChain<T>;
  where: (..._args: unknown[]) => WhereResult<T>;
}

function buildChain(): QueryChain<unknown> {
  const rows = responseQueue.shift();
  if (!rows) {
    throw new Error(
      "buildChain: no more configured DB responses — enqueue one per db.select call",
    );
  }
  const promise = Promise.resolve(rows);
  const wherePromise: WhereResult<unknown> = {
    then: promise.then.bind(promise),
    groupBy: vi.fn(() => Promise.resolve(rows)),
  };
  const chain: QueryChain<unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => wherePromise),
  };
  return chain;
}

function enqueueRows(...rowsList: unknown[][]) {
  for (const rows of rowsList) responseQueue.push(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  responseQueue.length = 0;
  // getActiveSOPTemplates caches per-storeId — clear so templates don't leak.
  cache.clear();
  mockSelect.mockImplementation(() => buildChain());
});

// ──────────────────────────────────────────────────────────────────────────
// getShiftHandoffSOPs
// ──────────────────────────────────────────────────────────────────────────

describe("getShiftHandoffSOPs — fires only when others are on shift", () => {
  const STORE_ID = "store-handoff-1";
  const INCOMING = "user-incoming";
  const OUTGOING = "user-outgoing";

  it("returns handoff SOPs when another employee has an active time entry", async () => {
    enqueueRows(
      // timeEntries: outgoing user is still clocked in
      [{ userId: OUTGOING }],
      // sopTemplates: one matching handoff template
      [
        {
          id: "tpl-handoff",
          title: "Shift Handoff Checklist",
          category: "process",
          isActive: true,
          storeId: STORE_ID,
        },
      ],
      // sopExecutions: incoming user has done it 5 times before
      [{ templateId: "tpl-handoff", count: 5 }],
      // users: names for incoming + outgoing
      [
        { id: INCOMING, firstName: "Iris", lastName: "Incoming" },
        { id: OUTGOING, firstName: "Otto", lastName: "Outgoing" },
      ],
    );

    const result = await getShiftHandoffSOPs(INCOMING, STORE_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      templateId: "tpl-handoff",
      title: "Shift Handoff Checklist",
      triggerType: "event_based",
      reason: "event_based",
      priority: 2,
      trainingModeRecommended: false, // 5 ≥ 3
    });
    expect(result[0].message).toContain("Otto Outgoing");
    expect(result[0].message).toContain("Iris Incoming");
  });

  it("recommends training mode when the incoming user has < 3 prior executions", async () => {
    enqueueRows(
      [{ userId: OUTGOING }],
      [
        {
          id: "tpl-handoff",
          title: "Shift Handoff Checklist",
          category: "process",
          isActive: true,
          storeId: STORE_ID,
        },
      ],
      [{ templateId: "tpl-handoff", count: 1 }],
      [
        { id: INCOMING, firstName: "Iris", lastName: "Incoming" },
        { id: OUTGOING, firstName: "Otto", lastName: "Outgoing" },
      ],
    );

    const result = await getShiftHandoffSOPs(INCOMING, STORE_ID);

    expect(result).toHaveLength(1);
    expect(result[0].trainingModeRecommended).toBe(true);
  });

  it("returns NO SOPs when no other employee is on shift (negative case)", async () => {
    // Only the incoming user is "active" — no outgoing party, so handoff
    // doesn't apply. Function must short-circuit before querying templates.
    enqueueRows([{ userId: INCOMING }]);

    const result = await getShiftHandoffSOPs(INCOMING, STORE_ID);

    expect(result).toStrictEqual([]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns NO SOPs when there are zero active time entries at the store", async () => {
    enqueueRows([]);

    const result = await getShiftHandoffSOPs(INCOMING, STORE_ID);

    expect(result).toStrictEqual([]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns NO SOPs when others are on shift but no handoff template exists", async () => {
    enqueueRows(
      [{ userId: OUTGOING }],
      [
        {
          id: "tpl-other",
          title: "Inventory Audit",
          category: "inventory",
          isActive: true,
          storeId: STORE_ID,
        },
      ],
    );

    const result = await getShiftHandoffSOPs(INCOMING, STORE_ID);

    expect(result).toStrictEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// getOpeningSOPsForClockIn
// ──────────────────────────────────────────────────────────────────────────

describe("getOpeningSOPsForClockIn — fires only for the first shift of the day", () => {
  const STORE_ID = "store-opening-1";
  const FIRST_USER = "user-first";
  const OTHER_USER = "user-other";

  it("returns opening SOPs when no one else has clocked in today", async () => {
    enqueueRows(
      // timeEntries today — empty
      [],
      [
        {
          id: "tpl-open",
          title: "Morning Opening Checklist",
          category: "process",
          isActive: true,
          storeId: STORE_ID,
        },
      ],
      [{ templateId: "tpl-open", count: 4 }],
    );

    const result = await getOpeningSOPsForClockIn(FIRST_USER, STORE_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      templateId: "tpl-open",
      title: "Morning Opening Checklist",
      triggerType: "event_based",
      reason: "event_based",
      priority: 1,
      trainingModeRecommended: false, // 4 ≥ 3
    });
    expect(result[0].message).toContain("first one in today");
  });

  it("still surfaces opening SOPs when the only entry today is the clocking-in user themself", async () => {
    enqueueRows(
      [{ userId: FIRST_USER }],
      [
        {
          id: "tpl-open",
          title: "Start of Day Checklist",
          category: "process",
          isActive: true,
          storeId: STORE_ID,
        },
      ],
      [],
    );

    const result = await getOpeningSOPsForClockIn(FIRST_USER, STORE_ID);

    expect(result).toHaveLength(1);
    expect(result[0].templateId).toBe("tpl-open");
    expect(result[0].trainingModeRecommended).toBe(true); // 0 < 3
  });

  it("returns NO SOPs when another employee has already clocked in today (negative case)", async () => {
    // Someone else clocked in earlier today — clocking-in user is NOT
    // the first shift, so opening SOPs must NOT surface.
    enqueueRows([{ userId: OTHER_USER }]);

    const result = await getOpeningSOPsForClockIn(FIRST_USER, STORE_ID);

    expect(result).toStrictEqual([]);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns NO SOPs when first-in but no opening template exists", async () => {
    enqueueRows(
      [],
      [
        {
          id: "tpl-misc",
          title: "Customer Complaint Handling",
          category: "customer_experience",
          isActive: true,
          storeId: STORE_ID,
        },
      ],
    );

    const result = await getOpeningSOPsForClockIn(FIRST_USER, STORE_ID);

    expect(result).toStrictEqual([]);
  });

  it("ignores templates that don't match opening keywords and returns only matching ones", async () => {
    enqueueRows(
      [],
      [
        {
          id: "tpl-open",
          title: "Opening Checklist",
          category: "process",
          isActive: true,
          storeId: STORE_ID,
        },
        {
          id: "tpl-close",
          title: "Closing Checklist",
          category: "process",
          isActive: true,
          storeId: STORE_ID,
        },
        {
          id: "tpl-misc",
          title: "Customer Service Notes",
          category: "customer_experience",
          isActive: true,
          storeId: STORE_ID,
        },
      ],
      [],
    );

    const result = await getOpeningSOPsForClockIn(FIRST_USER, STORE_ID);

    expect(result).toHaveLength(1);
    expect(result[0].templateId).toBe("tpl-open");
  });
});
