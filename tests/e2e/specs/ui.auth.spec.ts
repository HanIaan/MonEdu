import { expect, test } from '@playwright/test';
import { apiLogin, uiLogin, USERS } from './helpers';

test('wrong password shows an error', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(USERS.student1);
  await page.getByTestId('login-password').fill('wrong-password');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
});

test('student login lands on the study screen; privacy notice is reachable', async ({ page }) => {
  await uiLogin(page, USERS.student1);
  await expect(page).toHaveURL(/\/student/);
  await expect(page.getByTestId('camera-status')).toBeVisible();
  await expect(page.getByTestId('start-session')).toBeVisible();
  await page.goto('/privacy');
  await expect(page.locator('body')).toContainText('브라우저');
});

test('camera never starts without explicit consent', async ({ page }) => {
  await uiLogin(page, USERS.student1);
  await expect(page).toHaveURL(/\/student/);
  const start = page.getByTestId('start-session');
  if (await start.isEnabled()) {
    await start.click();
    await expect(page.getByTestId('camera-status')).not.toHaveAttribute('data-status', 'active');
  } else {
    await expect(start).toBeDisabled();
  }
});

test('teacher sees exactly the assigned students and can log out', async ({ page }) => {
  await uiLogin(page, USERS.teacher);
  await expect(page).toHaveURL(/\/teacher/);
  await expect(page.getByTestId('student-row')).toHaveCount(2);
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
});

test('teacher cannot open the detail page of an unassigned student', async ({ page, request }) => {
  const s1 = await apiLogin(request, USERS.student1);
  await uiLogin(page, USERS.teacher2);
  await expect(page).toHaveURL(/\/teacher/);
  await page.goto(`/teacher/students/${s1.user.id}`);
  await expect(page.getByTestId('access-denied')).toBeVisible();
});

test('student is redirected away from teacher pages', async ({ page }) => {
  await uiLogin(page, USERS.student1);
  await expect(page).toHaveURL(/\/student/);
  await page.goto('/teacher');
  await expect(page).not.toHaveURL(/\/teacher$/);
});
