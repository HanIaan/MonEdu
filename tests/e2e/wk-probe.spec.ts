import { test } from '@playwright/test';
import { installCanvasCamera, uiLogin, USERS } from './specs/helpers';
test('background window probe', async ({ browser }, info) => {
  const ctx = await browser.newContext();
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student2);
  await page.goto('/student');
  await page.getByTestId('privacy-consent').check();
  await page.getByTestId('start-session').click();
  const snap = async (label: string) => console.log(info.project.name, label, JSON.stringify(await page.evaluate(() => {
    const v = document.getElementById('sm-analysis-video') as HTMLVideoElement | null;
    return { vis: document.visibilityState, focus: document.hasFocus(), state: document.querySelector('[data-testid=current-state]')?.getAttribute('data-state'), vt: v?.currentTime.toFixed(1), now: (performance.now() / 1000).toFixed(1) };
  })));
  await page.waitForTimeout(3000); await snap('t+3 front');
  const other = await (await browser.newContext()).newPage(); await other.goto('/login');
  for (const t of [5, 10, 15, 20, 25, 30]) { await page.waitForTimeout(5000); await snap(`t+${t + 3} behind-other-window`); }
  await other.close(); await page.bringToFront();
  await page.waitForTimeout(20000); await snap('after bringToFront +20');
  await page.getByTestId('end-session').click().catch(() => {});
});
