#!/usr/bin/env node
/**
 * Runs harness/e2e.ts (real MonitoringController, real models on the main thread) in headless Chromium.
 * Usage: node run-e2e.mjs --scenes "/commons/a.jpg@0,/commons/b.jpg@40000" --duration 80000
 *        [--camera 640x480] [--out name]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const port = Number(arg('--port', 3101));
const scenes = arg('--scenes', '').split(',').filter(Boolean).map((s) => {
  const [url, from] = s.split('@');
  return { url, fromMs: Number(from ?? 0) };
});
const durationMs = Number(arg('--duration', 60000));
const cam = arg('--camera');
const config = cam ? { camera: { width: Number(cam.split('x')[0]), height: Number(cam.split('x')[1]), frameRate: 15 } } : undefined;

const server = spawn(process.execPath, [join(HERE, 'server.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const chromium = await loadChromium();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && !m.text().includes('XNNPACK') && console.error('[page]', m.text()));
  await page.goto(`http://127.0.0.1:${port}/e2e.html`);
  await page.waitForFunction(() => typeof window.runE2E === 'function');
  const res = await page.evaluate((req) => window.runE2E(req), { scenes, durationMs, config });
  const rel = res.transitions.map((t) => ({
    from: t.from,
    state: t.state,
    reason: t.reason,
    detectedAtS: +((t.detectedAt - res.startedAt) / 1000).toFixed(1),
    emittedAtS: +((t.emittedAt - res.startedAt) / 1000).toFixed(1),
    signals: t.signals,
  }));
  const last = res.snapshots.at(-1);
  const out = { scenes, durationMs, config, camera: res.camera, transitions: rel, lastPerf: last?.perf, snapshots: res.snapshots };
  mkdirSync(join(HERE, '.cache', 'results'), { recursive: true });
  writeFileSync(join(HERE, '.cache', 'results', `e2e-${arg('--out', 'run')}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ camera: res.camera, transitions: rel.map(({ signals, ...r }) => ({ ...r, signals })), lastPerf: last?.perf }, null, 1));
  const ph = res.snapshots.map((s) => s.phone).filter((v) => v > 0);
  console.log('phone score samples (>0):', ph.length, 'max', Math.max(0, ...ph).toFixed(2), 'person', res.snapshots.map((s) => s.person).filter((v) => v !== null).slice(-3));
} finally {
  await browser.close();
  server.kill();
}
