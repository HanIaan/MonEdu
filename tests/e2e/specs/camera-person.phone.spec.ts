/**
 * Phase 2 accuracy scenarios with the real models in the browser:
 *  - phone in view ≥ 20 s → DISTRACTION_SUSPECTED (teacher sees it), phone gone → FOCUS_ESTIMATED again
 *  - pets only (no person) → never FOCUS_ESTIMATED (v1 defect: pet faces read as present)
 * Fixtures and licenses: fixtures/README.md. A still image is a best case; see
 * frontend/bench/vision/RESULTS.md for measured precision/recall on real photo sets.
 */
import { expect, test } from '@playwright/test';
import { API, apiLogin, auth, endStudy, installCanvasCamera, seoulToday, startStudy, state, uiLogin, USERS } from './helpers';

const setScene = (s: string) => (window as unknown as { __fakeCam: { setScene(x: string): void } }).__fakeCam.setScene(s);

test('@slow phone in view → DISTRACTION_SUSPECTED after ≥ 20 s (teacher sees it); phone gone → FOCUS again', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student1);
  await startStudy(page);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });

  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await uiLogin(teacher, USERS.teacher);
  const { user } = await apiLogin(teacher.request, USERS.student1);
  const row = teacher.locator(`[data-student-id="${user.id}"]`);
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 20_000 });

  await page.evaluate(setScene, 'phone');
  const phoneAt = Date.now();
  await expect(state(page)).toHaveAttribute('data-state', 'DISTRACTION_SUSPECTED', { timeout: 90_000 });
  const latency = (Date.now() - phoneAt) / 1000;
  console.log(`[phone] DISTRACTION_SUSPECTED ${latency.toFixed(1)} s after the phone appeared`);
  expect(latency, 'suspicion must not fire before the 20 s phone rule').toBeGreaterThanOrEqual(19);
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'DISTRACTION_SUSPECTED', { timeout: 20_000 });

  await page.evaluate(setScene, 'person');
  const backAt = Date.now();
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 90_000 });
  console.log(`[phone] FOCUS_ESTIMATED ${((Date.now() - backAt) / 1000).toFixed(1)} s after the phone disappeared`);
  await endStudy(page);
  await teacherCtx.close();
  await ctx.close();
});

test('@slow pets only in frame → never FOCUS_ESTIMATED, no focus time accrues', async ({ browser, request }) => {
  test.setTimeout(180_000);
  const { token } = await apiLogin(request, USERS.student2);
  const focus = async () =>
    (await (await request.get(`${API}/api/v1/me/study-days/${seoulToday()}`, { headers: auth(token) })).json()).totals.focusSeconds as number;
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'pets');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student2);
  const before = await focus();
  await startStudy(page);
  const seen = new Set<string>();
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    seen.add((await state(page).getAttribute('data-state')) ?? '?');
    await page.waitForTimeout(1_000);
  }
  console.log(`[pets] states seen in 45 s: ${[...seen].join(', ')}`);
  expect(seen.has('FOCUS_ESTIMATED'), 'pets must not confirm seating').toBe(false);
  expect(seen.has('DISTRACTION_SUSPECTED')).toBe(false);
  await endStudy(page);
  await page.waitForTimeout(1_500);
  expect(await focus() - before, 'no focus seconds from a pet-only scene').toBe(0);
  await ctx.close();
});
