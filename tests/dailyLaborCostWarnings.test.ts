import { describe, it, expect } from "vitest";
import {
  calculateDailyLaborCost,
  checkDailyLaborCostThresholds,
  type ScheduleShift,
} from "../server/services/shiftOverlap";

const shift = (
  date: string,
  employeeId: string,
  startTime: string,
  endTime: string,
): ScheduleShift => ({
  date,
  employeeId,
  employeeName: employeeId,
  shiftBlock: "Morning",
  startTime,
  endTime,
  reasoning: "",
});

describe("calculateDailyLaborCost", () => {
  it("sums hours × hourly rate per date and uses the default rate when an employee is missing", () => {
    const shifts: ScheduleShift[] = [
      shift("2026-04-27", "alice", "09:00", "17:00"),
      shift("2026-04-27", "bob", "12:00", "20:00"),
      shift("2026-04-28", "alice", "10:00", "14:00"),
      shift("2026-04-28", "carol", "10:00", "12:00"),
    ];
    const rates = new Map<string, number>([
      ["alice", 20],
      ["bob", 25],
    ]);

    const result = calculateDailyLaborCost(shifts, rates);

    expect(result).toEqual([
      { date: "2026-04-27", laborCost: 8 * 20 + 8 * 25 },
      { date: "2026-04-28", laborCost: 4 * 20 + 2 * 15 },
    ]);
  });

  it("ignores zero-length shifts", () => {
    const result = calculateDailyLaborCost(
      [shift("2026-04-27", "alice", "09:00", "09:00")],
      new Map([["alice", 20]]),
    );
    expect(result).toEqual([]);
  });
});

describe("checkDailyLaborCostThresholds", () => {
  it("emits an over-budget warning when labor cost exceeds 30% of projected revenue", () => {
    const warnings = checkDailyLaborCostThresholds(
      [{ date: "2026-04-27", laborCost: 400 }],
      new Map([["2026-04-27", 1000]]),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      date: "2026-04-27",
      laborCost: 400,
      projectedRevenue: 1000,
      laborCostPercent: 40,
      type: "over",
    });
    expect(warnings[0].message).toContain("$400.00");
    expect(warnings[0].message).toContain("$1000.00");
    expect(warnings[0].message).toContain("40%");
    expect(warnings[0].message).toContain("30%");
  });

  it("emits an understaffed warning when labor cost is below 10% of projected revenue", () => {
    const warnings = checkDailyLaborCostThresholds(
      [{ date: "2026-04-28", laborCost: 50 }],
      new Map([["2026-04-28", 1000]]),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      date: "2026-04-28",
      type: "under",
      laborCostPercent: 5,
    });
    expect(warnings[0].message).toContain("understaffing");
  });

  it("does not warn when labor cost is within the 10–30% band", () => {
    const warnings = checkDailyLaborCostThresholds(
      [
        { date: "2026-04-27", laborCost: 150 },
        { date: "2026-04-28", laborCost: 250 },
      ],
      new Map([
        ["2026-04-27", 1000],
        ["2026-04-28", 1000],
      ]),
    );

    expect(warnings).toEqual([]);
  });

  it("skips dates with no projected revenue", () => {
    const warnings = checkDailyLaborCostThresholds(
      [{ date: "2026-04-27", laborCost: 500 }],
      new Map([["2026-04-27", 0]]),
    );
    expect(warnings).toEqual([]);
  });

  it("uses the configured overThresholdPct when provided", () => {
    const warnings = checkDailyLaborCostThresholds(
      [{ date: "2026-04-27", laborCost: 150 }],
      new Map([["2026-04-27", 1000]]),
      { overThresholdPct: 12 },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: "over", laborCostPercent: 15 });
    expect(warnings[0].message).toContain("12%");
  });

  it("uses the configured underThresholdPct when provided", () => {
    const warnings = checkDailyLaborCostThresholds(
      [{ date: "2026-04-27", laborCost: 220 }],
      new Map([["2026-04-27", 1000]]),
      { underThresholdPct: 25, overThresholdPct: 40 },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: "under", laborCostPercent: 22 });
    expect(warnings[0].message).toContain("25%");
  });

  it("does not warn when labor cost falls within a custom band", () => {
    const warnings = checkDailyLaborCostThresholds(
      [{ date: "2026-04-27", laborCost: 200 }],
      new Map([["2026-04-27", 1000]]),
      { overThresholdPct: 25, underThresholdPct: 15 },
    );
    expect(warnings).toEqual([]);
  });

  it("flags scheduled days with projected revenue but zero labor as understaffed", () => {
    const warnings = checkDailyLaborCostThresholds(
      [{ date: "2026-04-27", laborCost: 200 }],
      new Map([
        ["2026-04-27", 1000],
        ["2026-04-28", 1000],
      ]),
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      date: "2026-04-28",
      laborCost: 0,
      projectedRevenue: 1000,
      laborCostPercent: 0,
      type: "under",
    });
  });
});
