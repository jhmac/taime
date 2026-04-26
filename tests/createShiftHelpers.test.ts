import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  timeToMin,
  minsToTime,
  draftKey,
  loadDraft,
  saveDraft,
  clearDraft,
  evictStaleDrafts,
  snapToWindow,
  oneHopNudge,
  computeMargin,
  hasUnsavedChanges,
} from '../client/src/lib/createShiftHelpers';

// ─── Polyfill localStorage for Node test runtime ──────────────────────────────
class MemStorage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}

beforeEach(() => {
  // @ts-expect-error - test polyfill
  globalThis.window = { localStorage: new MemStorage() };
});

afterEach(() => {
  // @ts-expect-error - cleanup
  delete globalThis.window;
});

describe('timeToMin / minsToTime', () => {
  it('round-trips canonical times', () => {
    expect(minsToTime(timeToMin('09:30'))).toBe('09:30');
    expect(minsToTime(timeToMin('00:00'))).toBe('00:00');
    expect(minsToTime(timeToMin('23:45'))).toBe('23:45');
  });
  it('clamps negative input', () => {
    expect(minsToTime(-15)).toBe('00:00');
  });
});

describe('draft persistence', () => {
  it('round-trips a draft', () => {
    saveDraft('store-1', '2025-04-26', 'user-1', {
      modalDate: '2025-04-26',
      modalStartTime: '09:00',
      modalEndTime: '17:00',
      selectedUserId: 'u1',
      modalTitle: 'Opener',
      modalLocationId: 'loc1',
      modalNotes: 'Bring keys',
      manualShifts: [{ employeeId: 'u1' }],
    });
    const loaded = loadDraft('store-1', '2025-04-26', 'user-1');
    expect(loaded?.modalTitle).toBe('Opener');
    expect(loaded?.manualShifts).toHaveLength(1);
    expect(typeof loaded?.savedAt).toBe('string');
  });

  it('uses a namespaced key', () => {
    expect(draftKey('s', 'd', 'u')).toBe('taime:create-shift-draft:s:d:u');
  });

  it('returns null when nothing saved', () => {
    expect(loadDraft('s', 'd', 'u')).toBeNull();
  });

  it('clears a saved draft', () => {
    saveDraft('s', 'd', 'u', {
      modalDate: 'd', modalStartTime: '09:00', modalEndTime: '17:00',
      selectedUserId: '', modalTitle: '', modalLocationId: '', modalNotes: '',
      manualShifts: [],
    });
    clearDraft('s', 'd', 'u');
    expect(loadDraft('s', 'd', 'u')).toBeNull();
  });

  it('evicts stale drafts older than 24h', () => {
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    // Manually plant a stale entry so we don't depend on system clock mocking
    const k = draftKey('s', 'd', 'u');
    // @ts-expect-error - polyfill
    window.localStorage.setItem(k, JSON.stringify({ savedAt: new Date(yesterday).toISOString() }));
    evictStaleDrafts();
    expect(loadDraft('s', 'd', 'u')).toBeNull();
  });

  it('evicts garbage entries that fail JSON.parse', () => {
    // @ts-expect-error - polyfill
    window.localStorage.setItem('taime:create-shift-draft:bad', 'not-json');
    evictStaleDrafts();
    // @ts-expect-error - polyfill
    expect(window.localStorage.getItem('taime:create-shift-draft:bad')).toBeNull();
  });
});

describe('snapToWindow', () => {
  const win = [{ start: '09:00', end: '17:00' }];

  it('snaps a near-start to the window edge', () => {
    const r = snapToWindow('09:10', '13:10', win, 15);
    expect(r.start).toBe('09:00');
    expect(r.end).toBe('13:00'); // dur preserved
    expect(r.snapped).toBe(true);
  });

  it('snaps end to window close when in tolerance', () => {
    const r = snapToWindow('13:00', '16:50', win, 15);
    expect(r.end).toBe('17:00');
    expect(r.snapped).toBe(true);
  });

  it('leaves mid-window placements untouched', () => {
    const r = snapToWindow('11:30', '14:30', win, 15);
    expect(r.start).toBe('11:30');
    expect(r.end).toBe('14:30');
    expect(r.snapped).toBe(false);
  });

  it('does nothing when no windows are provided', () => {
    const r = snapToWindow('09:10', '13:10', [], 15);
    expect(r.snapped).toBe(false);
    expect(r.start).toBe('09:10');
  });

  it('respects tolerance threshold (no snap when far away)', () => {
    const r = snapToWindow('10:00', '14:00', win, 15);
    expect(r.start).toBe('10:00');
    expect(r.snapped).toBe(false);
  });
});

