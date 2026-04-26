import { describe, it, expect, vi } from 'vitest';
import { classifyShiftCard } from '../client/src/components/createShiftCardKind';

describe('classifyShiftCard', () => {
  describe('AI suggestion cards', () => {
    it('returns ai for the first AI shift', () => {
      expect(classifyShiftCard(0, 3, 'Morning')).toBe('ai');
    });

    it('returns ai for an AI shift in the middle', () => {
      expect(classifyShiftCard(1, 3, 'Lunch')).toBe('ai');
    });

    it('returns ai for the last AI shift', () => {
      expect(classifyShiftCard(2, 3, 'Evening')).toBe('ai');
    });

    it('returns ai when shiftBlock is null', () => {
      expect(classifyShiftCard(0, 3, null)).toBe('ai');
    });

    it('returns ai when shiftBlock is undefined', () => {
      expect(classifyShiftCard(0, 3, undefined)).toBe('ai');
    });
  });

  describe('persisted manual drafts', () => {
    it('returns persisted-manual when idx<aiCount and shiftBlock is Manual', () => {
      expect(classifyShiftCard(0, 3, 'Manual')).toBe('persisted-manual');
    });

    it('returns persisted-manual at the last AI index', () => {
      expect(classifyShiftCard(2, 3, 'Manual')).toBe('persisted-manual');
    });
  });

  describe('pending manual drafts', () => {
    it('returns pending-manual at idx === aiCount', () => {
      expect(classifyShiftCard(3, 3, 'Manual')).toBe('pending-manual');
    });

    it('returns pending-manual past idx === aiCount', () => {
      expect(classifyShiftCard(5, 3, 'Manual')).toBe('pending-manual');
    });

    it('returns pending-manual for a blank draft (shiftBlock === "")', () => {
      expect(classifyShiftCard(3, 3, '')).toBe('pending-manual');
    });

    it('returns pending-manual for a null shiftBlock past aiCount', () => {
      expect(classifyShiftCard(3, 3, null)).toBe('pending-manual');
    });

    it('returns pending-manual for an undefined shiftBlock past aiCount', () => {
      expect(classifyShiftCard(3, 3, undefined)).toBe('pending-manual');
    });
  });

  describe('aiCount === 0', () => {
    it('returns pending-manual for any idx when there are no AI shifts', () => {
      expect(classifyShiftCard(0, 0, '')).toBe('pending-manual');
      expect(classifyShiftCard(0, 0, 'Manual')).toBe('pending-manual');
      expect(classifyShiftCard(1, 0, null)).toBe('pending-manual');
    });
  });
});

type SimShift = { employeeId: string; startTime: string; endTime: string; shiftBlock: string };
type SimUndoEntry =
  | { kind: 'remove-ai'; idx: number }
  | { kind: 'remove-manual'; shift: SimShift; insertIdx: number; wasPersisted: boolean };
type SimState = { excluded: Set<number>; manual: SimShift[] };

function applySim(
  state: SimState,
  entry: SimUndoEntry,
  direction: 'undo' | 'redo',
): { state: SimState; inverse: SimUndoEntry } {
  if (entry.kind === 'remove-ai') {
    const next = new Set(state.excluded);
    if (direction === 'undo') next.delete(entry.idx);
    else next.add(entry.idx);
    return { state: { ...state, excluded: next }, inverse: { kind: 'remove-ai', idx: entry.idx } };
  }
  if (direction === 'undo') {
    return { state: { ...state, manual: [...state.manual, entry.shift] }, inverse: entry };
  }
  const matchKey = `${entry.shift.employeeId}:${entry.shift.startTime}:${entry.shift.endTime}`;
  return {
    state: {
      ...state,
      manual: state.manual.filter(
        (s) => `${s.employeeId}:${s.startTime}:${s.endTime}` !== matchKey,
      ),
    },
    inverse: entry,
  };
}

