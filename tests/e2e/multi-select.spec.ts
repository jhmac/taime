import {
  test,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

const E2E_SECRET = process.env.E2E_TEST_SECRET!;
const BASE_URL = 'http://localhost:5000';

let testUserId: string;

test.beforeAll(async ({ request }) => {
  if (!E2E_SECRET) {
    throw new Error('E2E_TEST_SECRET environment variable is required to run these tests.');
  }
  const resp = await request.get(
    `${BASE_URL}/api/dev/test-setup?secret=${E2E_SECRET}`,
  );
  if (!resp.ok()) {
    throw new Error(`Test setup failed (${resp.status()}): ${await resp.text()}`);
  }
  testUserId = (await resp.json()).userId;
});

async function loginAsTestUser(context: BrowserContext): Promise<void> {
  const response = await context.request.get(
    `${BASE_URL}/api/dev/test-login?userId=${testUserId}&secret=${E2E_SECRET}`,
  );
  expect(response.ok(), `E2E login failed: ${await response.text()}`).toBe(true);
  const body = await response.json();
  expect(body.ok).toBe(true);
}

async function openCreateShiftPanel(page: Page): Promise<Locator> {
  await page.goto('/schedules');
  const headerAdd = page.locator(
    'button:has-text("Add Shift"), button:has-text("Add shift")',
  );
  await expect(headerAdd.first()).toBeVisible({ timeout: 15_000 });
  await headerAdd.first().click();
  const dialog = page.locator('[role="dialog"][aria-label*="Create Shift"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.locator("text=Who's Available Today")).toBeVisible({
    timeout: 15_000,
  });
  return dialog;
}

/** Click N "Add shift for X" pills, one per available employee. Skips the
 *  test (instead of failing) if there aren't enough available employees in
 *  the seed — multi-select is only meaningful with multiple cards. */
async function addNManualShifts(dialog: Locator, n: number): Promise<void> {
  const pillSelector = 'button[title^="Add shift for"]';
  const initialCount = await dialog.locator(pillSelector).count();
  test.skip(
    initialCount < n,
    `Need at least ${n} available-today employees, found ${initialCount}`,
  );
  for (let i = 0; i < n; i++) {
    const btn = dialog.locator(pillSelector).first();
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    // After each click, exactly one pill drops out of the "Add shift" list
    // (its action button becomes "Scheduled"). Counting the remaining pills
    // is more robust than text matching since "Scheduled" appears in
    // multiple sub-components inside the dialog.
    await expect(dialog.locator(pillSelector)).toHaveCount(initialCount - (i + 1), {
      timeout: 10_000,
    });
  }
}

/** Click the bulk Save button, capture the apply response, return the new
 *  schedule IDs. The panel auto-closes on save, so this also waits for that. */
async function saveAndCaptureCreatedIds(
  page: Page,
  dialog: Locator,
): Promise<string[]> {
  const saveBtn = dialog
    .locator('button')
    .filter({ hasText: /Save \d+ New Shift/ })
    .first();
  await expect(saveBtn).toBeVisible({ timeout: 5_000 });
  await expect(saveBtn).toBeEnabled();

  const applyResponsePromise = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/ai-scheduling/apply') &&
      resp.request().method() === 'POST',
    { timeout: 15_000 },
  );

  await saveBtn.click();

  const applyResp = await applyResponsePromise;
  expect(applyResp.ok(), 'POST /api/ai-scheduling/apply should succeed').toBe(true);
  const json = await applyResp.json();
  const createdIds: string[] = Array.isArray(json?.created)
    ? json.created.map((s: { id: string }) => s.id).filter(Boolean)
    : [];
  expect(
    createdIds.length,
    'Apply response should include the created schedules',
  ).toBeGreaterThan(0);

  await expect(dialog).toBeHidden({ timeout: 10_000 });
  return createdIds;
}

