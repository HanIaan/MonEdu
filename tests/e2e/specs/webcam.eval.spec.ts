/**
 * Real-webcam field evaluation (opt-in: WEBCAM_EVAL=1). Measures the *shipped* engine on a real person
 * following a scripted protocol: seated, writing, reading, phone use, away, head down on the desk.
 *
 * PRIVACY — by construction:
 *   - No image, video or frame ever leaves the browser. This harness never calls page.screenshot(), the
 *     project disables trace/screenshot/video, and the JSON result holds only numbers (engine state
 *     timeline, per-tick model scores, inference ms) and the protocol labels.
 *   - Consent is given by the person in front of the camera, in the product's own flow: they tick the
 *     privacy consent box, press '학습 시작' and answer the browser's camera prompt themselves. The
 *     harness does not grant camera permission and does not auto-accept the prompt.
 *   - Results are written only to tests/e2e/test-results/ (gitignored) on this machine.
 *
 * Modes:
 *   WEBCAM_EVAL=1                      headed Chromium, real default camera, human follows the overlay
 *   WEBCAM_EVAL=1 WEBCAM_EVAL_FAKE=1   headless dry run of the harness with the canvas camera (photos);
 *                                      validates the plumbing only — its numbers are NOT field results
 * Options: WEBCAM_EVAL_USER (default student3), WEBCAM_EVAL_NOTE (free text: lighting, camera, distance,
 *          glasses …), WEBCAM_EVAL_CHANNEL=chrome (use installed Google Chrome instead of Chromium).
 * Aggregate several runs: node scripts/webcam-eval-summary.mjs
 */
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API, apiLogin, auth, endStudy, installCanvasCamera, seoulToday, startStudy, uiLogin, USERS, type Scene } from './helpers';

const FAKE = process.env.WEBCAM_EVAL_FAKE === '1';
const PREP_SEC = FAKE ? 2 : 8;

type State = 'FOCUS_ESTIMATED' | 'DISTRACTION_SUSPECTED' | 'AWAY' | 'UNKNOWN' | 'BREAK';
interface Segment {
  id: string;
  title: string;
  instruction: string;
  sec: number;
  /** null = observation only (no rule exists for this posture). */
  expect: State | null;
  /** Expected state must be reached within this many seconds of the segment start. */
  reachSec?: number;
  /** After reachSec, share of time that must be in the expected state ('reach' = only reaching counts). */
  hold?: number | 'reach';
  fakeScene: Exclude<Scene, 'black'>;
}

/** Thresholds come from docs/contracts/state-machine.md §3 (15 s seating, 20 s phone, 30 s away, 3 s debounce). */
const PROTOCOL: Segment[] = [
  { id: 'seated', title: '정면 착석', instruction: '카메라 정면에 평소처럼 앉아 화면을 보세요.', sec: 75, expect: 'FOCUS_ESTIMATED', reachSec: 35, hold: 0.9, fakeScene: 'person' },
  { id: 'writing', title: '필기', instruction: '고개를 숙여 노트에 글씨를 쓰세요. 어깨는 화면 안에 두세요.', sec: 75, expect: 'FOCUS_ESTIMATED', reachSec: 20, hold: 0.9, fakeScene: 'person' },
  { id: 'reading', title: '독서', instruction: '책을 펴서 읽으세요(손에 들거나 책상 위에 두고 내려다보기).', sec: 75, expect: 'FOCUS_ESTIMATED', reachSec: 20, hold: 0.9, fakeScene: 'person' },
  { id: 'phone', title: '휴대폰 사용', instruction: '휴대폰을 손에 들고 화면을 보며 사용하세요. 휴대폰이 카메라에 보이게 하세요.', sec: 60, expect: 'DISTRACTION_SUSPECTED', reachSec: 35, hold: 'reach', fakeScene: 'phone' },
  { id: 'phone_resume', title: '휴대폰 내려놓기', instruction: '휴대폰을 치우고 정면으로 앉으세요.', sec: 40, expect: 'FOCUS_ESTIMATED', reachSec: 25, hold: 'reach', fakeScene: 'person' },
  { id: 'away', title: '자리 비움', instruction: '자리에서 일어나 카메라 화면 밖으로 나가세요. 다음 단계에서 "삐" 소리가 두 번 나면 돌아오세요.', sec: 60, expect: 'AWAY', reachSec: 45, hold: 'reach', fakeScene: 'nobody' },
  { id: 'return', title: '복귀', instruction: '돌아와 정면에 앉으세요.', sec: 40, expect: 'FOCUS_ESTIMATED', reachSec: 25, hold: 'reach', fakeScene: 'person' },
  { id: 'head_down', title: '엎드린 자세', instruction: '책상에 팔을 베고 엎드리세요(자는 자세). 관찰 항목: 현재 판정 규칙 없음.', sec: 60, expect: null, fakeScene: 'person' },
  { id: 'final', title: '정면 착석', instruction: '다시 정면에 앉으세요. 곧 끝납니다.', sec: 30, expect: 'FOCUS_ESTIMATED', reachSec: 25, hold: 'reach', fakeScene: 'person' },
];