describe('undo dispatcher', () => {
  it('undo of remove-ai clears the idx from excludedIdxs', () => {
    const state: SimState = { excluded: new Set([2]), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 2 }, 'undo');
    expect(after.excluded.has(2)).toBe(false);
  });

  it('undo of remove-ai leaves other excluded indexes alone', () => {
    const state: SimState = { excluded: new Set([1, 2, 5]), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 2 }, 'undo');
    expect(after.excluded.has(1)).toBe(true);
    expect(after.excluded.has(5)).toBe(true);
    expect(after.excluded.has(2)).toBe(false);
  });

  it('undo of remove-manual re-inserts the shift', () => {
    const shift: SimShift = { employeeId: 'u1', startTime: '09:00', endTime: '17:00', shiftBlock: 'Manual' };
    const state: SimState = { excluded: new Set(), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-manual', shift, insertIdx: 3, wasPersisted: false }, 'undo');
    expect(after.manual).toHaveLength(1);
    expect(after.manual[0]).toEqual(shift);
  });

  it('preserves wasPersisted flag through the round trip', () => {
    const shift: SimShift = { employeeId: 'u2', startTime: '10:00', endTime: '14:00', shiftBlock: 'Manual' };
    const entry: SimUndoEntry = { kind: 'remove-manual', shift, insertIdx: 1, wasPersisted: true };
    const state: SimState = { excluded: new Set(), manual: [] };
    const { inverse } = applySim(state, entry, 'undo');
    expect(inverse.kind).toBe('remove-manual');
    if (inverse.kind === 'remove-manual') {
      expect(inverse.wasPersisted).toBe(true);
      expect(inverse.shift.employeeId).toBe('u2');
    }
  });
});

describe('redo dispatcher', () => {
  it('redo of remove-ai re-adds the idx to excludedIdxs', () => {
    const state: SimState = { excluded: new Set(), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 7 }, 'redo');
    expect(after.excluded.has(7)).toBe(true);
  });

  it('redo of remove-ai is idempotent if the idx is already excluded', () => {
    const state: SimState = { excluded: new Set([3]), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 3 }, 'redo');
    expect(after.excluded.has(3)).toBe(true);
    expect(after.excluded.size).toBe(1);
  });

  it('redo of remove-manual filters the shift back out', () => {
    const shift: SimShift = { employeeId: 'u3', startTime: '12:00', endTime: '20:00', shiftBlock: '' };
    const state: SimState = { excluded: new Set(), manual: [shift] };
    const { state: after } = applySim(state, { kind: 'remove-manual', shift, insertIdx: 0, wasPersisted: false }, 'redo');
    expect(after.manual).toHaveLength(0);
  });

  it('full undo→redo cycle on remove-ai restores then re-removes', () => {
    let state: SimState = { excluded: new Set([5]), manual: [] };
    const entry: SimUndoEntry = { kind: 'remove-ai', idx: 5 };
    const undoStep = applySim(state, entry, 'undo');
    state = undoStep.state;
    expect(state.excluded.has(5)).toBe(false);
    const redoStep = applySim(state, undoStep.inverse, 'redo');
    state = redoStep.state;
    expect(state.excluded.has(5)).toBe(true);
  });

  it('full undo→redo cycle on remove-manual restores then re-removes', () => {
    const shift: SimShift = { employeeId: 'u4', startTime: '08:00', endTime: '16:00', shiftBlock: 'Manual' };
    let state: SimState = { excluded: new Set(), manual: [] };
    const entry: SimUndoEntry = { kind: 'remove-manual', shift, insertIdx: 2, wasPersisted: true };
    const undoStep = applySim(state, entry, 'undo');
    state = undoStep.state;
    expect(state.manual).toHaveLength(1);
    const redoStep = applySim(state, undoStep.inverse, 'redo');
    state = redoStep.state;
    expect(state.manual).toHaveLength(0);
  });
});

