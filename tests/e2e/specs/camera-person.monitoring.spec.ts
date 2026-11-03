/**
 * Real MediaPipe inference in Chromium, camera = canvas stream of real photos (fixtures/).
 * Proves: camera permission → model load → seating confirmation → AWAY after 30 s → camera stop,
 * teacher dashboard updates live via SSE, sync queue recovers after offline.
 */
import { expect, test } from '@playwright/test';
import { endStudy, installCanvasCamera, startStudy, state, uiLogin, USERS } from './helpers';

test.describe.configure({ mode: 'serial' });

test('seated → FOCUS_ESTIMATED, teacher sees it live, upper body without a frontal face counts as present', async ({ browser }) => {
  const studentCtx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(studentCtx, 'person');
  const student = await studentCtx.newPage();
  await uiLogin(student, USERS.student1);
  await expect(student).toHaveURL(/\/student/);
  await startStudy(student);

  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await uiLogin(teacher, USERS.teacher);
  await expect(teacher).toHaveURL(/\/teacher/);

  // 15 s confirmation + model warm-up
  await expect(state(student)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  const row = teacher.locator('[data-testid="student-row"]').filter({ has: teacher.getByText(/student1|학생1|Student 1/i) });
  const anyRow = (await row.count()) ? row.first() : teacher.getByTestId('student-row').first();
  await expect(anyRow.getByTestId('student-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 20_000 });

  await expect(student.getByTestId('first-seated-at')).not.toHaveText('—');
  await expect(student.getByTestId('late-seconds')).toHaveAttribute('data-seconds', /\d+/);

  await endStudy(student);
  await studentCtx.close();
  await teacherCtx.close();
});

test('@slow nobody in frame for 30 s → AWAY; then camera track stops → UNKNOWN', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student1);
  await startStudy(page);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });

  await page.evaluate(() => (window as any).__fakeCam.setScene('nobody'));
  const leftAt = Date.now();
  await expect(state(page)).toHaveAttribute('data-state', 'AWAY', { timeout: 60_000 });
  expect(Date.now() - leftAt, 'AWAY must not fire before the 30 s threshold').toBeGreaterThanOrEqual(29_000);

  await page.evaluate(() => (window as any).__fakeCam.stopTrack());
  await expect(page.getByTestId('camera-status')).not.toHaveAttribute('data-status', 'active');
  await expect(state(page)).toHaveAttribute('data-state', 'UNKNOWN');
  await endStudy(page);
  await ctx.close();
});

test('pause, break and resume are reflected immediately', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student1);
  await startStudy(page);

  await page.getByTestId('break-start').click();
  await expect(state(page)).toHaveAttribute('data-state', 'BREAK');
  await page.getByTestId('break-end').click();
  await expect(state(page)).not.toHaveAttribute('data-state', 'BREAK');

  await page.getByTestId('pause-monitoring').click();
  await expect(state(page)).toHaveAttribute('data-state', 'UNKNOWN');
  await expect(page.getByTestId('camera-status')).not.toHaveAttribute('data-status', 'active');
  await page.getByTestId('resume-monitoring').click();
  await expect(page.getByTestId('camera-status')).toHaveAttribute('data-status', 'active', { timeout: 30_000 });
  await endStudy(page);
  await ctx.close();
});

test('offline → events queue; back online → queue drains', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student1);
  await startStudy(page);
  await ctx.setOffline(true);
  await page.getByTestId('break-start').click(); // produces a transition while offline
  await expect(page.getByTestId('sync-status')).not.toHaveAttribute('data-pending', '0', { timeout: 10_000 });
  await ctx.setOffline(false);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', '0', { timeout: 40_000 });
  await page.getByTestId('break-end').click();
  await endStudy(page);
  await ctx.close();
});

test('@slow frozen tab (no heartbeat > 90 s) → server marks UNKNOWN; client re-syncs after thaw', async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student1);
  await startStudy(page);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });

  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await uiLogin(teacher, USERS.teacher);
  const row = teacher.getByTestId('student-row').first();

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  // heartbeat timeout 90 s + scanner period 10 s
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'UNKNOWN', { timeout: 130_000 });
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  // engine detects the stall, re-confirms seating, sync re-asserts state
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  await endStudy(page);
  await ctx.close();
  await teacherCtx.close();
});