describe('oneHopNudge', () => {
  it('pushes overlapping same-employee shift earlier when room exists', () => {
    // Open 7am-9pm. Dragged 11-15. Other 13-17 (4h). Earlier = 11-4 = 7am, fits.
    const result = oneHopNudge('11:00', '15:00', 'u1', [
      { id: 'a', startTime: '13:00', endTime: '17:00', employeeId: 'u1' },
    ], 7 * 60, 21 * 60);
    expect(result.get('a')).toEqual({ startTime: '07:00', endTime: '11:00' });
  });

  it('pushes later when earlier slot would go before open', () => {
    const result = oneHopNudge('11:00', '15:00', 'u1', [
      { id: 'a', startTime: '13:00', endTime: '17:00', employeeId: 'u1' },
    ], 9 * 60, 21 * 60);
    // openMin=9*60. earlierStart=11-4=7 < 9 → use later: 15..19
    expect(result.get('a')).toEqual({ startTime: '15:00', endTime: '19:00' });
  });

  it('skips shifts for different employees', () => {
    const result = oneHopNudge('11:00', '15:00', 'u1', [
      { id: 'a', startTime: '13:00', endTime: '17:00', employeeId: 'u2' },
    ], 9 * 60, 21 * 60);
    expect(result.size).toBe(0);
  });

  it('skips non-overlapping shifts', () => {
    const result = oneHopNudge('11:00', '15:00', 'u1', [
      { id: 'a', startTime: '15:00', endTime: '17:00', employeeId: 'u1' },
      { id: 'b', startTime: '07:00', endTime: '10:00', employeeId: 'u1' },
    ], 9 * 60, 21 * 60);
    expect(result.size).toBe(0);
  });

  it('omits shifts that cannot fit in either direction', () => {
    // Open 9-21 (12h). dragged 9-21 (12h). Other 10-20 (10h). Earlier: 9-10=-1 fail, later: 21+10=31 > 21 fail.
    const result = oneHopNudge('09:00', '21:00', 'u1', [
      { id: 'a', startTime: '10:00', endTime: '20:00', employeeId: 'u1' },
    ], 9 * 60, 21 * 60);
    expect(result.size).toBe(0);
  });

  it('returns empty when draggedEmployeeId is missing', () => {
    const r = oneHopNudge('11:00', '15:00', null, [
      { id: 'a', startTime: '13:00', endTime: '17:00', employeeId: 'u1' },
    ], 9 * 60, 21 * 60);
    expect(r.size).toBe(0);
  });
});