describe('actual-delete undo recreate payload', () => {
  // Mirrors the closure in deleteActualMutation.onSuccess that captures the
  // original Schedule and re-POSTs it via recreateScheduleMutation. The test
  // records what arguments would be passed to the mutation when the user
  // clicks the toast Undo action.
  type ScheduleLike = {
    id: string;
    userId: string;
    startTime: string;
    endTime: string;
    title: string | null;
    locationId: string | null;
    description: string | null;
  };

  function buildRecreatePayload(original: ScheduleLike) {
    return {
      userId: original.userId,
      startTime: new Date(original.startTime),
      endTime: new Date(original.endTime),
      title: original.title ?? null,
      locationId: original.locationId ?? null,
      description: original.description ?? null,
    };
  }

  it('captures all fields needed to recreate the schedule on undo', () => {
    const original: ScheduleLike = {
      id: 'sched-1',
      userId: 'user-abc',
      startTime: '2026-04-26T17:00:00.000Z',
      endTime: '2026-04-27T01:00:00.000Z',
      title: 'Closing shift',
      locationId: 'loc-store-A',
      description: 'Cover for Sam',
    };
    const recreate = vi.fn();
    recreate(buildRecreatePayload(original));
    expect(recreate).toHaveBeenCalledTimes(1);
    const payload = recreate.mock.calls[0][0];
    expect(payload.userId).toBe('user-abc');
    expect(payload.startTime).toBeInstanceOf(Date);
    expect(payload.endTime).toBeInstanceOf(Date);
    expect(payload.startTime.toISOString()).toBe('2026-04-26T17:00:00.000Z');
    expect(payload.endTime.toISOString()).toBe('2026-04-27T01:00:00.000Z');
    expect(payload.title).toBe('Closing shift');
    expect(payload.locationId).toBe('loc-store-A');
    expect(payload.description).toBe('Cover for Sam');
  });

  it('coerces missing optional fields to null', () => {
    const original: ScheduleLike = {
      id: 'sched-2',
      userId: 'user-xyz',
      startTime: '2026-04-26T09:00:00.000Z',
      endTime: '2026-04-26T13:00:00.000Z',
      title: null,
      locationId: null,
      description: null,
    };
    const payload = buildRecreatePayload(original);
    expect(payload.title).toBeNull();
    expect(payload.locationId).toBeNull();
    expect(payload.description).toBeNull();
  });

  it('does not include the original schedule id (POST creates a fresh row)', () => {
    const original: ScheduleLike = {
      id: 'sched-3',
      userId: 'u',
      startTime: '2026-04-26T09:00:00.000Z',
      endTime: '2026-04-26T13:00:00.000Z',
      title: null, locationId: null, description: null,
    };
    const payload = buildRecreatePayload(original);
    expect(payload).not.toHaveProperty('id');
  });
});

describe('manual delete uses index-based splice', () => {
  // Two manual shifts that share the same employee/start/end (e.g. a
  // duplicate created by mistake or by paste). Old key-based filter would
  // remove BOTH on a single click. New splice removes exactly the clicked
  // one.
  function spliceManual(prev: SimShift[], manualIdx: number): SimShift[] {
    if (manualIdx < 0 || manualIdx >= prev.length) return prev;
    const next = [...prev];
    next.splice(manualIdx, 1);
    return next;
  }

  const dup: SimShift = { employeeId: 'u1', startTime: '09:00', endTime: '17:00', shiftBlock: 'Manual' };
  const second: SimShift = { employeeId: 'u1', startTime: '09:00', endTime: '17:00', shiftBlock: 'Manual' };
  const third: SimShift = { employeeId: 'u2', startTime: '12:00', endTime: '18:00', shiftBlock: 'Manual' };

  it('removes only the clicked duplicate at index 0', () => {
    const after = spliceManual([dup, second, third], 0);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(second);
    expect(after[1]).toBe(third);
  });

  it('removes only the clicked duplicate at index 1', () => {
    const after = spliceManual([dup, second, third], 1);
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(dup);
    expect(after[1]).toBe(third);
  });

  it('is a no-op if manualIdx is out of bounds', () => {
    const before: SimShift[] = [dup, second];
    const after = spliceManual(before, 5);
    expect(after).toBe(before);
    expect(after).toHaveLength(2);
  });

  it('is a no-op for negative indexes (persisted-manual case where idx < aiCount)', () => {
    const before: SimShift[] = [dup, second];
    const after = spliceManual(before, -1);
    expect(after).toBe(before);
  });
});
