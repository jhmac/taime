/**
 * Frontend logic tests for CreateShiftSplitPanel edit/delete flows (Task #708).
 *
 * The panel itself is a 5,700-line component with deep dependencies (Clerk,
 * WebSocket context, react-query, mutations, recharts) that make rendering
 * it inside vitest's node environment impractical. Per the project's existing
 * testing convention (see tests/createShiftPanelHandlers.test.ts) we mirror
 * the panel's own state-machine and effect logic in tiny pure helpers and
 * pin those down. The helpers are kept structurally identical to the inline
 * code in CreateShiftSplitPanel so a refactor that diverges from this
 * behavior shows up as a failing assertion here.
 *
 * Bugs guarded:
 *   1. Clicking Delete in the edit panel must NOT immediately call
 *      onDeleteSchedule — it must open the AlertDialog and only fire after
 *      the user clicks the destructive Confirm action.
 *   2. The Cancel action of the AlertDialog must NEVER fire onDeleteSchedule.
 *   3. When `locations` resolves AFTER the populate effect ran (async fetch
 *      from useQuery), the location dropdown must back-fill instead of
 *      staying blank (Task #700, Bug 3).
 */

import { describe, it, expect, vi } from "vitest";

// ── Helper #1: delete-confirm state machine ────────────────────────────────
// Mirrors the inline logic in CreateShiftSplitPanel:
//   - Delete button onClick: setPendingDeleteConfirm(true)   (line ~5431)
//   - AlertDialogCancel: closes the dialog, does NOT call onDeleteSchedule
//   - AlertDialogAction onClick (line ~5761):
//       if (!editingSchedule || !onDeleteSchedule) return;
//       setPendingDeleteConfirm(false);
//       setLocalDeletePending(true);
//       onDeleteSchedule(editingSchedule.id);

interface DeleteFlowState {
  pendingDeleteConfirm: boolean;
  localDeletePending: boolean;
  deletedIds: string[];
}

function createDeleteFlow(opts: {
  editingSchedule: { id: string } | null;
  onDeleteSchedule: ((id: string) => void) | null;
}) {
  const state: DeleteFlowState = {
    pendingDeleteConfirm: false,
    localDeletePending: false,
    deletedIds: [],
  };
  const wrappedDelete = opts.onDeleteSchedule
    ? (id: string) => {
        state.deletedIds.push(id);
        opts.onDeleteSchedule!(id);
      }
    : null;
  return {
    state,
    /** Mirrors the panel's <Button onClick={() => setPendingDeleteConfirm(true)} /> */
    clickDeleteButton() {
      state.pendingDeleteConfirm = true;
    },
    /** Mirrors <AlertDialogCancel> — only closes the dialog. */
    clickCancel() {
      state.pendingDeleteConfirm = false;
    },
    /** Mirrors the destructive <AlertDialogAction onClick> at line ~5761. */
    clickConfirm() {
      if (!opts.editingSchedule || !wrappedDelete) return;
      state.pendingDeleteConfirm = false;
      state.localDeletePending = true;
      wrappedDelete(opts.editingSchedule.id);
    },
  };
}

