import { expect, test } from '@playwright/test';
import { state, uiLogin, USERS } from './helpers';

test('camera permission denied → clear status, state UNKNOWN, no focus accrues', async ({ page }) => {
  await uiLogin(page, USERS.student3);
  await expect(page).toHaveURL(/\/student/);
  await page.getByTestId('privacy-consent').check();
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('camera-status')).toHaveAttribute('data-status', /denied|unavailable|error/, { timeout: 30_000 });
  await expect(state(page)).toHaveAttribute('data-state', 'UNKNOWN');
  await page.waitForTimeout(3_000);
  // focus-total is the DAY total (may include earlier sessions) → assert no increase during this test
  const focus = async () => Number((await page.getByTestId('focus-total').getAttribute('data-seconds')) ?? '0');
  const before = await focus();
  await page.waitForTimeout(5_000);
  expect((await focus()) - before, 'focus must not accrue').toBe(0);
});
