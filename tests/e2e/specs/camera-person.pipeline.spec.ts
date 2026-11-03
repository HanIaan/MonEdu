/**
 * Contract v1.1 / requirement 9: analysis must never run on stale frames, and must survive the
 * browser pausing the (hidden) analysis <video>.
 */
import { expect, test } from '@playwright/test';
import { endStudy, installCanvasCamera, startStudy, state, uiLogin, USERS } from './helpers';

test('frozen camera frames (track still live) → UNKNOWN and focus stops accruing', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student2);
  await startStudy(page);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });

  await page.evaluate(() => (window as any).__fakeCam.freeze(true));
  await expect(state(page)).toHaveAttribute('data-state', 'UNKNOWN', { timeout: 20_000 });
  const focusA = Number(await page.getByTestId('focus-total').getAttribute('data-seconds'));
  await page.waitForTimeout(8_000);
  const focusB = Number(await page.getByTestId('focus-total').getAttribute('data-seconds'));
  expect(focusB - focusA, 'focus must not accrue while frames are stale').toBeLessThanOrEqual(1);

  await page.evaluate(() => (window as any).__fakeCam.freeze(false));
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 40_000 });
  await endStudy(page);
  await ctx.close();
});

test('browser pauses the hidden analysis video → engine resumes it, monitoring continues', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student2);
  await startStudy(page);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  const host = page.locator('#sm-analysis-video');
  await expect(host).toBeAttached();
  expect(await host.evaluate((v: HTMLVideoElement) => getComputedStyle(v).display)).not.toBe('none');

  for (let i = 0; i < 3; i++) {
    await host.evaluate((v: HTMLVideoElement) => v.pause());
    await page.waitForTimeout(2_000);
    expect(await host.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  }
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
  await endStudy(page);
  await ctx.close();
});
