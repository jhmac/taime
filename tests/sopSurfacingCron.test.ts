import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSurfacingTick, type CronDeps, type SurfacedSOP } from "../server/services/sopSurfacing";

const STORE_ID = "store-001";

const fakeSOP: SurfacedSOP = {
  templateId: "tpl-1",
  title: "Opening Checklist",
  category: "process",
  reason: "time_based",
  triggerType: "time_based",
  priority: 1,
  trainingModeRecommended: false,
  message: "Opening time! Your Opening Checklist is ready.",
};

const silentLogger: CronDeps["logger"] = {
  info: vi.fn(),
  error: vi.fn(),
};

function makeDeps(overrides: Partial<CronDeps> = {}): CronDeps {
  return {
    resolveStoreId: vi.fn().mockResolvedValue(STORE_ID),
    getActiveOnShift: vi.fn().mockResolvedValue([]),
    getTimeBased: vi.fn().mockResolvedValue([fakeSOP]),
    logger: silentLogger,
    ...overrides,
  };
}

describe("runSurfacingTick — clock-in gating", () => {
  let sendToUsers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendToUsers = vi.fn();
  });

  it("DOES send SOP alerts to a user who is clocked in", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([{ userId: "user-on-shift" }]),
    });

    await runSurfacingTick(sendToUsers, deps);

    expect(sendToUsers).toHaveBeenCalledOnce();
    const [userIds, payload] = sendToUsers.mock.calls[0];
    expect(userIds).toContain("user-on-shift");
    expect(payload).toMatchObject({ type: "sop_surfaced" });
  });

  it("does NOT send SOP alerts when no users are clocked in", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([]),
    });

    await runSurfacingTick(sendToUsers, deps);

    expect(sendToUsers).not.toHaveBeenCalled();
  });

  it("sends only to clocked-in users, not to users who are off shift", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([
        { userId: "user-on-shift-a" },
        { userId: "user-on-shift-b" },
      ]),
    });

    await runSurfacingTick(sendToUsers, deps);

    expect(sendToUsers).toHaveBeenCalledOnce();
    const [userIds] = sendToUsers.mock.calls[0];
    expect(userIds).toContain("user-on-shift-a");
    expect(userIds).toContain("user-on-shift-b");
    expect(userIds).not.toContain("user-off-shift");
  });

  it("does NOT send when there are no time-based SOPs to surface", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([{ userId: "user-on-shift" }]),
      getTimeBased: vi.fn().mockResolvedValue([]),
    });

    await runSurfacingTick(sendToUsers, deps);

    expect(sendToUsers).not.toHaveBeenCalled();
  });

  it("does NOT send when the store ID cannot be resolved", async () => {
    const deps = makeDeps({
      resolveStoreId: vi.fn().mockResolvedValue(null),
      getActiveOnShift: vi.fn().mockResolvedValue([{ userId: "user-on-shift" }]),
    });

    await runSurfacingTick(sendToUsers, deps);

    expect(sendToUsers).not.toHaveBeenCalled();
  });

  it("de-duplicates user IDs when an employee has multiple open time entries", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([
        { userId: "user-dup" },
        { userId: "user-dup" },
        { userId: "user-other" },
      ]),
    });

    await runSurfacingTick(sendToUsers, deps);

    expect(sendToUsers).toHaveBeenCalledOnce();
    const [userIds] = sendToUsers.mock.calls[0];
    expect(userIds.filter((id: string) => id === "user-dup")).toHaveLength(1);
    expect(userIds).toContain("user-other");
  });

  it("sends the correct SOP payload shape to on-shift users", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([{ userId: "user-on-shift" }]),
    });

    await runSurfacingTick(sendToUsers, deps);

    const [, payload] = sendToUsers.mock.calls[0];
    expect(payload).toMatchObject({
      type: "sop_surfaced",
      data: {
        trigger: "time_based",
        sops: expect.arrayContaining([
          expect.objectContaining({ templateId: "tpl-1" }),
        ]),
      },
    });
  });
});

describe("runSurfacingTick — database error handling", () => {
  let sendToUsers: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendToUsers = vi.fn();
  });

  it("propagates errors thrown by getActiveOnShift so the caller can log them", async () => {
    const dbError = new Error("connection refused");
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockRejectedValue(dbError),
    });

    await expect(runSurfacingTick(sendToUsers, deps)).rejects.toThrow(
      "connection refused"
    );
  });

  it("does NOT call sendToUsers when getActiveOnShift rejects", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockRejectedValue(new Error("db down")),
    });

    await expect(runSurfacingTick(sendToUsers, deps)).rejects.toThrow();

    expect(sendToUsers).not.toHaveBeenCalled();
  });

  it("propagates errors thrown by getTimeBased so the caller can log them", async () => {
    const dbError = new Error("query timeout");
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([{ userId: "user-on-shift" }]),
      getTimeBased: vi.fn().mockRejectedValue(dbError),
    });

    await expect(runSurfacingTick(sendToUsers, deps)).rejects.toThrow(
      "query timeout"
    );
  });

  it("does NOT call sendToUsers when getTimeBased rejects mid-tick", async () => {
    const deps = makeDeps({
      getActiveOnShift: vi.fn().mockResolvedValue([{ userId: "user-on-shift" }]),
      getTimeBased: vi.fn().mockRejectedValue(new Error("query timeout")),
    });

    await expect(runSurfacingTick(sendToUsers, deps)).rejects.toThrow();

    expect(sendToUsers).not.toHaveBeenCalled();
  });
});
