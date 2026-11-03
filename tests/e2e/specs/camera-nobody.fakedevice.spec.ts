/**
 * Uses Chrome's built-in fake capture device (synthetic test pattern, no person) instead of the canvas
 * override. Note: Chrome Headless Shell does not support --use-file-for-fake-video-capture
 * (NotFoundError), so real-photo scenes use the canvas camera in helpers.ts.
 */
import { expect, test } from '@playwright/test';
import { endStudy, startStudy, state, uiLogin, USERS } from './helpers';

test('Chrome fake device (no person) never yields FOCUS_ESTIMATED', async ({ page }) => {
  await uiLogin(page, USERS.student2);
  await startStudy(page);
  await page.waitForTimeout(25_000); // > seatedConfirmMs
  await expect(state(page)).not.toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
  // focus-total is the DAY total (may include earlier sessions) → assert no increase during this test
  const focus = async () => Number((await page.getByTestId('focus-total').getAttribute('data-seconds')) ?? '0');
  const before = await focus();
  await page.waitForTimeout(5_000);
  expect((await focus()) - before, 'focus must not accrue').toBe(0);
  await endStudy(page);
});
