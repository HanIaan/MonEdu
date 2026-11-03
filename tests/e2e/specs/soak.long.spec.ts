/**
 * @slow Long soak (Phase 2). SOAK_MINUTES (default 30), SOAK_AWAY_EVERY_MIN (default 10; 0 = never).
 *
 * Launches its own Chromium via launchServer() so the whole browser process tree can be sampled with
 * `ps` (cumulative CPU time per process). Measures, every SAMPLE_SEC:
 *   - browser-wide CPU (all Chromium processes), page renderer CPU, GPU/utility CPU      [ps, measured]
 *   - main-thread CPU (CDP Performance.TaskDuration)                                     [CDP, measured]
 *   - AI worker CPU ≈ renderer CPU − main-thread CPU                                     [DERIVED]
 *   - JS heap, DOM nodes, JS event listeners                                             [CDP]
 *   - inference FPS, mean/p95 inference ms, frame gaps > 2 s                             [window.__smDiag]
 *   - server response time per endpoint (heartbeat, transitions)                         [Resource Timing]
 *   - server-side focus accounting vs. wall clock                                        [day report API]
 * Every SOAK_AWAY_EVERY_MIN the scene switches to "nobody" for 45 s to exercise AWAY↔FOCUS transitions.
 * Writes test-results/soak-long-<minutes>m.json.
 */
import { chromium, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API, apiLogin, auth, endStudy, installCanvasCamera, seoulToday, startStudy, state, uiLogin, USERS } from './helpers';

declare global {
  interface Window {
    __smDiag?: { snapshot(): { engineState: string; cameraStatus: string; lastFrameAt: number | null; lastObservation: { inferenceMs: number } | null; perf: { framesProcessed: number; framesSkipped: number; framesDropped?: number; lowPower?: boolean; effectiveIntervalMs?: number } } };
  }
}

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const SAMPLE_SEC = 60;

type Proc = { pid: number; ppid: number; cpuSec: number; rssMB: number; kind: string };

function cpuSeconds(t: string): number {
  // macOS/Linux `ps -o time=`: [[dd-]hh:]mm:ss[.cc]
  let days = 0;
  if (t.includes('-')) {
    const [d, rest] = t.split('-');
    days = Number(d);
    t = rest!;
  }
  const parts = t.split(':').map(Number).reverse();
  return days * 86400 + (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
}

function processTree(rootPid: number): Proc[] {
  const out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,time=,rss=,command='], { maxBuffer: 32 * 1024 * 1024 }).toString();
  const all = out
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => {
      const cmd = m[5]!;
      const kind = cmd.match(/--type=([a-z-]+)/)?.[1] ?? 'browser';
      const util = cmd.match(/--utility-sub-type=([\w.]+)/)?.[1];
      return { pid: Number(m[1]), ppid: Number(m[2]), cpuSec: cpuSeconds(m[3]!), rssMB: Number(m[4]) / 1024, kind: util ? `utility:${util}` : kind };
    });
  const keep = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) if (!keep.has(p.pid) && keep.has(p.ppid)) (keep.add(p.pid), (grew = true));
  }
  return all.filter((p) => keep.has(p.pid));
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