type Tick = [t: number, qualityOk: 0 | 1, face: number, upper: 0 | 1, detRan: 0 | 1, phone: number, person: number | null, infMs: number];
type Change = [t: number, state: State, reason: string | null];

const round = (x: number, d = 1) => +x.toFixed(d);
const pct = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]! : null);

function stateAt(tl: Change[], t: number): State | null {
  let s: State | null = null;
  for (const [ct, cs] of tl) if (ct <= t) s = cs;
  return s;
}
function secondsByState(tl: Change[], a: number, b: number): Record<string, number> {
  const out: Record<string, number> = {};
  const cuts = [a, ...tl.map((c) => c[0]).filter((t) => t > a && t < b), b];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s = stateAt(tl, cuts[i]!) ?? 'NONE';
    out[s] = round((out[s] ?? 0) + (cuts[i + 1]! - cuts[i]!) / 1000);
  }
  return out;
}
function firstReach(tl: Change[], state: State, a: number, b: number): number | null {
  if (stateAt(tl, a) === state) return 0;
  const c = tl.find(([t, s]) => t > a && t <= b && s === state);
  return c ? round((c[0] - a) / 1000) : null;
}

function evaluate(seg: Segment, a: number, b: number, tl: Change[], ticks: Tick[]) {
  const by = secondsByState(tl, a, b);
  const span = (b - a) / 1000;
  const reached = seg.expect ? firstReach(tl, seg.expect, a, b) : null;
  let pass: boolean | null = null;
  let heldShare: number | null = null;
  if (seg.expect) {
    const okReach = reached !== null && reached <= seg.reachSec!;
    if (seg.hold === 'reach') pass = okReach;
    else {
      const from = a + seg.reachSec! * 1000;
      const sub = secondsByState(tl, from, b);
      heldShare = round((sub[seg.expect] ?? 0) / ((b - from) / 1000), 2);
      pass = okReach && heldShare >= (seg.hold as number);
    }
  }
  const tk = ticks.filter((x) => x[0] >= a && x[0] <= b);
  const det = tk.filter((x) => x[4] === 1);
  const share = (xs: Tick[], f: (x: Tick) => boolean) => (xs.length ? round(xs.filter(f).length / xs.length, 2) : null);
  return {
    id: seg.id,
    title: seg.title,
    expect: seg.expect,
    seconds: round(span),
    stateSeconds: by,
    reachedAfterSec: reached,
    reachLimitSec: seg.reachSec ?? null,
    heldShare,
    pass,
    /** Wrong-state seconds that matter most for fairness: AWAY/DISTRACTION while actually studying. */
    falseAwaySec: seg.expect === 'FOCUS_ESTIMATED' ? by.AWAY ?? 0 : null,
    falseDistractionSec: seg.expect === 'FOCUS_ESTIMATED' || seg.expect === 'AWAY' ? by.DISTRACTION_SUSPECTED ?? 0 : null,
    evidence: {
      ticks: tk.length,
      frameQualityOk: share(tk, (x) => x[1] === 1),
      faceGe06: share(tk, (x) => x[2] >= 0.6),
      upperBody: share(tk, (x) => x[3] === 1),
      detectorTicks: det.length,
      personGe05: share(det, (x) => (x[6] ?? 0) >= 0.5),
      phoneGe05: share(det, (x) => x[5] >= 0.5),
      phoneScoreMax: det.length ? Math.max(...det.map((x) => x[5])) : null,
      infP95Ms: pct(tk.map((x) => x[7]), 0.95),
    },
  };
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('webcam field evaluation (seated / writing / reading / phone / away / head down)', async ({ browser, request }) => {
  const total = PROTOCOL.reduce((a, s) => a + s.sec + PREP_SEC, 0);
  test.setTimeout((total + 600) * 1000);
  const user = process.env.WEBCAM_EVAL_USER ?? USERS.student3;
  const { token } = await apiLogin(request, user);
  const dayTotals = async () =>
    (await (await request.get(`${API}/api/v1/me/study-days/${seoulToday()}`, { headers: auth(token) })).json()).totals as Record<string, number>;

  // Real mode: no permission grant, no fake-UI flag → the browser asks the person.
  const ctx = await browser.newContext(FAKE ? { permissions: ['camera'] } : {});
  if (FAKE) await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();

  const say = (title: string, body: string, color = '#1e293b') =>
    page
      .evaluate(
        ({ title, body, color }) => {
          let el = document.getElementById('__weval_overlay');
          if (!el) {
            el = document.createElement('div');
            el.id = '__weval_overlay';
            el.setAttribute('style', 'position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:420px;padding:14px 16px;border-radius:12px;color:#fff;font:15px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none');
            document.body.appendChild(el);
          }
          el.style.background = color;
          el.innerHTML = '';
          const h = document.createElement('div');
          h.style.cssText = 'font-weight:700;font-size:18px;margin-bottom:4px';
          h.textContent = title;
          const p = document.createElement('div');
          p.textContent = body;
          el.append(h, p);
        },
        { title, body, color },
      )
      .catch(() => undefined);

  /** Short beep(s) so the person can follow the protocol without looking at the screen (WebAudio, no files). */
  const beep = (n: number) =>
    page
      .evaluate(async (n) => {
        const w = window as unknown as { __wevalAudio?: AudioContext };
        const ac = (w.__wevalAudio ??= new AudioContext());
        for (let i = 0; i < n; i++) {
          const o = ac.createOscillator();
          const g = ac.createGain();
          g.gain.value = 0.15;
          o.frequency.value = 880;
          o.connect(g).connect(ac.destination);
          o.start();
          o.stop(ac.currentTime + 0.18);
          await new Promise((r) => setTimeout(r, 320));
        }
      }, n)
      .catch(() => undefined);

  await uiLogin(page, user);
  if (FAKE) {
    await startStudy(page);
  } else {
    await page.goto('/student');
    await say('웹캠 평가 준비', "영상은 브라우저 안에서만 분석되고 저장·전송되지 않습니다. 동의하면 화면의 동의 체크 → '학습 시작' → 카메라 권한 '허용'을 직접 눌러 주세요. 원하지 않으면 이 창을 닫으면 됩니다.", '#0f766e');
    await expect(page.getByTestId('camera-status')).toHaveAttribute('data-status', 'active', { timeout: 300_000 });
    await expect(page.getByTestId('model-status')).toHaveAttribute('data-status', 'ready', { timeout: 120_000 });
  }
  await page.waitForFunction(() => !!(window as unknown as { __smDiag?: unknown }).__smDiag, undefined, { timeout: 10_000 });

  // In-page collector: numbers only (state changes + one row per processed frame).
  await page.evaluate(() => {
    type Snap = { engineState: string; lastReason?: string | null; lastFrameAt: number | null; lastObservation: { frameQuality: string; faceScore: number; upperBodyDetected: boolean; phoneEvaluated: boolean; phoneScore: number; personScore?: number; inferenceMs: number } | null };
    const w = window as unknown as { __smDiag: { snapshot(): Snap }; __weval: { ticks: unknown[]; changes: unknown[] } };
    w.__weval = { ticks: [], changes: [] };
    let lastFrame: number | null = null;
    let lastState = '';
    setInterval(() => {
      const s = w.__smDiag.snapshot();
      const now = Date.now();
      if (s.engineState !== lastState) {
        w.__weval.changes.push([now, s.engineState, s.lastReason ?? null]);
        lastState = s.engineState;
      }
      const o = s.lastObservation;
      if (o && s.lastFrameAt !== null && s.lastFrameAt !== lastFrame) {
        lastFrame = s.lastFrameAt;
        const r2 = (x: number) => Math.round(x * 100) / 100;
        w.__weval.ticks.push([now, o.frameQuality === 'OK' ? 1 : 0, r2(o.faceScore), o.upperBodyDetected ? 1 : 0, o.phoneEvaluated ? 1 : 0, r2(o.phoneScore), o.phoneEvaluated && o.personScore != null ? r2(o.personScore) : null, Math.round(o.inferenceMs)]);
      }
    }, 100);
  });

  const totals0 = await dayTotals();
  const windows: { seg: Segment; a: number; b: number }[] = [];
  for (const [i, seg] of PROTOCOL.entries()) {
    for (let k = PREP_SEC; k > 0; k--) {
      await say(`다음 (${i + 1}/${PROTOCOL.length}): ${seg.title} — ${k}초 후 시작`, seg.instruction, '#475569');
      await page.waitForTimeout(1000);
    }
    await beep(seg.id === 'return' ? 2 : 1);
    if (FAKE) await page.evaluate((s) => (window as unknown as { __fakeCam: { setScene(x: string): void } }).__fakeCam.setScene(s), seg.fakeScene);
    const a = Date.now();
    for (let left = seg.sec; left > 0; left--) {
      await say(`${i + 1}/${PROTOCOL.length} ${seg.title} — 남은 시간 ${left}초`, seg.instruction, seg.expect === null ? '#7c3aed' : '#1d4ed8');
      await page.waitForTimeout(1000);
    }
    windows.push({ seg, a, b: Date.now() });
  }
  await beep(3);
  await say('평가 완료', '결과 파일을 저장하는 중입니다. 잠시 후 학습이 종료됩니다.', '#0f766e');
  await page.waitForTimeout(3000);

  const raw = await page.evaluate(() => (window as unknown as { __weval: { ticks: unknown[]; changes: unknown[] } }).__weval);
  const ticks = raw.ticks as Tick[];
  const changes = raw.changes as Change[];
  const totals1 = await dayTotals();
  const env = await page.evaluate(() => {
    const v = Array.from(document.querySelectorAll('video')).find((x) => x.videoWidth > 0);
    return { userAgent: navigator.userAgent, videoWidth: v?.videoWidth ?? null, videoHeight: v?.videoHeight ?? null, hardwareConcurrency: navigator.hardwareConcurrency };
  });
  await endStudy(page);

  const segments = windows.map(({ seg, a, b }) => evaluate(seg, a, b, changes, ticks));
  const result = {
    kind: FAKE ? 'fake-dry-run (canvas photos — NOT field data)' : 'real-webcam',
    startedAt: new Date(windows[0]!.a).toISOString(),
    note: process.env.WEBCAM_EVAL_NOTE ?? '',
    env,
    serverTotalsDelta: Object.fromEntries(Object.keys(totals1).map((k) => [k, (totals1[k] ?? 0) - (totals0[k] ?? 0)])),
    segments,
    stateChanges: changes.map(([t, s, r]) => [new Date(t).toISOString(), s, r]),
    ticks,
  };
  const dir = join(import.meta.dirname, '..', 'test-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `webcam-eval-${FAKE ? 'fake-' : ''}${result.startedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`[webcam-eval] ${result.kind} → ${file}`);
  for (const s of segments)
    console.log(
      `[webcam-eval] ${s.id.padEnd(13)} expect=${String(s.expect).padEnd(22)} reached=${String(s.reachedAfterSec).padStart(5)}s/${s.reachLimitSec ?? '-'} held=${s.heldShare ?? '-'} pass=${s.pass} states=${JSON.stringify(s.stateSeconds)} face≥.6=${s.evidence.faceGe06} upper=${s.evidence.upperBody} person≥.5=${s.evidence.personGe05} phone≥.5=${s.evidence.phoneGe05}`,
    );

  expect(ticks.length, 'frames were analysed during the protocol').toBeGreaterThan(100);
  if (FAKE) {
    // Harness self-check against known canvas scenes (these photos pass in the regular E2E suite).
    const by = Object.fromEntries(segments.map((s) => [s.id, s]));
    expect(by.seated!.pass, 'seated').toBe(true);
    expect(by.phone!.pass, 'phone').toBe(true);
    expect(by.away!.pass, 'away').toBe(true);
    expect(by.return!.pass, 'return').toBe(true);
  }
  await ctx.close();
});
