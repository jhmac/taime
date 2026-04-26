// Pure helper extracted from CreateShiftSplitPanel for unit-testing the
// X-handler card-type detection. Lives in its own .ts file so vitest can
// import it without pulling the JSX-heavy panel module into the test runtime.
//
// Returns one of three card kinds, mirroring the branching inside
// CreateShiftSplitPanel.handleToggleExclude:
//   - 'ai':              AI suggestion (idx < aiCount, shiftBlock !== 'Manual')
//   - 'persisted-manual': Manual draft already PUT into the suggestion cache
//                         (idx < aiCount, shiftBlock === 'Manual')
//   - 'pending-manual':  Manual draft still in local pendingManualShifts
//                         (idx >= aiCount, regardless of shiftBlock value —
//                         catches blank drafts whose shiftBlock === '')
export type ShiftCardKind = 'ai' | 'persisted-manual' | 'pending-manual';

export function classifyShiftCard(
  idx: number,
  aiCount: number,
  shiftBlock: string | null | undefined,
): ShiftCardKind {
  if (idx >= aiCount) return 'pending-manual';
  if (shiftBlock === 'Manual') return 'persisted-manual';
  return 'ai';
}
