/**
 * Requirement 11 (contract v1.1): AI detection and time recording behave the same whether the camera
 * preview is shown or hidden; the preview lifecycle never affects the analysis pipeline.
 */
import { expect, test, type Page } from '@playwright/test';
import { endStudy, installCanvasCamera, startStudy, state, uiLogin, USERS } from './helpers';

async function closeFramingIfOpen(page: Page) {
  const done = page.getByTestId('framing-done');
  if (await done.isVisible().catch(() => false)) await done.click();
}

async function seatedThenAway(page: Page) {
  await page.evaluate(() => (window as any).__fakeCam.setScene('person'));
  const t0 = Date.now();
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  const seatedMs = Date.now() - t0;
  await page.evaluate(() => (window as any).__fakeCam.setScene('nobody'));
  const t1 = Date.now();
  await expect(state(page)).toHaveAttribute('data-state', 'AWAY', { timeout: 60_000 });
  return { seatedMs, awayMs: Date.now() - t1 };
}

test('first setup shows framing checks from live detections, then closes', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student2);
  await startStudy(page);
  await expect(page.getByTestId('camera-preview')).toBeVisible();
  await expect(page.getByTestId('framing-body')).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  await page.getByTestId('framing-done').click();
  await expect(page.getByTestId('camera-preview')).toHaveCount(0);
  await endStudy(page);
  await ctx.close();
});

test.setTimeout(420_000);
test('@slow detection + timing identical with preview hidden vs shown; toggling never interrupts analysis', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'nobody');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student2);
  await startStudy(page);
  await closeFramingIfOpen(page);

  // A) preview HIDDEN — no preview video in the DOM, analysis host present and rendered
  await expect(page.getByTestId('camera-preview')).toHaveCount(0);
  await expect(page.locator('#sm-analysis-video')).toBeAttached();
  await expect(page.getByTestId('camera-status')).toHaveAttribute('data-status', 'active');
  // warm-up cycle (first cycle after start includes model warm-up; not compared)
  const warm = await seatedThenAway(page);
  const hidden = await seatedThenAway(page);
  await expect(page.getByTestId('analysis-fps')).not.toHaveAttribute('data-fps', '0');

  // B) preview SHOWN
  await page.getByTestId('preview-toggle').click();
  await expect(page.getByTestId('camera-preview')).toBeVisible();
  const shown = await seatedThenAway(page);

  // A') preview HIDDEN again
  await page.getByTestId('preview-toggle').click();
  await expect(page.getByTestId('camera-preview')).toHaveCount(0);
  const hidden2 = await seatedThenAway(page);

  console.log(`[preview] warm-up: seated ${warm.seatedMs}/away ${warm.awayMs} · hidden: ${hidden.seatedMs}/${hidden.awayMs} · shown: ${shown.seatedMs}/${shown.awayMs} · hidden again: ${hidden2.seatedMs}/${hidden2.awayMs} (ms)`);
  // Same thresholds apply either way (15 s seat / 30 s away, ± inference cadence & polling jitter)
  expect(Math.abs(hidden2.seatedMs - shown.seatedMs)).toBeLessThan(5_000);
  expect(Math.abs(hidden2.awayMs - shown.awayMs)).toBeLessThan(5_000);
  for (const r of [hidden, shown, hidden2]) {
    expect(r.seatedMs).toBeGreaterThanOrEqual(13_000);
    expect(r.awayMs).toBeGreaterThanOrEqual(28_000);
  }
  expect(Math.abs(hidden.seatedMs - shown.seatedMs)).toBeLessThan(5_000);
  expect(Math.abs(hidden.awayMs - shown.awayMs)).toBeLessThan(5_000);

  // C) toggle the preview repeatedly while seated: state and analysis host unaffected
  await page.evaluate(() => (window as any).__fakeCam.setScene('person'));
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  const hostHandle = await page.locator('#sm-analysis-video').elementHandle();
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('preview-toggle').click();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(3_000);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
  expect(await hostHandle!.evaluate((v: HTMLVideoElement) => v.isConnected && !v.paused)).toBe(true);
  expect(await page.locator('#sm-analysis-video').count()).toBe(1);

  // D) server recorded the same transitions regardless of preview (focus total > 0, away total > 0)
  await expect(page.getByTestId('focus-total')).not.toHaveAttribute('data-seconds', '0', { timeout: 35_000 });
  await expect(page.getByTestId('away-total')).not.toHaveAttribute('data-seconds', '0');
  await endStudy(page);
  await ctx.close();
});
