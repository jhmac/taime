import { test, expect, type BrowserContext } from '@playwright/test';

const E2E_SECRET = process.env.E2E_TEST_SECRET!;
const BASE_URL = 'http://localhost:5000';

let testUserId: string;

test.beforeAll(async ({ request }) => {
  if (!E2E_SECRET) {
    throw new Error('E2E_TEST_SECRET environment variable is required to run these tests.');
  }
  const resp = await request.get(
    `${BASE_URL}/api/dev/test-setup?secret=${E2E_SECRET}`
  );
  if (!resp.ok()) {
    throw new Error(`Test setup failed (${resp.status()}): ${await resp.text()}`);
  }
  const body = await resp.json();
  testUserId = body.userId;
});

async function loginAsTestUser(context: BrowserContext): Promise<void> {
  const response = await context.request.get(
    `${BASE_URL}/api/dev/test-login?userId=${testUserId}&secret=${E2E_SECRET}`
  );
  expect(response.ok(), `E2E login failed: ${await response.text()}`).toBe(true);
  const body = await response.json();
  expect(body.ok).toBe(true);
}

test.describe('Availability Pills Flow', () => {
  test("Who's Available Today section appears when Create Shift dialog opens", async ({ page, context }) => {
    await loginAsTestUser(context);

    await page.goto('/schedules');

    await expect(page.locator('button:has-text("Add Shift"), button:has-text("Add shift")')).toBeVisible({ timeout: 15_000 });

    await page.click('button:has-text("Add Shift"), button:has-text("Add shift")');

    const dialog = page.locator('[role="dialog"][aria-label*="Create Shift"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await expect(dialog.locator("text=Who's Available Today")).toBeVisible({ timeout: 15_000 });
  });

  test('Clicking "Add shift" on a pill adds that employee to the timeline', async ({ page, context }) => {
    await loginAsTestUser(context);

    await page.goto('/schedules');
    await page.click('button:has-text("Add Shift"), button:has-text("Add shift")');

    const dialog = page.locator('[role="dialog"][aria-label*="Create Shift"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await expect(dialog.locator("text=Who's Available Today")).toBeVisible({ timeout: 15_000 });

    const addShiftBtn = dialog.locator('button[title^="Add shift for"]').first();
    await expect(addShiftBtn).toBeVisible({ timeout: 10_000 });

    const titleAttr = await addShiftBtn.getAttribute('title');
    const employeeName = titleAttr?.replace('Add shift for ', '') ?? '';
    expect(employeeName.length, 'Expected employee name from pill title').toBeGreaterThan(0);

    const timelineBlock = page.locator(`div[title^="${employeeName}:"]`);
    const blocksBefore = await timelineBlock.count();

    await addShiftBtn.click();

    await expect(dialog.locator('text=Scheduled').first()).toBeVisible({ timeout: 5_000 });

    await expect(timelineBlock).toHaveCount(blocksBefore + 1, { timeout: 10_000 });
  });

  test('Changing the date triggers a fresh availability fetch for the new date', async ({ page, context }) => {
    await loginAsTestUser(context);

    await page.goto('/schedules');
    await page.click('button:has-text("Add Shift"), button:has-text("Add shift")');

    const dialog = page.locator('[role="dialog"][aria-label*="Create Shift"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await expect(dialog.locator("text=Who's Available Today")).toBeVisible({ timeout: 15_000 });

    const dateInput = dialog.locator('input[name="startDate"]');
    await expect(dateInput).toBeVisible({ timeout: 5_000 });

    // Compute a date that is guaranteed to differ from whatever the dialog
    // initially defaulted to (today). Otherwise filling the same value would
    // not change the React Query key and no fresh fetch would occur.
    const initialValue = await dateInput.inputValue();
    const baseline = initialValue && /^\d{4}-\d{2}-\d{2}$/.test(initialValue)
      ? new Date(initialValue + 'T00:00:00')
      : new Date();
    const next = new Date(baseline);
    next.setDate(next.getDate() + 1);
    const yyyy = next.getFullYear();
    const mm = String(next.getMonth() + 1).padStart(2, '0');
    const dd = String(next.getDate()).padStart(2, '0');
    const newDate = `${yyyy}-${mm}-${dd}`;
    expect(newDate, 'New date must differ from initial input value').not.toBe(initialValue);

    const capturedDates: string[] = [];
    await page.route('**/api/schedules/today-availability**', async (route) => {
      const url = new URL(route.request().url());
      const date = url.searchParams.get('date');
      if (date) capturedDates.push(date);
      await route.continue();
    });

    const responsePromise = page.waitForResponse(
      (resp) => {
        if (!resp.url().includes('/api/schedules/today-availability')) return false;
        const u = new URL(resp.url());
        return u.searchParams.get('date') === newDate;
      },
      { timeout: 15_000 },
    );

    await dateInput.fill(newDate);

    await responsePromise;

    expect(capturedDates, 'Availability API should be called with the new date').toContain(newDate);

    await expect(dialog.locator("text=Who's Available Today")).toBeVisible({ timeout: 10_000 });
  });
});
