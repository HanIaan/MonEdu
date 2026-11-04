/**
 * Contract v1.3 (docs/contracts/auth.md) at the HTTP level: sign-up, password policy, refresh-cookie
 * rotation / reuse, logout, login throttling, invite codes. Every test uses fresh accounts
 * (e2e-<random>@test.local) so demo-seed assertions elsewhere are unaffected.
 */
import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { API, auth } from './helpers';

const fresh = (p = 'u') => `e2e-${p}-${randomUUID().slice(0, 8)}@test.local`;
const GOOD = 'studyHard2026';
const agreements = { terms: true, privacy: true };

async function signup(ctx: APIRequestContext, role: 'STUDENT' | 'TEACHER', email = fresh(role.toLowerCase())) {
  const res = await ctx.post(`${API}/api/v1/auth/signup`, { data: { email, password: GOOD, displayName: `E2E ${role}`, role, agreements } });
  expect(res.status(), await res.text()).toBe(201);
  return { email, body: await res.json(), res };
}
const cookieOf = (res: { headersArray(): { name: string; value: string }[] }) =>
  res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value).find((v) => v.startsWith('sm_rt=')) ?? '';

test('sign-up creates an account, logs in and sets an HttpOnly refresh cookie', async () => {
  const ctx = await pwRequest.newContext();
  const { email, body, res } = await signup(ctx, 'STUDENT');
  expect(body.user).toMatchObject({ email, role: 'STUDENT', displayName: 'E2E STUDENT' });
  expect(body.tokenType).toBe('Bearer');
  const c = cookieOf(res);
  expect(c).toMatch(/HttpOnly/i);
  expect(c).toMatch(/SameSite=Lax/i);
  expect(c).toMatch(/Path=\/api\/v1\/auth/);
  const me = await ctx.get(`${API}/api/v1/me`, { headers: auth(body.accessToken) });
  expect(me.status()).toBe(200);
  // the same email again → 409 EMAIL_TAKEN; login with the new password works
  const dup = await ctx.post(`${API}/api/v1/auth/signup`, { data: { email, password: GOOD, displayName: 'x', role: 'STUDENT', agreements } });
  expect(dup.status()).toBe(409);
  expect((await dup.json()).code).toBe('EMAIL_TAKEN');
  expect((await ctx.post(`${API}/api/v1/auth/login`, { data: { email, password: GOOD } })).status()).toBe(200);
  await ctx.dispose();
});

test('password policy and agreements are enforced by the server', async ({ request }) => {
  const email = fresh('policy');
  const bad: [string, Record<string, unknown>][] = [
    ['too short', { password: 'ab12' }],
    ['no digit', { password: 'onlyletters' }],
    ['no letter', { password: '1234567890' }],
    ['contains email id', { password: `${email.split('@')[0]}9` }],
    ['common password', { password: 'qwer1234' }],
    ['terms not agreed', { agreements: { terms: false, privacy: true } }],
    ['bad role', { role: 'ADMIN' }],
    ['empty name', { displayName: '   ' }],
  ];
  for (const [label, patch] of bad) {
    const res = await request.post(`${API}/api/v1/auth/signup`, {
      data: { email, password: GOOD, displayName: 'Policy', role: 'STUDENT', agreements, ...patch },
    });
    expect(res.status(), label).toBe(400);
    expect((await res.json()).code, label).toBe('VALIDATION_FAILED');
  }
});

test('refresh rotates the cookie; a concurrent replay inside the grace is accepted; logout revokes the family', async () => {
  const ctx = await pwRequest.newContext();
  const { res } = await signup(ctx, 'STUDENT');
  const first = cookieOf(res).split(';')[0]!; // sm_rt=<token>
  const r1 = await ctx.post(`${API}/api/v1/auth/refresh`);
  expect(r1.status()).toBe(200);
  expect((await r1.json()).accessToken).toBeTruthy();
  const second = cookieOf(r1).split(';')[0]!;
  expect(second).not.toBe(first);

  // A different client replays the first (rotated) token: inside the 30 s grace it is accepted once…
  const replay = await pwRequest.newContext({ extraHTTPHeaders: { Cookie: first } });
  expect((await replay.post(`${API}/api/v1/auth/refresh`)).status()).toBe(200);
  await replay.dispose();

  // logout revokes the family → the current cookie no longer refreshes
  expect((await ctx.post(`${API}/api/v1/auth/logout`)).status()).toBe(204);
  const after = await pwRequest.newContext({ extraHTTPHeaders: { Cookie: second } });
  expect((await after.post(`${API}/api/v1/auth/refresh`)).status()).toBe(401);
  await after.dispose();
  // no cookie at all
  const none = await pwRequest.newContext();
  expect((await none.post(`${API}/api/v1/auth/refresh`)).status()).toBe(401);
  expect((await none.post(`${API}/api/v1/auth/logout`)).status()).toBe(204);
  await none.dispose();
  await ctx.dispose();
});

