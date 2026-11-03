/**
 * Contract v1.3 in the browser: sign-up pages, session restore from the refresh cookie (reload / new
 * tab), logout, invite-code linking, Kakao login against the local mock (scripts/mock-kakao.mjs).
 * Fresh accounts only — the demo seed stays untouched.
 */
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const fresh = (p: string) => `e2e-${p}-${randomUUID().slice(0, 8)}@test.local`;
const GOOD = 'studyHard2026';
const MOCK = 'http://localhost:4810';

async function signupUi(page: Page, role: 'student' | 'teacher', email: string, name: string) {
  await page.goto('/login');
  await page.getByTestId('login-signup-link').click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByTestId(`signup-role-${role}`).click();
  await page.getByTestId('signup-display-name').fill(name);
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill(GOOD);
  await page.getByTestId('signup-password-confirm').fill(GOOD);
  await page.getByTestId('signup-agree-terms').check();
  await page.getByTestId('signup-agree-privacy').check();
  await page.getByTestId('signup-submit').click();
  await expect(page).toHaveURL(new RegExp(`/${role}`), { timeout: 15_000 });
}

test('login page: sign-up link, Kakao button, no demo-account hint in a non-demo build', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByTestId('login-signup-link')).toBeVisible();
  await expect(page.getByTestId('login-kakao')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('demo1234!');
});

test('sign-up shows a server error for an email that is taken', async ({ page }) => {
  const email = fresh('dup');
  await signupUi(page, 'student', email, '중복 테스트');
  await page.context().clearCookies();
  await page.goto('/signup');
  await page.getByTestId('signup-role-student').click();
  await page.getByTestId('signup-display-name').fill('중복 테스트');
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill(GOOD);
  await page.getByTestId('signup-password-confirm').fill(GOOD);
  await page.getByTestId('signup-agree-terms').check();
  await page.getByTestId('signup-agree-privacy').check();
  await page.getByTestId('signup-submit').click();
  await expect(page.getByTestId('signup-error')).toContainText('이미 가입된');
});

test('teacher + student sign up, link with the invite code; sessions survive reload and new tabs; logout ends them', async ({ browser }) => {
  const tctx = await browser.newContext();
  const teacher = await tctx.newPage();
  await signupUi(teacher, 'teacher', fresh('t'), 'E2E 선생님');
  const codeEl = teacher.getByTestId('invite-code');
  await expect(codeEl).toHaveAttribute('data-code', /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  const code = (await codeEl.getAttribute('data-code'))!;

  const sctx = await browser.newContext();
  const student = await sctx.newPage();
  await signupUi(student, 'student', fresh('s'), 'E2E 학생');
  await student.getByTestId('teacher-join-input').fill(`${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase());
  await student.getByTestId('teacher-join-submit').click();
  await expect(student.getByTestId('my-teacher')).toHaveCount(1);
  await expect(student.getByTestId('my-teacher')).toContainText('E2E 선생님');

  // wrong code → clear error, no new link
  await student.getByTestId('teacher-join-input').fill('ZZZZZZZZ');
  await student.getByTestId('teacher-join-submit').click();
  await expect(student.getByTestId('teacher-join-error')).toContainText('유효하지 않은');

  // teacher sees the new student without logging in again (reload = session restored from the cookie)
  await teacher.reload();
  await expect(teacher.getByTestId('student-row')).toHaveCount(1, { timeout: 15_000 });
  await expect(teacher.getByTestId('student-row')).toContainText('E2E 학생');

  // new tab in the same browser context: still logged in
  const tab2 = await sctx.newPage();
  await tab2.goto('/student');
  await expect(tab2).toHaveURL(/\/student/);
  await expect(tab2.getByTestId('start-session')).toBeVisible();

  // the access token is never in Web Storage
  const stored = await student.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
  expect(stored).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);

  // logout → login page; reload stays logged out (refresh cookie revoked)
  await student.getByTestId('logout').click();
  await expect(student).toHaveURL(/\/login/);
  await student.goto('/student');
  await expect(student).toHaveURL(/\/login/, { timeout: 15_000 });
  await tctx.close();
  await sctx.close();
});

test('Kakao: first login → role/name/agreements → student; second login goes straight in; cancel shows a message', async ({ page, request }) => {
  const id = 9_100_000_000 + Math.floor(Math.random() * 1e8);
  await request.post(`${MOCK}/__mock/next`, { data: { id, nickname: '카카오학생' } });
  await page.goto('/login');
  await page.getByTestId('login-kakao').click();
  await expect(page).toHaveURL(/\/signup\/kakao/, { timeout: 15_000 });
  await expect(page.getByTestId('kakao-signup-display-name')).toHaveValue('카카오학생');
  await page.getByTestId('kakao-signup-role-student').click();
  await page.getByTestId('kakao-signup-agree-terms').check();
  await page.getByTestId('kakao-signup-agree-privacy').check();
  await page.getByTestId('kakao-signup-submit').click();
  await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
  await request.post(`${MOCK}/__mock/next`, { data: { id, nickname: '카카오학생' } });
  await page.getByTestId('login-kakao').click();
  await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

  await page.getByTestId('logout').click();
  await request.post(`${MOCK}/__mock/next`, { data: { id, deny: true } });
  await page.getByTestId('login-kakao').click();
  await expect(page).toHaveURL(/\/login\?error=kakao_cancelled/, { timeout: 15_000 });
  await expect(page.getByTestId('login-error')).toBeVisible();

  // nothing secret travelled in a URL the mock saw (state/code only)
  const seen = (await (await request.get(`${MOCK}/__mock/log`)).json()) as { query: string[] }[];
  for (const r of seen) expect(r.query.join(',')).not.toMatch(/secret|token/i);
});
