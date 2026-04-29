// Task #437 — Tests for the in-memory edit helper used by the AI-proposed
// shift editor in ScheduleManagement.

import { describe, it, expect } from "vitest";
import {
  applyAiEntryEdit,
  isValidTimeString,
  isValidShiftWindow,
  type AiScheduleEntry,
} from "../client/src/lib/aiScheduleEditing";

const baseEntry = (overrides: Partial<AiScheduleEntry> = {}): AiScheduleEntry => ({
  date: "2026-05-04",
  employeeId: "emp-1",
  employeeName: "Alice Smith",
  shiftBlock: "morning",
  startTime: "09:00",
  endTime: "13:00",
  reasoning: "Opening shift coverage.",
  ...overrides,
});

describe("applyAiEntryEdit — patches a single entry by index", () => {
  it("returns a new array (does not mutate the input)", () => {
    const entries = [baseEntry({ employeeId: "emp-1" }), baseEntry({ employeeId: "emp-2" })];
    const before = JSON.stringify(entries);
    const out = applyAiEntryEdit(entries, 0, { startTime: "10:00" });

    expect(out).not.toBe(entries);
    expect(JSON.stringify(entries)).toBe(before);
  });

  it("merges the patch onto the targeted entry only", () => {
    const entries = [
      baseEntry({ employeeId: "emp-1", startTime: "09:00", endTime: "13:00" }),
      baseEntry({ employeeId: "emp-2", startTime: "13:00", endTime: "17:00" }),
    ];
    const out = applyAiEntryEdit(entries, 1, { startTime: "12:30", endTime: "16:30" });

    expect(out[0]).toEqual(entries[0]);
    expect(out[1]).toEqual({ ...entries[1], startTime: "12:30", endTime: "16:30" });
  });

  it("can reassign an entry to a different employee", () => {
    const entries = [baseEntry({ employeeId: "emp-1", employeeName: "Alice Smith" })];
    const out = applyAiEntryEdit(entries, 0, {
      employeeId: "emp-2",
      employeeName: "Bob Jones",
    });

    expect(out[0].employeeId).toBe("emp-2");
    expect(out[0].employeeName).toBe("Bob Jones");
    // Unrelated fields preserved
    expect(out[0].date).toBe("2026-05-04");
    expect(out[0].startTime).toBe("09:00");
  });

  it("leaves the array unchanged when idx is negative", () => {
    const entries = [baseEntry()];
    const out = applyAiEntryEdit(entries, -1, { startTime: "10:00" });
    expect(out).toBe(entries);
  });

  it("leaves the array unchanged when idx is past the end", () => {
    const entries = [baseEntry()];
    const out = applyAiEntryEdit(entries, 5, { startTime: "10:00" });
    expect(out).toBe(entries);
  });

  it("preserves the original index of every other entry (no reorder)", () => {
    const entries = [
      baseEntry({ employeeName: "A" }),
      baseEntry({ employeeName: "B" }),
      baseEntry({ employeeName: "C" }),
    ];
    const out = applyAiEntryEdit(entries, 1, { startTime: "10:00" });

    expect(out.map((e) => e.employeeName)).toEqual(["A", "B", "C"]);
  });

  it("does not partially-apply when patch is empty (returns equivalent new array)", () => {
    const entries = [baseEntry()];
    const out = applyAiEntryEdit(entries, 0, {});

    expect(out).not.toBe(entries);
    expect(out[0]).toEqual(entries[0]);
  });
});

describe("isValidTimeString — HH:MM 24-hour validation", () => {
  it("accepts well-formed times", () => {
    expect(isValidTimeString("00:00")).toBe(true);
    expect(isValidTimeString("09:30")).toBe(true);
    expect(isValidTimeString("23:59")).toBe(true);
    expect(isValidTimeString("12:00")).toBe(true);
  });

  it("rejects out-of-range hours and minutes", () => {
    expect(isValidTimeString("24:00")).toBe(false);
    expect(isValidTimeString("09:60")).toBe(false);
    expect(isValidTimeString("99:99")).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidTimeString("")).toBe(false);
    expect(isValidTimeString("9:00")).toBe(false); // missing leading zero
    expect(isValidTimeString("0900")).toBe(false);
    expect(isValidTimeString("9:00 AM")).toBe(false);
  });
});

describe("isValidShiftWindow — same-day end-after-start", () => {
  it("accepts a normal forward window", () => {
    expect(isValidShiftWindow("09:00", "17:00")).toBe(true);
    expect(isValidShiftWindow("09:00", "09:01")).toBe(true);
  });

  it("rejects equal start and end (zero-length shift)", () => {
    expect(isValidShiftWindow("09:00", "09:00")).toBe(false);
  });

  it("rejects end before start (would be an overnight shift)", () => {
    expect(isValidShiftWindow("17:00", "09:00")).toBe(false);
    expect(isValidShiftWindow("23:00", "01:00")).toBe(false);
  });

  it("rejects either side being malformed", () => {
    expect(isValidShiftWindow("9:00", "17:00")).toBe(false);
    expect(isValidShiftWindow("09:00", "")).toBe(false);
  });
});