describe('computeMargin', () => {
  it('uses per-user rate when present', () => {
    const r = computeMargin([
      { employeeId: 'u1', startTime: '09:00', endTime: '17:00' },
    ], { byUser: { u1: 20 } });
    expect(r.totalHours).toBe(8);
    expect(r.totalCost).toBe(160);
    expect(r.perShift[0].rateSource).toBe('user');
  });

  it('falls back to role default when user rate is missing', () => {
    const r = computeMargin([
      { employeeId: 'u1', startTime: '09:00', endTime: '13:00' },
    ], {
      byUser: { u1: null },
      userRoleId: { u1: 'role-1' },
      byRoleDefault: { 'role-1': 18 },
    });
    expect(r.totalCost).toBe(72);
    expect(r.perShift[0].rateSource).toBe('role');
  });

  it('falls back to constant when no rate sources are set', () => {
    const r = computeMargin([
      { employeeId: 'u1', startTime: '09:00', endTime: '11:00' },
    ], { byUser: {}, fallback: 12 });
    expect(r.totalCost).toBe(24);
    expect(r.perShift[0].rateSource).toBe('fallback');
  });

  it('sums multiple shifts', () => {
    const r = computeMargin([
      { employeeId: 'u1', startTime: '09:00', endTime: '13:00' },
      { employeeId: 'u2', startTime: '13:00', endTime: '17:00' },
    ], { byUser: { u1: 15, u2: 20 } });
    expect(r.totalHours).toBe(8);
    expect(r.totalCost).toBe(140); // 4*15 + 4*20
  });

  it('handles cross-midnight shifts', () => {
    const r = computeMargin([
      { employeeId: 'u1', startTime: '22:00', endTime: '02:00' },
    ], { byUser: { u1: 10 } });
    expect(r.totalHours).toBe(4);
    expect(r.totalCost).toBe(40);
  });

  // ── Tier coloring (Task #387 C4) ──
  it('returns tier=unknown when no projectedRevenue is provided', () => {
    const r = computeMargin(
      [{ employeeId: 'u1', startTime: '09:00', endTime: '13:00' }],
      { byUser: { u1: 15 } },
    );
    expect(r.tier).toBe('unknown');
    expect(r.laborPct).toBeNull();
  });

  it('returns tier=green when labor is at or below the target %', () => {
    // 4h * $15 = $60 labor on $400 revenue = 15% (target 25%)
    const r = computeMargin(
      [{ employeeId: 'u1', startTime: '09:00', endTime: '13:00' }],
      { byUser: { u1: 15 }, projectedRevenue: 400, targetLaborPct: 25 },
    );
    expect(r.tier).toBe('green');
    expect(r.laborPct).toBeCloseTo(15, 5);
  });

  it('returns tier=amber when labor exceeds target but stays within +5pp', () => {
    // $60 labor on $200 revenue = 30% (target 25, threshold 25..30)
    const r = computeMargin(
      [{ employeeId: 'u1', startTime: '09:00', endTime: '13:00' }],
      { byUser: { u1: 15 }, projectedRevenue: 200, targetLaborPct: 25 },
    );
    expect(r.tier).toBe('amber');
    expect(r.laborPct).toBeCloseTo(30, 5);
  });

  it('returns tier=red when labor blows past the amber band', () => {
    // $60 labor on $100 revenue = 60% — way over target+5
    const r = computeMargin(
      [{ employeeId: 'u1', startTime: '09:00', endTime: '13:00' }],
      { byUser: { u1: 15 }, projectedRevenue: 100, targetLaborPct: 25 },
    );
    expect(r.tier).toBe('red');
    expect(r.laborPct).toBeCloseTo(60, 5);
  });

  it('returns tier=unknown when revenue is 0 (no signal — divide-by-zero)', () => {
    // Helper treats 0 revenue as "no signal" rather than infinite labor %.
    // The UI hides the % badge in this case so the meter falls back to its
    // neutral styling.
    const r = computeMargin(
      [{ employeeId: 'u1', startTime: '09:00', endTime: '11:00' }],
      { byUser: { u1: 10 }, projectedRevenue: 0, targetLaborPct: 25 },
    );
    expect(r.tier).toBe('unknown');
    expect(r.laborPct).toBeNull();
  });

  it('echoes the targetLaborPct so the UI can label its tooltip', () => {
    const r = computeMargin(
      [{ employeeId: 'u1', startTime: '09:00', endTime: '11:00' }],
      { byUser: { u1: 10 }, projectedRevenue: 100, targetLaborPct: 18 },
    );
    expect(r.targetLaborPct).toBe(18);
  });
});

describe('hasUnsavedChanges', () => {
  it('returns false when nothing is dirty', () => {
    expect(hasUnsavedChanges({
      pendingManualCount: 0, excludedCount: 0, editedCount: 0, formDirty: false,
    })).toBe(false);
  });
  it('flags pending manual drafts', () => {
    expect(hasUnsavedChanges({
      pendingManualCount: 1, excludedCount: 0, editedCount: 0, formDirty: false,
    })).toBe(true);
  });
  it('flags excluded shifts', () => {
    expect(hasUnsavedChanges({
      pendingManualCount: 0, excludedCount: 2, editedCount: 0, formDirty: false,
    })).toBe(true);
  });
  it('flags in-memory edits', () => {
    expect(hasUnsavedChanges({
      pendingManualCount: 0, excludedCount: 0, editedCount: 1, formDirty: false,
    })).toBe(true);
  });
  it('flags form dirty', () => {
    expect(hasUnsavedChanges({
      pendingManualCount: 0, excludedCount: 0, editedCount: 0, formDirty: true,
    })).toBe(true);
  });
});
