/** Uses Chrome's own fake capture device (MJPEG file) instead of the canvas override. */
import { expect, test } from '@playwright/test';
import { endStudy, startStudy, state, uiLogin, USERS } from './helpers';

test('empty scene never yields FOCUS_ESTIMATED', async ({ page }) => {
  await uiLogin(page, USERS.student2);
  await startStudy(page);
  await page.waitForTimeout(25_000); // > seatedConfirmMs
  await expect(state(page)).not.toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
  await expect(page.getByTestId('focus-total')).toHaveAttribute('data-seconds', '0');
  await endStudy(page);
});
