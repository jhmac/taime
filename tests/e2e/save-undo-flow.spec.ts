import { test, expect, type BrowserContext, type Page } from '@playwright/test';

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
  const body = await resp.json();
  testUserId = body.userId;
});

async function loginAsTestUser(context: BrowserContext): Promise<void> {
  const response = await context.request.get(
    `${BASE_URL}/api/dev/test-login?userId=${testUserId}&secret=${E2E_SECRET}`,
  );
  expect(response.ok(), `E2E login failed: ${await response.text()}`).toBe(true);
  const body = await response.json();
  expect(body.ok).toBe(true);
}

async function openCreateShiftPanel(page: Page) {
  await page.goto('/schedules');
  const headerAdd = page.locator('button:has-text("Add Shift"), button:has-text("Add shift")');
  await expect(headerAdd.first()).toBeVisible({ timeout: 15_000 });
  await headerAdd.first().click();
  const dialog = page.locator('[role="dialog"][aria-label*="Create Shift"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // Wait for the availability section to populate so the pill is interactable.
  await expect(dialog.locator("text=Who's Available Today")).toBeVisible({ timeout: 15_000 });
  return dialog;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test.describe('CreateShiftSplitPanel — save & undo flows', () => {
  test('saving a manual shift surfaces a toast with Undo that deletes the created schedule', async ({
    page,
    context,
  }) => {
    await loginAsTestUser(context);
    const dialog = await openCreateShiftPanel(page);

    // Capture the schedule grid's shift-card count before the save round-trip
    // so we can assert post-undo the visible grid is back to its starting
    // state (each persisted shift renders a hover-only "Delete shift" button,
    // which gives us a stable, schedule-only selector behind the open panel).
    const gridShiftCards = page.locator('button[title="Delete shift"]');
    const baselineGridCount = await gridShiftCards.count();

    // Add a manual draft via the "Add shift for X" pill — same affordance the
    // existing availability-pills spec exercises. Picks the first available
    // employee so we don't depend on a hard-coded user.
    const addPillBtn = dialog.locator('button[title^="Add shift for"]').first();
    await expect(addPillBtn).toBeVisible({ timeout: 10_000 });
    await addPillBtn.click();

    // Save CTA appears once any active shift is in the timeline. The button
    // text varies ("Save 1 New Shift to Schedule" / "Save 2 New Shifts ...")
    // so match on the prefix and only require that it's enabled.
    const saveBtn = dialog
      .locator('button')
      .filter({ hasText: /Save \d+ New Shift/ })
      .first();
    await expect(saveBtn).toBeVisible({ timeout: 5_000 });
    await expect(saveBtn).toBeEnabled();

    // Capture the apply response so we know exactly which schedule IDs were
    // created and can verify them in /api/schedules afterwards.
    const applyResponsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/ai-scheduling/apply') &&
        resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await saveBtn.click();

    const applyResp = await applyResponsePromise;
    expect(applyResp.ok(), 'POST /api/ai-scheduling/apply should succeed').toBe(true);
    const applyJson = await applyResp.json();
    const createdIds: string[] = Array.isArray(applyJson?.created)
      ? applyJson.created.map((s: { id: string }) => s.id).filter(Boolean)
      : [];
    expect(
      createdIds.length,
      'Apply response should include at least one created schedule for the bulk-undo round-trip',
    ).toBeGreaterThan(0);

    // The success toast is page-level (the panel closes itself on save) and
    // carries the bulk-undo action button via data-testid.
    const undoAction = page.locator('[data-testid="bulk-undo-toast-action"]');
    await expect(undoAction).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Schedule Approved').first()).toBeVisible({
      timeout: 5_000,
    });

    // Sanity-check: the created schedules show up in the grid's data source
    // before we click Undo. Date range is wide so we don't miss off-week saves.
    const beforeUndo = await context.request.get(
      `${BASE_URL}/api/schedules?startDate=${todayIso()}&endDate=${plusDaysIso(60)}`,
    );
    expect(beforeUndo.ok()).toBe(true);
    const beforeIds = new Set(
      ((await beforeUndo.json()) as Array<{ id: string }>).map((s) => s.id),
    );
    for (const id of createdIds) {
      expect(beforeIds.has(id), `created shift ${id} should be present before undo`).toBe(true);
    }

    // Click Undo and wait for the DELETE round-trip to land.
    const deletePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/schedules/bulk') &&
        resp.request().method() === 'DELETE',
      { timeout: 10_000 },
    );
    await undoAction.click();
    const deleteResp = await deletePromise;
    expect(deleteResp.ok(), 'DELETE /api/schedules/bulk should succeed').toBe(true);

    // Follow-up "Undone" toast confirms the panel observed a successful undo.
    await expect(page.locator('text=Undone').first()).toBeVisible({ timeout: 5_000 });

    // Schedule grid (data source) no longer contains the rolled-back IDs.
    const afterUndo = await context.request.get(
      `${BASE_URL}/api/schedules?startDate=${todayIso()}&endDate=${plusDaysIso(60)}`,
    );
    expect(afterUndo.ok()).toBe(true);
    const afterIds = new Set(
      ((await afterUndo.json()) as Array<{ id: string }>).map((s) => s.id),
    );
    for (const id of createdIds) {
      expect(afterIds.has(id), `created shift ${id} should be removed after undo`).toBe(false);
    }

    // Visible schedule grid should also drop back to the baseline shift count
    // once the undo refetch lands. Polled to absorb the async refetchQueries
    // race triggered by the toast action's onClick handler.
    await expect
      .poll(async () => gridShiftCards.count(), { timeout: 10_000 })
      .toBe(baselineGridCount);
  });

  test('closing the panel with pending shifts confirms before discarding', async ({
    page,
    context,
  }) => {
    await loginAsTestUser(context);
    const dialog = await openCreateShiftPanel(page);

    const addPillBtn = dialog.locator('button[title^="Add shift for"]').first();
    await expect(addPillBtn).toBeVisible({ timeout: 10_000 });
    await addPillBtn.click();

    // Confirm the pill switched to "Scheduled" — proxy for "manualShifts has
    // grown" which is what makes the panel dirty.
    await expect(dialog.locator('text=Scheduled').first()).toBeVisible({ timeout: 5_000 });

    // Track the apply route so we can prove Discard never persisted anything.
    let applyCalled = false;
    await page.route('**/api/ai-scheduling/apply', async (route) => {
      applyCalled = true;
      await route.continue();
    });

    // Esc routes through requestClose() which opens the unsaved-changes dialog
    // when dirty. Discard should close the panel without firing the save.
    await page.keyboard.press('Escape');

    const confirmDiscard = page.locator('[data-testid="close-confirm-discard"]');
    await expect(confirmDiscard).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Save changes before closing?')).toBeVisible();

    await confirmDiscard.click();

    await expect(dialog).toBeHidden({ timeout: 5_000 });
    expect(
      applyCalled,
      'Discard should not POST to /api/ai-scheduling/apply',
    ).toBe(false);
  });
});