/** Read the timeline's ordered list of `actual-shift-card-{id}` IDs in
 *  DOM order. This is the same order that `liveActualShifts.map(a =>
 *  a.schedule.id)` produces inside the panel — i.e. the order Shift+Click
 *  range selection uses to compute the slice. Returns the array as well as
 *  a (memoized) helper for looking up an id's position. */
async function readTimelineOrder(
  dialog: Locator,
): Promise<{ ids: string[]; indexOf: (id: string) => number }> {
  const ids = await dialog
    .locator('[data-testid^="actual-shift-card-"]')
    .evaluateAll((els) =>
      els.map((el) =>
        (el as HTMLElement).dataset.testid!.replace('actual-shift-card-', ''),
      ),
    );
  return { ids, indexOf: (id) => ids.indexOf(id) };
}

/** Combined helper: log in, open the panel, add N manual shifts, save,
 *  reopen the panel, and return the freshly-rendered cards in *timeline*
 *  (DOM) order so range tests below can reason about positions correctly. */
async function setupShiftsAndReopenPanel(
  page: Page,
  context: BrowserContext,
  count: number,
): Promise<{
  dialog: Locator;
  createdIds: string[];
  /** createdIds re-sorted into the same order they appear in the timeline. */
  cardsInOrder: { id: string; locator: Locator }[];
  /** Full timeline orderedIds (may include shifts not created by this test). */
  timelineIds: string[];
}> {
  await loginAsTestUser(context);
  const dialog = await openCreateShiftPanel(page);
  await addNManualShifts(dialog, count);
  const createdIds = await saveAndCaptureCreatedIds(page, dialog);

  // Reopen so the saved shifts surface as `actual-shift-card-{id}` cards.
  const reopened = await openCreateShiftPanel(page);
  for (const id of createdIds) {
    await expect(
      reopened.locator(`[data-testid="actual-shift-card-${id}"]`),
    ).toBeVisible({ timeout: 15_000 });
  }

  const { ids: timelineIds } = await readTimelineOrder(reopened);
  const createdSet = new Set(createdIds);
  const cardsInOrder = timelineIds
    .filter((id) => createdSet.has(id))
    .map((id) => ({
      id,
      locator: reopened.locator(`[data-testid="actual-shift-card-${id}"]`),
    }));
  expect(cardsInOrder.length).toBe(createdIds.length);

  return { dialog: reopened, createdIds, cardsInOrder, timelineIds };
}