test('5 wrong passwords lock the account for a while (429 + Retry-After), even with the right password', async () => {
  const ctx = await pwRequest.newContext();
  const { email } = await signup(ctx, 'STUDENT');
  for (let i = 0; i < 5; i++) expect((await ctx.post(`${API}/api/v1/auth/login`, { data: { email, password: 'wrongPass99' } })).status()).toBe(401);
  const locked = await ctx.post(`${API}/api/v1/auth/login`, { data: { email, password: GOOD } });
  expect(locked.status()).toBe(429);
  expect((await locked.json()).code).toBe('TOO_MANY_ATTEMPTS');
  expect(Number(locked.headers()['retry-after'])).toBeGreaterThan(0);
  // unknown emails get the same treatment (no account enumeration via the lock)
  const ghost = fresh('ghost');
  for (let i = 0; i < 5; i++) expect((await ctx.post(`${API}/api/v1/auth/login`, { data: { email: ghost, password: 'wrongPass99' } })).status()).toBe(401);
  expect((await ctx.post(`${API}/api/v1/auth/login`, { data: { email: ghost, password: 'wrongPass99' } })).status()).toBe(429);
  await ctx.dispose();
});

test('invite code: teacher gets one, student joins (idempotent), teacher sees the student; rotate invalidates the old code', async () => {
  const tctx = await pwRequest.newContext();
  const sctx = await pwRequest.newContext();
  const teacher = await signup(tctx, 'TEACHER');
  const student = await signup(sctx, 'STUDENT');
  const T = auth(teacher.body.accessToken);
  const S = auth(student.body.accessToken);

  const code1 = await (await tctx.get(`${API}/api/v1/teacher/invite-code`, { headers: T })).json();
  expect(code1.code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  expect((await (await tctx.get(`${API}/api/v1/teacher/invite-code`, { headers: T })).json()).code).toBe(code1.code);
  // students cannot read invite codes; teachers cannot join
  expect((await sctx.get(`${API}/api/v1/teacher/invite-code`, { headers: S })).status()).toBe(403);
  expect((await tctx.post(`${API}/api/v1/me/teachers`, { headers: T, data: { inviteCode: code1.code } })).status()).toBe(403);

  // normalised input (lower-case + dash) joins; a second join is idempotent
  const typed = `${code1.code.slice(0, 4)}-${code1.code.slice(4)}`.toLowerCase();
  const join = await sctx.post(`${API}/api/v1/me/teachers`, { headers: S, data: { inviteCode: typed } });
  expect(join.status(), await join.text()).toBe(200);
  expect((await join.json()).teacher).toMatchObject({ id: teacher.body.user.id });
  expect((await sctx.post(`${API}/api/v1/me/teachers`, { headers: S, data: { inviteCode: code1.code } })).status()).toBe(200);
  const mine = await (await sctx.get(`${API}/api/v1/me/teachers`, { headers: S })).json();
  expect(mine).toHaveLength(1);

  const overview = await (await tctx.get(`${API}/api/v1/teacher/students`, { headers: T })).json();
  expect(overview.map((o: { student: { id: string } }) => o.student.id)).toContain(student.body.user.id);

  // rotate → old code invalid, link kept
  const code2 = await (await tctx.post(`${API}/api/v1/teacher/invite-code/rotate`, { headers: T })).json();
  expect(code2.code).not.toBe(code1.code);
  const other = await signup(sctx, 'STUDENT');
  const stale = await sctx.post(`${API}/api/v1/me/teachers`, { headers: auth(other.body.accessToken), data: { inviteCode: code1.code } });
  expect(stale.status()).toBe(404);
  expect((await stale.json()).code).toBe('INVITE_CODE_INVALID');
  expect((await (await tctx.get(`${API}/api/v1/teacher/students`, { headers: T })).json()).length).toBe(1);
  await tctx.dispose();
  await sctx.dispose();
});

test('providers endpoint reports Kakao (enabled against the E2E mock)', async ({ request }) => {
  const res = await request.get(`${API}/api/v1/auth/providers`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ password: true, kakao: true });
});