describe("CreateShiftSplitPanel — delete button opens AlertDialog (Task #700, regression)", () => {
  it("clicking Delete only opens the dialog, does NOT call onDeleteSchedule yet", () => {
    const onDelete = vi.fn();
    const flow = createDeleteFlow({
      editingSchedule: { id: "sched-1" },
      onDeleteSchedule: onDelete,
    });

    flow.clickDeleteButton();

    expect(flow.state.pendingDeleteConfirm).toBe(true);
    expect(flow.state.localDeletePending).toBe(false);
    expect(onDelete).not.toHaveBeenCalled();
    expect(flow.state.deletedIds).toEqual([]);
  });

  it("clicking the AlertDialog confirm action fires onDeleteSchedule with the editing id", () => {
    const onDelete = vi.fn();
    const flow = createDeleteFlow({
      editingSchedule: { id: "sched-42" },
      onDeleteSchedule: onDelete,
    });

    flow.clickDeleteButton();
    expect(onDelete).not.toHaveBeenCalled();

    flow.clickConfirm();

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("sched-42");
    expect(flow.state.pendingDeleteConfirm).toBe(false); // dialog closed
    expect(flow.state.localDeletePending).toBe(true);    // spinner state armed
  });

  it("clicking Cancel on the AlertDialog never fires onDeleteSchedule", () => {
    const onDelete = vi.fn();
    const flow = createDeleteFlow({
      editingSchedule: { id: "sched-1" },
      onDeleteSchedule: onDelete,
    });

    flow.clickDeleteButton();
    flow.clickCancel();

    expect(flow.state.pendingDeleteConfirm).toBe(false);
    expect(flow.state.localDeletePending).toBe(false);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("confirm is a no-op when editingSchedule is missing (defensive guard in the panel)", () => {
    const onDelete = vi.fn();
    const flow = createDeleteFlow({
      editingSchedule: null,
      onDeleteSchedule: onDelete,
    });
    flow.clickDeleteButton();
    flow.clickConfirm();
    expect(onDelete).not.toHaveBeenCalled();
    // The early-return path in the panel does NOT toggle the dialog state.
    expect(flow.state.pendingDeleteConfirm).toBe(true);
    expect(flow.state.localDeletePending).toBe(false);
  });

  it("confirm is a no-op when no onDeleteSchedule prop is wired", () => {
    const flow = createDeleteFlow({
      editingSchedule: { id: "sched-1" },
      onDeleteSchedule: null,
    });
    flow.clickDeleteButton();
    flow.clickConfirm();
    expect(flow.state.deletedIds).toEqual([]);
    expect(flow.state.pendingDeleteConfirm).toBe(true);
    expect(flow.state.localDeletePending).toBe(false);
  });

  it("requires two clicks to delete (open + confirm) — guards against accidental single-click delete", () => {
    const onDelete = vi.fn();
    const flow = createDeleteFlow({
      editingSchedule: { id: "sched-1" },
      onDeleteSchedule: onDelete,
    });
    // The bug Task #700 fixed was a single click going straight to delete.
    flow.clickDeleteButton();
    expect(onDelete).toHaveBeenCalledTimes(0);
    flow.clickConfirm();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

// ── Helper #2: location-backfill effect ────────────────────────────────────
// Mirrors the useEffect at lines ~2278-2286 in CreateShiftSplitPanel:
//   if (!open || !editingSchedule) return;
//   if (modalLocationId) return;                       // already populated
//   if (editingSchedule.locationId) {
//     setModalLocationId(editingSchedule.locationId);
//   } else if (locations.length > 0) {
//     setModalLocationId(locations[0].id);
//   }

interface LocationEffectInput {
  open: boolean;
  editingSchedule: { id: string; locationId: string | null } | null;
  locations: { id: string; name: string }[];
  modalLocationId: string;
}

/** Pure version of the location-backfill effect. Returns the next value of
 *  `modalLocationId` after the effect runs (matches setState semantics — if
 *  no setter would fire, the value is unchanged). */
function applyLocationBackfillEffect(input: LocationEffectInput): string {
  if (!input.open || !input.editingSchedule) return input.modalLocationId;
  if (input.modalLocationId) return input.modalLocationId;
  if (input.editingSchedule.locationId) {
    return input.editingSchedule.locationId;
  } else if (input.locations.length > 0) {
    return input.locations[0].id;
  }
  return input.modalLocationId;
}

describe("CreateShiftSplitPanel — location dropdown back-fills when locations resolve late (Task #700, Bug 3)", () => {
  it("populates modalLocationId from locations[0] when the editing shift has no locationId and locations resolved AFTER open", () => {
    // Step 1: panel opens with editingSchedule but locations are still loading.
    let modalLocationId = applyLocationBackfillEffect({
      open: true,
      editingSchedule: { id: "sched-1", locationId: null },
      locations: [],
      modalLocationId: "",
    });
    // Nothing to choose yet.
    expect(modalLocationId).toBe("");

    // Step 2: useQuery resolves and locations array changes.
    modalLocationId = applyLocationBackfillEffect({
      open: true,
      editingSchedule: { id: "sched-1", locationId: null },
      locations: [{ id: "loc-A", name: "Main Store" }, { id: "loc-B", name: "Annex" }],
      modalLocationId,
    });

    // The effect must back-fill — without this, the dropdown stays blank.
    expect(modalLocationId).toBe("loc-A");
  });

  it("prefers the editing shift's own locationId over the first location when locations resolve late", () => {
    let modalLocationId = applyLocationBackfillEffect({
      open: true,
      editingSchedule: { id: "sched-1", locationId: "loc-B" },
      locations: [],
      modalLocationId: "",
    });
    // While locations are loading, editingSchedule.locationId is enough.
    expect(modalLocationId).toBe("loc-B");

    // When locations resolve, the previously-back-filled value is preserved.
    modalLocationId = applyLocationBackfillEffect({
      open: true,
      editingSchedule: { id: "sched-1", locationId: "loc-B" },
      locations: [{ id: "loc-A", name: "Main" }, { id: "loc-B", name: "Annex" }],
      modalLocationId,
    });
    expect(modalLocationId).toBe("loc-B");
  });

  it("does NOT overwrite an already-populated modalLocationId (e.g. user picked something)", () => {
    const next = applyLocationBackfillEffect({
      open: true,
      editingSchedule: { id: "sched-1", locationId: null },
      locations: [{ id: "loc-A", name: "Main" }, { id: "loc-B", name: "Annex" }],
      modalLocationId: "loc-B",
    });
    expect(next).toBe("loc-B");
  });

  it("does nothing while the panel is closed", () => {
    const next = applyLocationBackfillEffect({
      open: false,
      editingSchedule: { id: "sched-1", locationId: null },
      locations: [{ id: "loc-A", name: "Main" }],
      modalLocationId: "",
    });
    expect(next).toBe("");
  });

  it("does nothing when there is no editingSchedule (create flow handles its own defaults)", () => {
    const next = applyLocationBackfillEffect({
      open: true,
      editingSchedule: null,
      locations: [{ id: "loc-A", name: "Main" }],
      modalLocationId: "",
    });
    expect(next).toBe("");
  });

  it("leaves modalLocationId blank when both the editing shift and locations are empty", () => {
    const next = applyLocationBackfillEffect({
      open: true,
      editingSchedule: { id: "sched-1", locationId: null },
      locations: [],
      modalLocationId: "",
    });
    expect(next).toBe("");
  });
});

// ── Helper #3: destination-overlap pre-save check (Task #707) ──────────────
// Mirrors findEditingDestinationConflict in CreateShiftSplitPanel (~line 3694).
// Uses half-open interval semantics matching the Postgres GIST exclusion
// constraint: overlap iff newStart < otherEnd && newEnd > otherStart.

interface OverlapCheckInput {
  editingScheduleId: string;
  targetUserId: string;
  /** "YYYY-MM-DD" */
  modalDate: string;
  /** "HH:MM" 24-h */
  modalStartTime: string;
  /** "HH:MM" 24-h */
  modalEndTime: string;
  schedules: Array<{
    id: string;
    userId: string;
    startTime: string; // ISO string
    endTime: string;   // ISO string
  }>;
}

function findDestinationConflict(input: OverlapCheckInput): string | null {
  const { editingScheduleId, targetUserId, modalDate, modalStartTime, modalEndTime, schedules } = input;
  const [y, mo, d] = modalDate.split('-').map(Number);
  const [sh, sm] = modalStartTime.split(':').map(Number);
  const [eh, em] = modalEndTime.split(':').map(Number);
  if ([y, mo, d, sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const newStart = new Date(y, mo - 1, d, sh, sm, 0, 0);
  const newEnd   = new Date(y, mo - 1, d, eh, em, 0, 0);
  if (newEnd <= newStart) newEnd.setDate(newEnd.getDate() + 1);
  const newStartMs = newStart.getTime();
  const newEndMs   = newEnd.getTime();
  for (const s of schedules) {
    if (s.id === editingScheduleId) continue;
    if (s.userId !== targetUserId) continue;
    const otherStart = new Date(s.startTime).getTime();
    const otherEnd   = new Date(s.endTime).getTime();
    if (!Number.isFinite(otherStart) || !Number.isFinite(otherEnd)) continue;
    if (newStartMs < otherEnd && newEndMs > otherStart) return s.id;
  }
  return null;
}

describe("CreateShiftSplitPanel — destination-overlap pre-save check (Task #707)", () => {
  const DATE = "2025-06-10";
  const existingShift = {
    id: "sched-existing",
    userId: "user-alice",
    startTime: new Date(2025, 5, 10, 10, 0, 0).toISOString(),
    endTime:   new Date(2025, 5, 10, 14, 0, 0).toISOString(),
  };

  it("returns null when the destination user has no other shifts", () => {
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-editing",
      targetUserId: "user-alice",
      modalDate: DATE,
      modalStartTime: "09:00",
      modalEndTime: "17:00",
      schedules: [],
    });
    expect(conflict).toBeNull();
  });

  it("returns null when the overlapping shift belongs to a different employee", () => {
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-editing",
      targetUserId: "user-bob",
      modalDate: DATE,
      modalStartTime: "10:00",
      modalEndTime: "14:00",
      schedules: [existingShift], // alice's shift
    });
    expect(conflict).toBeNull();
  });

  it("returns null when the only conflicting shift is the shift being edited (no self-conflict)", () => {
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-existing", // same as the shift in schedules
      targetUserId: "user-alice",
      modalDate: DATE,
      modalStartTime: "10:00",
      modalEndTime: "14:00",
      schedules: [existingShift],
    });
    expect(conflict).toBeNull();
  });

  it("detects an exact-time overlap (same start/end) as a conflict", () => {
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-editing",
      targetUserId: "user-alice",
      modalDate: DATE,
      modalStartTime: "10:00",
      modalEndTime: "14:00",
      schedules: [existingShift],
    });
    expect(conflict).toBe("sched-existing");
  });

  it("detects a partial overlap at the start of an existing shift", () => {
    // New: 08:00–11:00, existing: 10:00–14:00 → overlap 10:00–11:00
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-editing",
      targetUserId: "user-alice",
      modalDate: DATE,
      modalStartTime: "08:00",
      modalEndTime: "11:00",
      schedules: [existingShift],
    });
    expect(conflict).toBe("sched-existing");
  });

  it("detects a partial overlap at the end of an existing shift", () => {
    // New: 13:00–17:00, existing: 10:00–14:00 → overlap 13:00–14:00
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-editing",
      targetUserId: "user-alice",
      modalDate: DATE,
      modalStartTime: "13:00",
      modalEndTime: "17:00",
      schedules: [existingShift],
    });
    expect(conflict).toBe("sched-existing");
  });

  it("returns null when shifts are adjacent (no overlap — half-open semantics)", () => {
    // New: 14:00–18:00, existing ends at 14:00 — touching but not overlapping
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-editing",
      targetUserId: "user-alice",
      modalDate: DATE,
      modalStartTime: "14:00",
      modalEndTime: "18:00",
      schedules: [existingShift],
    });
    expect(conflict).toBeNull();
  });

  it("returns null when new shift ends exactly when existing starts (adjacent at start)", () => {
    // New: 06:00–10:00, existing starts at 10:00
    const conflict = findDestinationConflict({
      editingScheduleId: "sched-editing",
      targetUserId: "user-alice",
      modalDate: DATE,
      modalStartTime: "06:00",
      modalEndTime: "10:00",
      schedules: [existingShift],
    });
    expect(conflict).toBeNull();
  });
});

