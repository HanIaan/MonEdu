/**
 * Contract-level E2E against the running Spring Boot server (no browser).
 * Server-clock-dependent cases (08:55 → 0 s, 09:13:22 → 802 s) are covered by backend tests with an
 * injected Clock; here we assert the lateness formula holds on live data.
 */
import { expect, test } from '@playwright/test';
import { API, apiLogin, auth, seoulToday, transition, USERS } from './helpers';

test.describe('auth & authorization', () => {
  test('login succeeds with demo account and fails with a wrong password', async ({ request }) => {
    const { user } = await apiLogin(request, USERS.student1);
    expect(user.role).toBe('STUDENT');
    const bad = await request.post(`${API}/api/v1/auth/login`, { data: { email: USERS.student1, password: 'nope' } });
    expect(bad.status()).toBe(401);
    expect(bad.headers()['content-type']).toContain('application/problem+json');
    expect((await bad.json()).code).toBe('BAD_CREDENTIALS');
  });

  test('protected endpoints require a token', async ({ request }) => {
    const res = await request.get(`${API}/api/v1/me`);
    expect(res.status()).toBe(401);
  });

  test('student cannot call teacher APIs', async ({ request }) => {
    const { token } = await apiLogin(request, USERS.student1);
    const res = await request.get(`${API}/api/v1/teacher/students`, { headers: auth(token) });
    expect(res.status()).toBe(403);
  });

  test('teacher sees only assigned students; other teacher is blocked', async ({ request }) => {
    const s1 = await apiLogin(request, USERS.student1);
    const t1 = await apiLogin(request, USERS.teacher);
    const t2 = await apiLogin(request, USERS.teacher2);
    const list = await request.get(`${API}/api/v1/teacher/students`, { headers: auth(t1.token) });
    expect(list.status()).toBe(200);
    const emails = (await list.json()).map((o: { student: { email: string } }) => o.student.email).sort();
    expect(emails).toEqual([USERS.student1, USERS.student2]);

    const ok = await request.get(`${API}/api/v1/teacher/students/${s1.user.id}/study-days/${seoulToday()}`, { headers: auth(t1.token) });
    expect(ok.status()).toBe(200);
    const denied = await request.get(`${API}/api/v1/teacher/students/${s1.user.id}/study-days/${seoulToday()}`, { headers: auth(t2.token) });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe('STUDENT_NOT_ASSIGNED');
  });
});

