import logger from "../lib/logger";

export interface ScheduleShift {
  date: string;
  employeeId: string;
  employeeName: string;
  shiftBlock: string;
  startTime: string;
  endTime: string;
  reasoning: string;
}

export interface OverlapResult {
  originalShifts: ScheduleShift[];
  adjustedShifts: ScheduleShift[];
  overlapBlocks: OverlapBlock[];
  additionalLaborCost: number;
  budgetWarning: BudgetWarning | null;
}

export interface OverlapBlock {
  date: string;
  outgoingEmployeeId: string;
  outgoingEmployeeName: string;
  incomingEmployeeId: string;
  incomingEmployeeName: string;
  overlapStart: string;
  overlapEnd: string;
  overlapMinutes: number;
  type: "handoff" | "preopen";
}

export interface BudgetWarning {
  overBudget: boolean;
  additionalOverlapCost: number;
  weeklyBudgetLimit: number;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function applyShiftOverlap(
  shifts: ScheduleShift[],
  overlapMinutes: number
): { adjustedShifts: ScheduleShift[]; overlapBlocks: OverlapBlock[] } {
  if (overlapMinutes <= 0) {
    return { adjustedShifts: [...shifts], overlapBlocks: [] };
  }

  const byDate = new Map<string, ScheduleShift[]>();
  for (const s of shifts) {
    const list = byDate.get(s.date) || [];
    list.push({ ...s });
    byDate.set(s.date, list);
  }

  const adjustedShifts: ScheduleShift[] = [];
  const overlapBlocks: OverlapBlock[] = [];

  for (const [date, dayShifts] of byDate) {
    dayShifts.sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const uniqueBlocks = getUniqueShiftBlocks(dayShifts);

    for (let i = 0; i < uniqueBlocks.length; i++) {
      const currentBlock = uniqueBlocks[i];

      if (i === 0) {
        const preOpenStart = timeToMinutes(currentBlock.startTime) - overlapMinutes;
        if (preOpenStart >= 0) {
          for (const shift of dayShifts.filter(s => s.shiftBlock === currentBlock.blockName)) {
            shift.startTime = minutesToTime(preOpenStart);
            overlapBlocks.push({
              date,
              outgoingEmployeeId: shift.employeeId,
              outgoingEmployeeName: shift.employeeName,
              incomingEmployeeId: shift.employeeId,
              incomingEmployeeName: shift.employeeName,
              overlapStart: minutesToTime(preOpenStart),
              overlapEnd: currentBlock.startTime,
              overlapMinutes,
              type: "preopen",
            });
          }
        }
      }

      if (i < uniqueBlocks.length - 1) {
        const nextBlock = uniqueBlocks[i + 1];
        const currentEndMin = timeToMinutes(currentBlock.endTime);
        const nextStartMin = timeToMinutes(nextBlock.startTime);

        if (nextStartMin >= currentEndMin) {
          const incomingShifts = dayShifts.filter(s => s.shiftBlock === nextBlock.blockName);
          const outgoingShifts = dayShifts.filter(s => s.shiftBlock === currentBlock.blockName);

          for (const incoming of incomingShifts) {
            incoming.startTime = minutesToTime(nextStartMin - overlapMinutes);
          }

          const outgoing = outgoingShifts[0];
          const incomingFirst = incomingShifts[0];
          if (outgoing && incomingFirst) {
            overlapBlocks.push({
              date,
              outgoingEmployeeId: outgoing.employeeId,
              outgoingEmployeeName: outgoing.employeeName,
              incomingEmployeeId: incomingFirst.employeeId,
              incomingEmployeeName: incomingFirst.employeeName,
              overlapStart: minutesToTime(nextStartMin - overlapMinutes),
              overlapEnd: currentBlock.endTime,
              overlapMinutes,
              type: "handoff",
            });
          }
        }
      }
    }

    adjustedShifts.push(...dayShifts);
  }

  return { adjustedShifts, overlapBlocks };
}

function getUniqueShiftBlocks(shifts: ScheduleShift[]): Array<{ blockName: string; startTime: string; endTime: string }> {
  const seen = new Map<string, { startTime: string; endTime: string }>();
  for (const s of shifts) {
    if (!seen.has(s.shiftBlock)) {
      seen.set(s.shiftBlock, { startTime: s.startTime, endTime: s.endTime });
    }
  }
  return Array.from(seen.entries())
    .map(([blockName, times]) => ({ blockName, ...times }))
    .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

export function calculateOverlapLaborCost(
  overlapBlocks: OverlapBlock[],
  hourlyRates: Map<string, number>
): number {
  let totalCost = 0;

  for (const block of overlapBlocks) {
    const hours = block.overlapMinutes / 60;

    if (block.type === "preopen") {
      const rate = hourlyRates.get(block.outgoingEmployeeId) || 15;
      totalCost += hours * rate;
    } else {
      const incomingRate = hourlyRates.get(block.incomingEmployeeId) || 15;
      totalCost += hours * incomingRate;
    }
  }

  return Math.round(totalCost * 100) / 100;
}

export function checkBudgetThreshold(
  additionalCost: number,
  budgetLimit: number | null
): BudgetWarning | null {
  if (!budgetLimit || budgetLimit <= 0) return null;

  return {
    overBudget: additionalCost > budgetLimit,
    additionalOverlapCost: additionalCost,
    weeklyBudgetLimit: budgetLimit,
  };
}
