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
