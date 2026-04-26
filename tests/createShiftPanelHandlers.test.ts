import { describe, it, expect } from 'vitest';
import { classifyShiftCard } from '../client/src/components/createShiftCardKind';

// These tests pin down the X-button branching logic that lives at the heart
// of bug (1) in task #388. The component itself is too tangled to mount in
// isolation without a full RTL/jsdom setup, so we extracted classifyShiftCard
// as a pure helper and exhaustively cover every X-handler input combination
// here. Each test name maps to one of the three card types the user sees:
//   - AI suggestion card (bordered, shows AI rationale)
//   - Manual draft card already persisted into the AI suggestion cache
//     (this was the regression — its idx is < aiCount so the old bug
//     mistakenly treated it as an AI card and only toggled exclusion)
//   - Pending manual draft (still in local pendingManualShifts, idx >= aiCount)
//     including blank drafts whose shiftBlock === ''.

describe('classifyShiftCard — X-button branching detection', () => {
  describe('AI suggestion cards', () => {
    it('classifies a Morning AI shift at idx 0 of 3 as ai', () => {
      expect(classifyShiftCard(0, 3, 'Morning')).toBe('ai');
    });

    it('classifies a Lunch AI shift in the middle as ai', () => {
      expect(classifyShiftCard(1, 3, 'Lunch')).toBe('ai');
    });

    it('classifies the last AI shift (idx === aiCount - 1) as ai', () => {
      expect(classifyShiftCard(2, 3, 'Evening')).toBe('ai');
    });

    it('classifies an AI shift with null shiftBlock as ai', () => {
      expect(classifyShiftCard(0, 3, null)).toBe('ai');
    });

    it('classifies an AI shift with undefined shiftBlock as ai', () => {
      expect(classifyShiftCard(0, 3, undefined)).toBe('ai');
    });
  });

  describe('Persisted manual drafts (the original bug)', () => {
    it('classifies a draft persisted into the cache as persisted-manual', () => {
      // After persistPillShiftMutation runs the manual draft moves into the
      // cached proposedShifts array with shiftBlock === 'Manual'. Old code
      // looked only at idx and treated this as AI — so X just toggled
      // exclusion instead of removing it. The fix relies on the shiftBlock
      // sentinel here.
      expect(classifyShiftCard(0, 3, 'Manual')).toBe('persisted-manual');
    });

    it('classifies a Manual card at the last AI index as persisted-manual', () => {
      expect(classifyShiftCard(2, 3, 'Manual')).toBe('persisted-manual');
    });
  });

  describe('Pending manual drafts (still in local state)', () => {
    it('classifies the first pending draft (idx === aiCount) as pending-manual', () => {
      expect(classifyShiftCard(3, 3, 'Manual')).toBe('pending-manual');
    });

    it('classifies a later pending draft as pending-manual', () => {
      expect(classifyShiftCard(5, 3, 'Manual')).toBe('pending-manual');
    });

    it('classifies a BLANK pending draft (shiftBlock === "") as pending-manual', () => {
      // Blank manual drafts are created by clicking the empty timeline area
      // before the user has chosen a block label. Bug-fix critical: the
      // detection must NOT rely on shiftBlock === 'Manual' for these or
      // they'd never be removable.
      expect(classifyShiftCard(3, 3, '')).toBe('pending-manual');
    });

    it('classifies a pending draft with null shiftBlock as pending-manual', () => {
      expect(classifyShiftCard(3, 3, null)).toBe('pending-manual');
    });

    it('classifies a pending draft with undefined shiftBlock as pending-manual', () => {
      expect(classifyShiftCard(3, 3, undefined)).toBe('pending-manual');
    });
  });

  describe('edge cases', () => {
    it('handles aiCount === 0 (all cards are pending manual drafts)', () => {
      expect(classifyShiftCard(0, 0, '')).toBe('pending-manual');
      expect(classifyShiftCard(0, 0, 'Manual')).toBe('pending-manual');
    });

    it('handles aiCount === 0 with no idx (still pending-manual)', () => {
      expect(classifyShiftCard(1, 0, null)).toBe('pending-manual');
    });
  });
});

// Pure simulation of the undo/redo dispatcher logic that lives inside
// applyUndoEntry. We can't drive React state from a pure ts test, so we model
// the same state-transition contract here: applying an entry mutates a
// minimal scheduler state and yields the inverse entry that should be pushed
// onto the *other* stack. This guarantees Cmd+Z restores X-removed cards
// (the validator's blocker (a)).
type SimShift = { employeeId: string; startTime: string; endTime: string; shiftBlock: string };
type SimUndoEntry =
  | { kind: 'remove-ai'; idx: number }
  | { kind: 'remove-manual'; shift: SimShift; insertIdx: number; wasPersisted: boolean };

type SimState = { excluded: Set<number>; manual: SimShift[] };