test.describe('study session event semantics', () => {
  test('idempotency, ordering, clock skew, camera-off heartbeat, end/restart without overlap', async ({ request }) => {
    const { token } = await apiLogin(request, USERS.student2);
    const h = { headers: auth(token) };

    const start = await request.post(`${API}/api/v1/study-sessions`, { ...h, data: { clientStartedAt: new Date().toISOString() } });
    expect(start.status()).toBe(201);
    const session = await start.json();
    expect(session.currentState).toBe('UNKNOWN');
    const base = `${API}/api/v1/study-sessions/${session.id}`;

    // 1) first transition
    const t1 = transition(1, 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED', new Date(Date.now() - 15_000));
    const r1 = await request.post(`${base}/transitions`, { ...h, data: t1 });
    expect(r1.status()).toBe(200);
    const b1 = await r1.json();
    expect(b1).toMatchObject({ duplicate: false, currentState: 'FOCUS_ESTIMATED', intervalChanged: true });

    // 2) exact duplicate → same result, duplicate: true
    const r1dup = await request.post(`${base}/transitions`, { ...h, data: t1 });
    expect(r1dup.status()).toBe(200);
    const b1dup = await r1dup.json();
    expect(b1dup.duplicate).toBe(true);
    expect(b1dup.effectiveAt).toBe(b1.effectiveAt);

    // 3) same eventId, different payload → 409 EVENT_ID_CONFLICT
    const conflict = await request.post(`${base}/transitions`, { ...h, data: { ...t1, state: 'AWAY', reason: 'PRESENCE_LOST' } });
    expect(conflict.status()).toBe(409);
    expect((await conflict.json()).code).toBe('EVENT_ID_CONFLICT');

    // 4) stale seq with a new eventId → 409 SEQ_OUT_OF_ORDER
    const stale = await request.post(`${base}/transitions`, { ...h, data: transition(1, 'AWAY', 'PRESENCE_LOST') });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe('SEQ_OUT_OF_ORDER');

    // 5) future detectedAt → 400 CLOCK_SKEW
    const future = await request.post(`${base}/transitions`, { ...h, data: transition(5, 'AWAY', 'PRESENCE_LOST', new Date(Date.now() + 60_000)) });
    expect(future.status()).toBe(400);
    expect((await future.json()).code).toBe('CLOCK_SKEW');

    // 6) invalid body → 400 VALIDATION_FAILED
    const invalid = await request.post(`${base}/transitions`, { ...h, data: { seq: 0 } });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).code).toBe('VALIDATION_FAILED');

    // 7) heartbeat reporting camera off while FOCUS → server forces UNKNOWN
    const hb = await request.post(`${base}/heartbeat`, {
      ...h,
      data: { sentAt: new Date().toISOString(), clientState: 'FOCUS_ESTIMATED', cameraActive: false, pageVisible: true, lastSeq: 1 },
    });
    expect(hb.status()).toBe(200);
    expect((await hb.json()).currentState).toBe('UNKNOWN');

    // 8) end, end again (idempotent), transition after end → 409 SESSION_ENDED
    const end1 = await request.post(`${base}/end`, { ...h, data: { endedAt: new Date().toISOString() } });
    expect(end1.status()).toBe(200);
    expect((await end1.json()).status).toBe('ENDED');
    const end2 = await request.post(`${base}/end`, { ...h, data: { endedAt: new Date().toISOString() } });
    expect(end2.status()).toBe(200);
    const after = await request.post(`${base}/transitions`, { ...h, data: transition(9, 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED') });
    expect(after.status()).toBe(409);
    expect((await after.json()).code).toBe('SESSION_ENDED');

    // 9) restart → new session; report intervals never overlap
    const restart = await request.post(`${API}/api/v1/study-sessions`, { ...h, data: { clientStartedAt: new Date().toISOString() } });
    expect(restart.status()).toBe(201);
    const s2 = await restart.json();
    expect(s2.id).not.toBe(session.id);
    await request.post(`${API}/api/v1/study-sessions/${s2.id}/transitions`, { ...h, data: transition(1, 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED', new Date(Date.now() - 60 * 60_000)) });

    const report = await (await request.get(`${API}/api/v1/me/study-days/${seoulToday()}`, h)).json();
    const iv = [...report.intervals].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    for (let i = 1; i < iv.length; i++) {
      const prevEnd = iv[i - 1].endedAt ? Date.parse(iv[i - 1].endedAt) : Infinity;
      expect(prevEnd, `interval ${i - 1} overlaps ${i}`).toBeLessThanOrEqual(Date.parse(iv[i].startedAt));
    }
    // back-dated onset before the new session start is clamped to the session start
    const s2Intervals = iv.filter((x) => x.sessionId === s2.id);
    expect(Date.parse(s2Intervals[0].startedAt)).toBeGreaterThanOrEqual(Date.parse(s2.startedAt));
    expect(report.activeSessionId).toBe(s2.id);

    // lateness formula on live data
    if (report.firstSeatedAt) {
      const expected = Math.max(0, Math.floor((Date.parse(report.firstSeatedAt) - Date.parse(report.referenceTime)) / 1000));
      expect(report.lateSeconds).toBe(expected);
      expect(report.lateStatus).toBe(expected === 0 ? 'ON_TIME' : 'LATE');
    }
    await request.post(`${API}/api/v1/study-sessions/${s2.id}/end`, { ...h, data: { endedAt: new Date().toISOString() } });
  });

  test('concurrent duplicate posts store exactly one event', async ({ request }) => {
    const { token } = await apiLogin(request, USERS.student2);
    const h = { headers: auth(token) };
    const s = await (await request.post(`${API}/api/v1/study-sessions`, { ...h, data: { clientStartedAt: new Date().toISOString() } })).json();
    const t = transition(1, 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED');
    const results = await Promise.all(
      Array.from({ length: 8 }, () => request.post(`${API}/api/v1/study-sessions/${s.id}/transitions`, { ...h, data: t })),
    );
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(results.every((r) => r.status() === 200)).toBe(true);
    expect(bodies.filter((b) => b.duplicate === false)).toHaveLength(1);
    expect(new Set(bodies.map((b) => b.effectiveAt)).size).toBe(1);
    await request.post(`${API}/api/v1/study-sessions/${s.id}/end`, { ...h, data: { endedAt: new Date().toISOString() } });
  });

  test('teacher SSE stream receives STATE_CHANGED for an assigned student', async ({ request }) => {
    const student = await apiLogin(request, USERS.student1);
    const teacher = await apiLogin(request, USERS.teacher);
    const ac = new AbortController();
    const res = await fetch(`${API}/api/v1/teacher/stream`, { headers: { ...auth(teacher.token), Accept: 'text/event-stream' }, signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();

    const h = { headers: auth(student.token) };
    const s = await (await request.post(`${API}/api/v1/study-sessions`, { ...h, data: { clientStartedAt: new Date().toISOString() } })).json();
    await request.post(`${API}/api/v1/study-sessions/${s.id}/transitions`, { ...h, data: transition(1, 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED') });

    let buf = '';
    const deadline = Date.now() + 10_000;
    let found: Record<string, string> | null = null;
    while (!found && Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 10_000)),
      ]);
      if (done) break;
      buf += value;
      for (const block of buf.split('\n\n')) {
        const data = block.split('\n').find((l) => l.startsWith('data:'));
        if (block.includes('event:monitoring') || block.includes('event: monitoring')) {
          const ev = data ? JSON.parse(data.replace(/^data:\s?/, '')) : null;
          if (ev?.type === 'STATE_CHANGED' && ev.sessionId === s.id && ev.state === 'FOCUS_ESTIMATED') found = ev;
        }
      }
    }
    ac.abort();
    expect(found).toMatchObject({ studentId: student.user.id, reason: 'SEATED_CONFIRMED' });
    await request.post(`${API}/api/v1/study-sessions/${s.id}/end`, { ...h, data: { endedAt: new Date().toISOString() } });
  });

  test('a student cannot post into another student\'s session', async ({ request }) => {
    const a = await apiLogin(request, USERS.student1);
    const b = await apiLogin(request, USERS.student2);
    const sa = await (await request.post(`${API}/api/v1/study-sessions`, { headers: auth(a.token), data: { clientStartedAt: new Date().toISOString() } })).json();
    // student2 posting into student1's session → 403
    const res = await request.post(`${API}/api/v1/study-sessions/${sa.id}/transitions`, { headers: auth(b.token), data: transition(1, 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED') });
    expect(res.status()).toBe(403);
    await request.post(`${API}/api/v1/study-sessions/${sa.id}/end`, { headers: auth(a.token), data: { endedAt: new Date().toISOString() } });
  });
});
