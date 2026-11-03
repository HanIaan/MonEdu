/**
 * Real MediaPipe inference in Chromium, camera = canvas stream of real photos (fixtures/).
 * Proves: camera permission → model load → seating confirmation → AWAY after 30 s → camera stop,
 * teacher dashboard updates live via SSE, sync queue recovers after offline.
 */
import { expect, test } from '@playwright/test';
import { apiLogin, endStudy, installCanvasCamera, startStudy, state, uiLogin, USERS } from './helpers';

test.describe.configure({ mode: 'serial' });

test('seated → FOCUS_ESTIMATED, teacher sees it live, upper body without a frontal face counts as present', async ({ browser, request }) => {
  const { user: s1 } = await apiLogin(request, USERS.student1);
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
  const row = teacher.locator(`[data-testid="student-row"][data-student-id="${s1.id}"]`);
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 20_000 });

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
  // Phase 2: the card shows WHY it cannot measure (engine lastReason, or derived from camera status).
  await expect(page.getByTestId('unknown-state')).toHaveAttribute('data-reason', 'CAMERA_STOPPED');
  await expect(page.getByTestId('unknown-state-reason')).toContainText('카메라');
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

test('@slow heartbeat lost > 90 s (network down) → server marks UNKNOWN, teacher sees it; reconnect re-syncs', async ({ browser, request }) => {
  test.setTimeout(300_000);
  const { user: s1 } = await apiLogin(request, USERS.student1);
  const ctx = await browser.newContext({ permissions: ['camera'] });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();
  await uiLogin(page, USERS.student1);
  await startStudy(page);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });

  const teacherCtx = await browser.newContext();
  const teacher = await teacherCtx.newPage();
  await uiLogin(teacher, USERS.teacher);
  await expect(teacher).toHaveURL(/\/teacher/);
  const row = teacher.locator(`[data-testid="student-row"][data-student-id="${s1.id}"]`);
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 20_000 });

  // Student's network drops: heartbeats stop reaching the server (camera + local analysis keep running).
  const downAt = Date.now();
  await ctx.setOffline(true);
  // heartbeat timeout 90 s + scanner period 10 s (+ heartbeat phase)
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'UNKNOWN', { timeout: 150_000 });
  console.log(`[heartbeat] teacher saw UNKNOWN ${Math.round((Date.now() - downAt) / 1000)} s after the network went down`);

  // Reconnect: next heartbeat says timedOut → client re-asserts its engine state (RECONNECTED)
  await ctx.setOffline(false);
  await expect(row.getByTestId('student-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', '0', { timeout: 30_000 });
  await endStudy(page);
  await ctx.close();
  await teacherCtx.close();
});