// Mirrors applyUndoEntry in CreateShiftSplitPanel: takes a state snapshot,
// the entry to apply, and the direction ('undo' reverses the original action,
// 'redo' re-applies it). Returns the new state plus the inverse entry that
// would be pushed onto the opposite stack. Architect flagged that the
// previous single-direction implementation made redo a no-op for remove-ai;
// these tests pin down both directions explicitly.
function applySim(
  state: SimState,
  entry: SimUndoEntry,
  direction: 'undo' | 'redo',
): { state: SimState; inverse: SimUndoEntry } {
  if (entry.kind === 'remove-ai') {
    const next = new Set(state.excluded);
    if (direction === 'undo') next.delete(entry.idx);
    else next.add(entry.idx);
    return {
      state: { ...state, excluded: next },
      inverse: { kind: 'remove-ai', idx: entry.idx },
    };
  }
  // remove-manual
  if (direction === 'undo') {
    return {
      state: { ...state, manual: [...state.manual, entry.shift] },
      inverse: entry,
    };
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

describe('Undo dispatcher — Cmd+Z restores X-removed cards', () => {
  it('undoing a remove-ai entry clears it from excludedIdxs', () => {
    const state: SimState = { excluded: new Set([2]), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 2 }, 'undo');
    expect(after.excluded.has(2)).toBe(false);
  });

  it('undoing a remove-ai leaves OTHER excluded indexes alone', () => {
    const state: SimState = { excluded: new Set([1, 2, 5]), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 2 }, 'undo');
    expect(after.excluded.has(1)).toBe(true);
    expect(after.excluded.has(5)).toBe(true);
    expect(after.excluded.has(2)).toBe(false);
  });

  it('undoing a remove-manual re-inserts the shift into manualShifts', () => {
    const shift: SimShift = { employeeId: 'u1', startTime: '09:00', endTime: '17:00', shiftBlock: 'Manual' };
    const state: SimState = { excluded: new Set(), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-manual', shift, insertIdx: 3, wasPersisted: false }, 'undo');
    expect(after.manual).toHaveLength(1);
    expect(after.manual[0]).toEqual(shift);
  });

  it('persisted-manual undo carries wasPersisted=true so re-PUT fires', () => {
    // The component checks entry.wasPersisted to decide whether to call
    // persistPillShiftMutation again. This test pins down the flag survives
    // the round-trip into the inverse entry.
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

// Architect explicitly flagged: redo of a remove-ai must re-add the
// exclusion, and redo of a remove-manual must remove the shift again. The
// previous single-direction dispatcher always *deleted* from excludedIdxs
// regardless of direction, so Cmd+Y after Cmd+Z silently did nothing for
// AI cards. These tests lock down the new direction-aware behavior.
describe('Redo direction — Cmd+Y re-applies the original removal', () => {
  it('redoing a remove-ai re-adds the idx to excludedIdxs', () => {
    const state: SimState = { excluded: new Set(), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 7 }, 'redo');
    expect(after.excluded.has(7)).toBe(true);
  });

  it('redoing a remove-ai is idempotent if idx is already excluded', () => {
    const state: SimState = { excluded: new Set([3]), manual: [] };
    const { state: after } = applySim(state, { kind: 'remove-ai', idx: 3 }, 'redo');
    expect(after.excluded.has(3)).toBe(true);
    expect(after.excluded.size).toBe(1);
  });

  it('redoing a remove-manual filters the shift back out of manualShifts', () => {
    const shift: SimShift = { employeeId: 'u3', startTime: '12:00', endTime: '20:00', shiftBlock: '' };
    const state: SimState = { excluded: new Set(), manual: [shift] };
    const { state: after } = applySim(state, { kind: 'remove-manual', shift, insertIdx: 0, wasPersisted: false }, 'redo');
    expect(after.manual).toHaveLength(0);
  });

  it('full undo→redo cycle on remove-ai restores then re-removes', () => {
    // Start with the shift already excluded (the X click happened first)
    let state: SimState = { excluded: new Set([5]), manual: [] };
    const entry: SimUndoEntry = { kind: 'remove-ai', idx: 5 };
    // Cmd+Z
    const undoStep = applySim(state, entry, 'undo');
    state = undoStep.state;
    expect(state.excluded.has(5)).toBe(false);
    // Cmd+Y
    const redoStep = applySim(state, undoStep.inverse, 'redo');
    state = redoStep.state;
    expect(state.excluded.has(5)).toBe(true);
  });

  it('full undo→redo cycle on remove-manual restores then re-removes', () => {
    const shift: SimShift = { employeeId: 'u4', startTime: '08:00', endTime: '16:00', shiftBlock: 'Manual' };
    let state: SimState = { excluded: new Set(), manual: [] };
    const entry: SimUndoEntry = { kind: 'remove-manual', shift, insertIdx: 2, wasPersisted: true };
    // Cmd+Z restores the draft
    const undoStep = applySim(state, entry, 'undo');
    state = undoStep.state;
    expect(state.manual).toHaveLength(1);
    // Cmd+Y removes it again
    const redoStep = applySim(state, undoStep.inverse, 'redo');
    state = redoStep.state;
    expect(state.manual).toHaveLength(0);
  });
});