test('@slow long soak: CPU (browser/renderer/main/worker), memory, FPS, inference p95, server latency', async ({ request }) => {
  const minutes = Number(process.env.SOAK_MINUTES ?? 30);
  const awayEvery = Number(process.env.SOAK_AWAY_EVERY_MIN ?? 10);
  test.setTimeout((minutes + 6) * 60_000);

  const server = await chromium.launchServer({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const rootPid = server.process().pid!;
  const browser = await chromium.connect(server.wsEndpoint());
  const ctx = await browser.newContext({ permissions: ['camera'], baseURL: WEB, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await installCanvasCamera(ctx, 'person');
  const page = await ctx.newPage();

  const latency: Record<string, number[]> = {};
  page.on('requestfinished', (req) => {
    const u = new URL(req.url());
    if (!u.pathname.startsWith('/api/')) return;
    const key = `${req.method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '{id}').replace(/\d{4}-\d{2}-\d{2}/, '{date}')}`;
    const t = req.timing();
    if (t.responseEnd > 0) (latency[key] ??= []).push(t.responseEnd - Math.max(0, t.requestStart));
  });

  const student = process.env.SOAK_USER ?? USERS.soak;
  const { token } = await apiLogin(request, student);
  const dayTotals = async () => {
    const r = await request.get(`${API}/api/v1/me/study-days/${seoulToday()}`, { headers: auth(token) });
    expect(r.status()).toBe(200);
    return (await r.json()).totals as { focusSeconds: number; awaySeconds: number; unknownSeconds: number; distractionSeconds: number; breakSeconds: number };
  };

  await uiLogin(page, student);
  await startStudy(page);
  await expect(state(page)).toHaveAttribute('data-state', 'FOCUS_ESTIMATED', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__smDiag, undefined, { timeout: 10_000 });

  // In-page collector: one sample per processed frame (lastFrameAt changes), polled at 5 Hz.
  await page.evaluate(() => {
    const w = window as unknown as { __soak: { inf: number[]; gaps: number; maxGapMs: number; stateChanges: string[] } } & Window;
    w.__soak = { inf: [], gaps: 0, maxGapMs: 0, stateChanges: [] };
    let last: number | null = null;
    let lastState = '';
    setInterval(() => {
      const s = w.__smDiag?.snapshot();
      if (!s) return;
      if (s.engineState !== lastState) (w.__soak.stateChanges.push(`${new Date().toISOString()} ${s.engineState}`), (lastState = s.engineState));
      if (s.lastFrameAt !== null && s.lastFrameAt !== last) {
        if (last !== null) {
          const gap = s.lastFrameAt - last;
          w.__soak.maxGapMs = Math.max(w.__soak.maxGapMs, gap);
          if (gap > 2000) w.__soak.gaps++;
        }
        last = s.lastFrameAt;
        if (s.lastObservation) w.__soak.inf.push(s.lastObservation.inferenceMs);
      }
    }, 200);
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const cdpMetrics = async () => {
    await cdp.send('HeapProfiler.collectGarbage').catch(() => undefined);
    const { metrics } = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(metrics.map((x: { name: string; value: number }) => [x.name, x.value])) as Record<string, number>;
  };
  const diag = () =>
    page.evaluate(() => {
      const w = window as unknown as { __soak: { inf: number[]; gaps: number; maxGapMs: number; stateChanges: string[] } } & Window;
      const s = w.__smDiag!.snapshot();
      const inf = w.__soak.inf.splice(0);
      return { inf, gaps: w.__soak.gaps, maxGapMs: w.__soak.maxGapMs, perf: s.perf, engineState: s.engineState, cameraStatus: s.cameraStatus };
    });

  const totals0 = await dayTotals();
  const t0 = Date.now();
  let prev = { t: t0, procs: processTree(rootPid), cdp: await cdpMetrics(), frames: (await diag()).perf.framesProcessed };
  const samples: Record<string, unknown>[] = [];
  const allInf: number[] = [];
  let awaySec = 0;

  for (let i = 1; i <= Math.round((minutes * 60) / SAMPLE_SEC); i++) {
    const elapsedMin = ((i - 1) * SAMPLE_SEC) / 60;
    if (awayEvery > 0 && i > 1 && elapsedMin % awayEvery === 0) {
      // leave for 45 s (AWAY needs 30 s), then come back; still inside this sample window
      await page.evaluate(() => (window as unknown as { __fakeCam: { setScene(s: string): void } }).__fakeCam.setScene('nobody'));
      await page.waitForTimeout(45_000);
      awaySec += 45;
      await page.evaluate(() => (window as unknown as { __fakeCam: { setScene(s: string): void } }).__fakeCam.setScene('person'));
      await page.waitForTimeout((SAMPLE_SEC - 45) * 1000);
    } else {
      await page.waitForTimeout(SAMPLE_SEC * 1000);
    }
    const now = Date.now();
    const procs = processTree(rootPid);
    const m = await cdpMetrics();
    const d = await diag();
    const dt = (now - prev.t) / 1000;
    const byPid = new Map(prev.procs.map((p) => [p.pid, p]));
    const delta = procs.map((p) => ({ ...p, d: p.cpuSec - (byPid.get(p.pid)?.cpuSec ?? p.cpuSec) }));
    const renderer = delta.filter((p) => p.kind === 'renderer').sort((a, b) => b.d - a.d)[0];
    const browserCpu = delta.reduce((a, p) => a + p.d, 0) / dt;
    const rendererCpu = (renderer?.d ?? 0) / dt;
    const mainCpu = (m.TaskDuration! - prev.cdp.TaskDuration!) / dt;
    const gpuCpu = delta.filter((p) => p.kind === 'gpu-process').reduce((a, p) => a + p.d, 0) / dt;
    allInf.push(...d.inf);
    const s = {
      minute: +((now - t0) / 60000).toFixed(1),
      browserCpuPct: +(browserCpu * 100).toFixed(1),
      rendererCpuPct: +(rendererCpu * 100).toFixed(1),
      mainThreadCpuPct: +(mainCpu * 100).toFixed(1),
      workerCpuPctDerived: +(Math.max(0, rendererCpu - mainCpu) * 100).toFixed(1),
      gpuCpuPct: +(gpuCpu * 100).toFixed(1),
      browserRssMB: +procs.reduce((a, p) => a + p.rssMB, 0).toFixed(0),
      rendererRssMB: +(renderer?.rssMB ?? 0).toFixed(0),
      heapMB: +(m.JSHeapUsedSize! / 1e6).toFixed(2),
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      fps: +((d.perf.framesProcessed - prev.frames) / dt).toFixed(2),
      infMeanMs: mean(d.inf) && +mean(d.inf)!.toFixed(1),
      infP95Ms: pct(d.inf, 0.95) && +pct(d.inf, 0.95)!.toFixed(1),
      framesSkipped: d.perf.framesSkipped,
      framesDropped: d.perf.framesDropped ?? null,
      lowPower: d.perf.lowPower ?? null,
      effectiveIntervalMs: d.perf.effectiveIntervalMs ?? null,
      frameGapsOver2s: d.gaps,
      maxFrameGapMs: d.maxGapMs,
      loadAvg1m: +loadavg()[0]!.toFixed(2),
      engineState: d.engineState,
      cameraStatus: d.cameraStatus,
    };
    samples.push(s);
    console.log(`[soak-long] ${JSON.stringify(s)}`);
    prev = { t: now, procs, cdp: m, frames: d.perf.framesProcessed };
  }

  const elapsedSec = (Date.now() - t0) / 1000;
  // let the client flush the last transition before reading server totals
  await page.waitForTimeout(3_000);
  const totals1 = await dayTotals();
  const stateChanges = await page.evaluate(() => (window as unknown as { __soak: { stateChanges: string[] } }).__soak.stateChanges);
  const lat = Object.fromEntries(
    Object.entries(latency).map(([k, xs]) => [k, { n: xs.length, p50: pct(xs, 0.5), p95: pct(xs, 0.95), p99: pct(xs, 0.99), max: Math.max(...xs) }]),
  );
  const warm = samples.slice(1);
  const avg = (k: string) => +(mean(warm.map((s) => s[k] as number)) ?? 0).toFixed(1);
  const result = {
    minutes,
    awayEveryMin: awayEvery,
    elapsedSec,
    summary: {
      browserCpuPct: avg('browserCpuPct'),
      rendererCpuPct: avg('rendererCpuPct'),
      mainThreadCpuPct: avg('mainThreadCpuPct'),
      workerCpuPctDerived: avg('workerCpuPctDerived'),
      gpuCpuPct: avg('gpuCpuPct'),
      fps: avg('fps'),
      infMeanMs: +(mean(allInf) ?? 0).toFixed(1),
      infP95Ms: pct(allInf, 0.95),
      heapFirstMB: warm[0]?.heapMB,
      heapLastMB: warm.at(-1)?.heapMB,
      heapMaxMB: Math.max(...warm.map((s) => s.heapMB as number)),
      browserRssFirstMB: warm[0]?.browserRssMB,
      browserRssLastMB: warm.at(-1)?.browserRssMB,
      listenersFirst: warm[0]?.listeners,
      listenersLast: warm.at(-1)?.listeners,
      nodesFirst: warm[0]?.nodes,
      nodesLast: warm.at(-1)?.nodes,
      frameGapsOver2s: samples.at(-1)?.frameGapsOver2s,
      maxFrameGapMs: samples.at(-1)?.maxFrameGapMs,
      focusAddedSec: totals1.focusSeconds - totals0.focusSeconds,
      awayAddedSec: totals1.awaySeconds - totals0.awaySeconds,
      unknownAddedSec: totals1.unknownSeconds - totals0.unknownSeconds,
      scriptedAwaySec: awaySec,
    },
    serverLatencyMs: lat,
    stateChanges,
    samples,
  };
  mkdirSync(join(import.meta.dirname, '..', 'test-results'), { recursive: true });
  writeFileSync(join(import.meta.dirname, '..', 'test-results', `soak-long-${minutes}m.json`), JSON.stringify(result, null, 2));
  console.log(`[soak-long] SUMMARY ${JSON.stringify(result.summary)}`);
  console.log(`[soak-long] LATENCY ${JSON.stringify(lat)}`);

  const first = warm[0]!;
  const last = warm.at(-1)!;
  expect((last.heapMB as number) - (first.heapMB as number), 'JS heap growth after warm-up (MB)').toBeLessThan(30);
  expect((last.listeners as number) - (first.listeners as number), 'event listener leak').toBeLessThan(50);
  expect(result.summary.frameGapsOver2s, 'camera frame gaps > 2 s while visible').toBeLessThanOrEqual(2);
  // Accounting sanity: focus + away + unknown added ≈ elapsed (±60 s; open interval grace ≤ 45 s).
  const accounted = result.summary.focusAddedSec + result.summary.awayAddedSec + result.summary.unknownAddedSec + (totals1.distractionSeconds - totals0.distractionSeconds);
  expect(Math.abs(accounted - elapsedSec), `accounted ${accounted}s vs elapsed ${elapsedSec}s`).toBeLessThan(90);
  expect(result.summary.focusAddedSec, 'focus never exceeds wall-clock minus scripted away time').toBeLessThanOrEqual(elapsedSec - awaySec + 45);

  await endStudy(page);
  await ctx.close();
  await browser.close();
  await server.close();
});