test.describe('CreateShiftSplitPanel — multi-select interactions', () => {
  // Track shifts created during a test so afterEach can clean up anything
  // that survived (e.g. when an assertion failed before the in-test cleanup
  // step). Each test resets this list at the start.
  let createdIdsForCleanup: string[] = [];

  test.afterEach(async ({ context }) => {
    if (createdIdsForCleanup.length === 0) return;
    try {
      await context.request.delete(`${BASE_URL}/api/schedules/bulk`, {
        data: { ids: createdIdsForCleanup },
      });
    } catch {
      // Best-effort cleanup; never mask a real assertion failure.
    }
    createdIdsForCleanup = [];
  });

  test('Cmd-click multi-selects shift cards, action bar shows count, bulk delete + Undo restores them', async ({
    page,
    context,
  }) => {
    const { cardsInOrder, createdIds } = await setupShiftsAndReopenPanel(
      page,
      context,
      3,
    );
    createdIdsForCleanup = [...createdIds];

    // Snapshot (userId, startTime) of every shift we created so the Undo
    // listener below can match restored rows back to OURS specifically.
    // The apply response only carries IDs, so go through /api/schedules
    // for the rest. This anchors the restore assertion to our exact
    // payloads — unrelated POSTs (e.g. concurrent test bleed-over) can't
    // satisfy the key match.
    const beforeDeleteResp = await context.request.get(`${BASE_URL}/api/schedules`);
    expect(beforeDeleteResp.ok()).toBe(true);
    const beforeDeleteAll = (await beforeDeleteResp.json()) as Array<{
      id: string;
      userId: string;
      startTime: string;
    }>;
    const myShiftKeys = new Set(
      beforeDeleteAll
        .filter((s) => createdIds.includes(s.id))
        .map((s) => `${s.userId}|${s.startTime}`),
    );
    expect(
      myShiftKeys.size,
      'Should have captured one snapshot key per created shift',
    ).toBe(createdIds.length);

    // Cmd+Click and Ctrl+Click both flow through the same 'toggle' branch
    // (`metaKey || ctrlKey` inside `modeFromEvent`). Mix them so this
    // single test exercises both modifier paths — covers Cmd-click on Mac
    // AND Ctrl-click on Windows/Linux.
    await cardsInOrder[0].locator.click({ modifiers: ['Meta'] });
    const actionBar = page.locator('[data-testid="multi-select-action-bar"]');
    await expect(actionBar).toBeVisible({ timeout: 5_000 });
    await expect(actionBar).toContainText('1 shift selected');

    await cardsInOrder[1].locator.click({ modifiers: ['Control'] });
    await expect(actionBar).toContainText('2 shifts selected');

    await cardsInOrder[2].locator.click({ modifiers: ['Meta'] });
    await expect(actionBar).toContainText('3 shifts selected');

    for (const c of cardsInOrder) {
      await expect(c.locator).toHaveAttribute('aria-selected', 'true');
    }

    // Bulk delete — watch the actual /api/schedules/bulk DELETE so we know
    // the round-trip landed before asserting downstream UI changes.
    const deletePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/schedules/bulk') &&
        resp.request().method() === 'DELETE',
      { timeout: 10_000 },
    );
    await page.locator('[data-testid="bulk-delete-button"]').click();
    const deleteResp = await deletePromise;
    expect(deleteResp.ok(), 'DELETE /api/schedules/bulk should succeed').toBe(true);

    await expect(actionBar).toBeHidden({ timeout: 5_000 });
    for (const c of cardsInOrder) {
      await expect(c.locator).toBeHidden({ timeout: 5_000 });
    }

    // Sanity: the deleted IDs are no longer in /api/schedules.
    const afterDelete = await context.request.get(`${BASE_URL}/api/schedules`);
    expect(afterDelete.ok()).toBe(true);
    const afterIds = new Set(
      ((await afterDelete.json()) as Array<{ id: string }>).map((s) => s.id),
    );
    for (const id of createdIds) {
      expect(
        afterIds.has(id),
        `bulk-deleted shift ${id} should be absent from /api/schedules`,
      ).toBe(false);
    }

    // Click Undo on the toast. The panel's handler does sequential POSTs
    // to /api/schedules — one per restored shift — and then a single
    // "Shifts restored" follow-up toast. Tap into the page's response
    // events so we can capture the exact IDs that came back, instead of
    // inferring them from a broad "today" filter (which could match
    // unrelated pre-existing rows in the dev DB).
    const restoredIds: string[] = [];
    const responseListener = async (resp: import('@playwright/test').Response) => {
      if (
        resp.request().method() !== 'POST' ||
        !resp.url().endsWith('/api/schedules') ||
        !resp.ok()
      ) {
        return;
      }
      try {
        const body = (await resp.json()) as {
          id?: unknown;
          userId?: unknown;
          startTime?: unknown;
        };
        if (
          body &&
          typeof body.id === 'string' &&
          typeof body.userId === 'string' &&
          typeof body.startTime === 'string'
        ) {
          // Only count this restore if its (userId, startTime) matches
          // one of the shifts WE deleted. Any unrelated POST that races
          // through during this window is ignored, eliminating capture
          // ambiguity even on a busy shared dev DB.
          const key = `${body.userId}|${body.startTime}`;
          if (myShiftKeys.has(key)) {
            restoredIds.push(body.id);
          }
        }
      } catch {
        // Non-JSON / failed parse — skip; the polled length check below
        // will time out if nothing valid arrives.
      }
    };
    page.on('response', responseListener);

    try {
      const undoAction = page.locator('[data-testid="bulk-delete-undo-action"]');
      await expect(undoAction).toBeVisible({ timeout: 5_000 });
      await undoAction.click();

      // Wait until the panel has reported back exactly N restore POSTs.
      // `toBeGreaterThanOrEqual` (not `toBe`) so the test is resilient if
      // some unrelated POST to /api/schedules races in — we still gate on
      // the specific captured IDs below.
      await expect
        .poll(() => restoredIds.length, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(createdIds.length);
    } finally {
      page.off('response', responseListener);
    }

    await expect(page.locator('text=Shifts restored').first()).toBeVisible({
      timeout: 5_000,
    });

    // Sanity: re-fetch /api/schedules and confirm every captured restore
    // ID is actually present. This anchors the assertion to the specific
    // rows the Undo handler created — pre-existing same-day rows can't
    // satisfy the check.
    const afterUndo = await context.request.get(`${BASE_URL}/api/schedules`);
    expect(afterUndo.ok()).toBe(true);
    const afterUndoIds = new Set(
      ((await afterUndo.json()) as Array<{ id: string }>).map((s) => s.id),
    );
    for (const id of restoredIds) {
      expect(
        afterUndoIds.has(id),
        `Restored shift ${id} should appear in /api/schedules`,
      ).toBe(true);
    }
    expect(
      restoredIds.length,
      'Undo should re-create exactly one row per deleted shift',
    ).toBe(createdIds.length);

    // Cleanup list = ONLY the IDs we actually saw POST responses for.
    // Never inferred from a broad "today" filter — that risked deleting
    // unrelated pre-existing rows owned by other tests or by the user.
    createdIdsForCleanup = restoredIds;
  });

  test('Escape clears the multi-selection first; a second Escape closes the panel', async ({
    page,
    context,
  }) => {
    const { dialog, cardsInOrder, createdIds } = await setupShiftsAndReopenPanel(
      page,
      context,
      2,
    );
    createdIdsForCleanup = [...createdIds];

    await cardsInOrder[0].locator.click({ modifiers: ['Meta'] });
    await cardsInOrder[1].locator.click({ modifiers: ['Meta'] });

    const actionBar = page.locator('[data-testid="multi-select-action-bar"]');
    await expect(actionBar).toBeVisible({ timeout: 5_000 });
    await expect(actionBar).toContainText('2 shifts selected');

    // First Escape — keydown handler clears the selection but stops before
    // requestClose() because the selection set was non-empty.
    await page.keyboard.press('Escape');
    await expect(actionBar).toBeHidden({ timeout: 5_000 });
    await expect(dialog).toBeVisible();

    // Cards should drop the cyan-ring aria-selected flag too.
    for (const c of cardsInOrder) {
      await expect(c.locator).toHaveAttribute('aria-selected', 'false');
    }

    // Second Escape — selection is now empty, so the handler falls through
    // to requestClose(). No dirty state (no manualShifts, no form edits),
    // so the unsaved-changes confirm dialog should NOT appear.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    await expect(
      page.locator('[data-testid="close-confirm-discard"]'),
    ).toBeHidden();
  });

  test('Shift+Click extends a contiguous range from the previously clicked card; Cmd-click advances the anchor', async ({
    page,
    context,
  }) => {
    const { dialog, cardsInOrder, createdIds, timelineIds } =
      await setupShiftsAndReopenPanel(page, context, 4);
    createdIdsForCleanup = [...createdIds];

    const actionBar = page.locator('[data-testid="multi-select-action-bar"]');
    // The range-mode helper computes its slice against the FULL timeline
    // orderedIds, not just our test-created cards. So if the dev DB has
    // other shifts on today wedged between ours, the range will include
    // them too. Compute expected counts dynamically from timeline indices.
    const idxInTimeline = (id: string) => timelineIds.indexOf(id);
    const rangeSize = (a: string, b: string) =>
      Math.abs(idxInTimeline(a) - idxInTimeline(b)) + 1;

    // ── Step A — plain click card 0. Sets the anchor to card 0 and gives
    // single-focus to it, but selection set is still empty so the floating
    // action bar must NOT appear yet.
    await cardsInOrder[0].locator.click();
    await expect(actionBar).toBeHidden();

    // ── Step B — Shift+Click card 2. Range from anchor (card 0) → target
    // (card 2). Inclusive count = |timelineIdx(2) − timelineIdx(0)| + 1.
    const expectedRangeB = rangeSize(cardsInOrder[0].id, cardsInOrder[2].id);
    await cardsInOrder[2].locator.click({ modifiers: ['Shift'] });
    await expect(actionBar).toBeVisible({ timeout: 5_000 });
    await expect(actionBar).toContainText(
      `${expectedRangeB} shift${expectedRangeB === 1 ? '' : 's'} selected`,
    );
    // All three of MY cards in the slice should be selected. (The 4th card
    // — card 3 — was after the Shift+Click target, so it must not be.)
    await expect(cardsInOrder[0].locator).toHaveAttribute('aria-selected', 'true');
    await expect(cardsInOrder[1].locator).toHaveAttribute('aria-selected', 'true');
    await expect(cardsInOrder[2].locator).toHaveAttribute('aria-selected', 'true');
    await expect(cardsInOrder[3].locator).toHaveAttribute('aria-selected', 'false');

    // Reset for the second half — the in-bar Clear button drops both the
    // multi-selection set AND the anchor (`setMultiSelectAnchorId(null)`
    // in the panel's onClick handler).
    await page.locator('[data-testid="clear-selection-button"]').click();
    await expect(actionBar).toBeHidden({ timeout: 5_000 });

    // ── Step C — plain click card 0 again to re-establish anchor=card 0
    // with an empty selection set.
    await cardsInOrder[0].locator.click();
    await expect(actionBar).toBeHidden();

    // ── Step D — Cmd+Click card 1. Toggle mode adds card 1 AND advances
    // the anchor to card 1 (per `if (mode === 'toggle') setMultiSelect-
    // AnchorId(schedule.id)`). Selection size: 1.
    await cardsInOrder[1].locator.click({ modifiers: ['Meta'] });
    await expect(actionBar).toContainText('1 shift selected');

    // ── Step E — Shift+Click card 3 from the new anchor (card 1). Range
    // becomes the slice between timelineIdx(card1) and timelineIdx(card3),
    // merged additively with the existing {card1}. Because card 1 is
    // already in the existing set, the merged size equals the slice size.
    //
    // If the anchor had NOT advanced (still card 0), the slice would have
    // started from timelineIdx(card 0) instead — strictly larger by at
    // least one (card 0 is to the left of card 1 in the timeline). The
    // dynamic assertion below catches that regression.
    const expectedAdvanced = rangeSize(cardsInOrder[1].id, cardsInOrder[3].id);
    const expectedNonAdvanced = rangeSize(cardsInOrder[0].id, cardsInOrder[3].id);
    expect(
      expectedAdvanced,
      'sanity: timeline must place card 0 strictly before card 1',
    ).toBeLessThan(expectedNonAdvanced);

    await cardsInOrder[3].locator.click({ modifiers: ['Shift'] });
    await expect(actionBar).toContainText(
      `${expectedAdvanced} shift${expectedAdvanced === 1 ? '' : 's'} selected`,
    );
    // Card 0 must NOT be selected — that's the strongest single-card proof
    // that the anchor moved (it was the original anchor, but the new range
    // starts from card 1 instead).
    await expect(cardsInOrder[0].locator).toHaveAttribute('aria-selected', 'false');
    await expect(cardsInOrder[1].locator).toHaveAttribute('aria-selected', 'true');
    await expect(cardsInOrder[2].locator).toHaveAttribute('aria-selected', 'true');
    await expect(cardsInOrder[3].locator).toHaveAttribute('aria-selected', 'true');

    // Suppress unused-variable lint for the helper destructure; `dialog`
    // is held only to keep the panel reference live in this scope.
    void dialog;
  });
});
