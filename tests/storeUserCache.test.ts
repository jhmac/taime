/**
 * Unit tests for getAllStoreUserIds in server/lib/permissionUtils.
 *
 * Verifies:
 *  1. Results are filtered to the given storeId (not all active users)
 *  2. Cache keys are scoped per storeId so two stores don't share cached data
 *  3. Cache hits skip the DB entirely
 *
 * The `db` module is mocked via vi.mock/vi.hoisted so no real database or
 * Express context is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoist the mock variable so it is available inside vi.mock factory ──────

const { mockSelect } = vi.hoisted(() => {
  return { mockSelect: vi.fn() };
});

vi.mock("../server/db", () => ({
  db: {
    select: mockSelect,
  },
}));

// ── import the unit under test after the mock is in place ─────────────────

import { getAllStoreUserIds } from "../server/lib/permissionUtils";

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a chainable query builder mock that resolves to `rows` when awaited.
 * Covers the call chain: db.select(…).from(…).innerJoin(…).where(…)
 */
function makeQueryChain(rows: { id: string }[]) {
  const chain: Record<string, unknown> = {};
  const terminal = Promise.resolve(rows);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => terminal);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── filtering ──────────────────────────────────────────────────────────────

describe("getAllStoreUserIds — store filtering", () => {
  it("returns only the IDs returned by the DB query for the given store", async () => {
    const rows = [{ id: "emp-a" }, { id: "emp-b" }];
    mockSelect.mockReturnValue(makeQueryChain(rows));

    const result = await getAllStoreUserIds("store-filter-2");

    expect(result).toStrictEqual(["emp-a", "emp-b"]);
  });

  it("returns an empty array when no users belong to the store", async () => {
    mockSelect.mockReturnValue(makeQueryChain([]));

    const result = await getAllStoreUserIds("store-empty-2");

    expect(result).toStrictEqual([]);
  });

  it("calls db.select exactly once per cache miss", async () => {
    mockSelect.mockReturnValue(makeQueryChain([{ id: "emp-1" }]));

    await getAllStoreUserIds("store-once-2");

    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});

// ── cache scoping ──────────────────────────────────────────────────────────

describe("getAllStoreUserIds — per-store cache isolation", () => {
  it("caches results per storeId so a second call skips the DB", async () => {
    const rows = [{ id: "emp-cached" }];
    mockSelect.mockReturnValue(makeQueryChain(rows));

    const storeId = "store-cache-hit-2";

    // First call — DB hit
    await getAllStoreUserIds(storeId);
    // Second call — should use cache
    const result = await getAllStoreUserIds(storeId);

    expect(mockSelect).toHaveBeenCalledTimes(1); // only one DB round-trip
    expect(result).toStrictEqual(["emp-cached"]);
  });

  it("does NOT share cached results between two different storeIds", async () => {
    const rowsA = [{ id: "emp-a1" }, { id: "emp-a2" }];
    const rowsB = [{ id: "emp-b1" }];

    mockSelect
      .mockReturnValueOnce(makeQueryChain(rowsA))
      .mockReturnValueOnce(makeQueryChain(rowsB));

    const resultA = await getAllStoreUserIds("store-iso-a2");
    const resultB = await getAllStoreUserIds("store-iso-b2");

    expect(resultA).toStrictEqual(["emp-a1", "emp-a2"]);
    expect(resultB).toStrictEqual(["emp-b1"]);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  it("returns store-A results from cache while store-B also returns from cache", async () => {
    const rowsA = [{ id: "emp-a" }];
    const rowsB = [{ id: "emp-b" }];

    mockSelect
      .mockReturnValueOnce(makeQueryChain(rowsA))
      .mockReturnValueOnce(makeQueryChain(rowsB));

    // Prime both caches
    await getAllStoreUserIds("store-prime-a2");
    await getAllStoreUserIds("store-prime-b2");
    expect(mockSelect).toHaveBeenCalledTimes(2);

    // Both should now be served from cache
    const cachedA = await getAllStoreUserIds("store-prime-a2");
    const cachedB = await getAllStoreUserIds("store-prime-b2");
    expect(mockSelect).toHaveBeenCalledTimes(2); // no additional DB calls

    expect(cachedA).toStrictEqual(["emp-a"]);
    expect(cachedB).toStrictEqual(["emp-b"]);
  });
});