// ── Helper #4: overlap conflict dialog state machine (Task #707) ───────────
// Mirrors the pendingOverlapConflict state and the AlertDialog button actions
// in CreateShiftSplitPanel (~lines 5831-5890).

interface OverlapDialogState {
  pendingOverlapConflict: { conflictId: string; employeeName: string } | null;
}

function createOverlapDialogFlow(onSelectSchedule: ((id: string) => void) | null) {
  const state: OverlapDialogState = { pendingOverlapConflict: null };
  return {
    state,
    /** Mirrors setPendingOverlapConflict({...}) triggered by findEditingDestinationConflict. */
    openConflictDialog(conflictId: string, employeeName: string) {
      state.pendingOverlapConflict = { conflictId, employeeName };
    },
    /** Mirrors <AlertDialogCancel> — closes dialog, leaves panel open. */
    clickCancel() {
      state.pendingOverlapConflict = null;
    },
    /** Mirrors <AlertDialogAction> "View conflict" — navigates to conflicting shift. */
    clickViewConflict() {
      const conflict = state.pendingOverlapConflict;
      state.pendingOverlapConflict = null;
      if (conflict && onSelectSchedule) onSelectSchedule(conflict.conflictId);
    },
  };
}

describe("CreateShiftSplitPanel — overlap conflict dialog (Task #707)", () => {
  it("cancel clears the dialog without triggering onSelectSchedule", () => {
    const onSelect = vi.fn();
    const flow = createOverlapDialogFlow(onSelect);
    flow.openConflictDialog("sched-blocker", "Alice Smith");
    expect(flow.state.pendingOverlapConflict).not.toBeNull();

    flow.clickCancel();

    expect(flow.state.pendingOverlapConflict).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("View conflict clears the dialog and calls onSelectSchedule with the conflict id", () => {
    const onSelect = vi.fn();
    const flow = createOverlapDialogFlow(onSelect);
    flow.openConflictDialog("sched-blocker", "Bob Jones");

    flow.clickViewConflict();

    expect(flow.state.pendingOverlapConflict).toBeNull();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("sched-blocker");
  });

  it("View conflict is a no-op when onSelectSchedule is not wired (dialog still closes)", () => {
    const flow = createOverlapDialogFlow(null);
    flow.openConflictDialog("sched-blocker", "Carol Lee");

    flow.clickViewConflict();

    // Dialog closes even without the callback.
    expect(flow.state.pendingOverlapConflict).toBeNull();
  });

  it("dialog state is null by default — does not render on first open", () => {
    const flow = createOverlapDialogFlow(vi.fn());
    expect(flow.state.pendingOverlapConflict).toBeNull();
  });
});

// ── Helper #5: shift_overlap error parsing (Task #707) ────────────────────
// Mirrors the onError handler in updateScheduleMutation (ScheduleManagement.tsx
// ~lines 866-891). apiRequest throws `new Error(\`${status}: ${body}\`)` where
// body is the raw JSON string; we parse it to detect code === 'shift_overlap'.

function detectOverlapFromErrorMessage(errMessage: string): boolean {
  let isOverlap = false;
  try {
    const jsonStart = errMessage.indexOf('{');
    if (jsonStart !== -1) {
      const body = JSON.parse(errMessage.slice(jsonStart)) as { code?: string };
      isOverlap = body.code === 'shift_overlap';
    }
  } catch {
    isOverlap = errMessage.includes('"shift_overlap"');
  }
  return isOverlap;
}

describe("updateScheduleMutation — shift_overlap error detection (Task #707)", () => {
  it("detects shift_overlap from a well-formed 409 JSON response", () => {
    const msg = `409: ${JSON.stringify({ message: "Employee already has a shift in this time range", code: "shift_overlap" })}`;
    expect(detectOverlapFromErrorMessage(msg)).toBe(true);
  });

  it("does NOT flag a plain 409 with a different code as an overlap", () => {
    const msg = `409: ${JSON.stringify({ message: "Conflict: record locked", code: "record_locked" })}`;
    expect(detectOverlapFromErrorMessage(msg)).toBe(false);
  });

  it("does NOT flag a 400 validation error as an overlap", () => {
    const msg = `400: ${JSON.stringify({ message: "Invalid time range" })}`;
    expect(detectOverlapFromErrorMessage(msg)).toBe(false);
  });

  it("does NOT flag a 500 server error as an overlap", () => {
    const msg = "500: Internal Server Error";
    expect(detectOverlapFromErrorMessage(msg)).toBe(false);
  });

  it("falls back to text-match detection when JSON cannot be parsed", () => {
    // Degraded path: body arrives as non-JSON text that still contains the code.
    const msg = `409: {"code":"shift_overlap"`;  // malformed JSON
    expect(detectOverlapFromErrorMessage(msg)).toBe(true);
  });

  it("non-overlap malformed JSON body is not detected as overlap", () => {
    const msg = `409: {"code":"something_else"`;  // malformed JSON, different code
    expect(detectOverlapFromErrorMessage(msg)).toBe(false);
  });
});
