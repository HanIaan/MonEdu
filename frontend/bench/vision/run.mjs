#!/usr/bin/env node
/**
 * Runs harness/bench.ts in headless Chromium over the manifest and writes .cache/results/raw.json.
 * Usage: node build.mjs && node run.mjs [--limit N] [--port 3101]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const limit = Number(arg('--limit', 1e9));
// --set coco (default): manifest.json, jitter on phone_pos/phone_neg. --set commons: commons-manifest.json + Face Landmarker.
const set = arg('--set', 'coco');
const port = Number(arg('--port', 3101));
const entries =
  set === 'commons'
    ? JSON.parse(readFileSync(join(HERE, 'commons-manifest.json'), 'utf8')).items.filter((i) => i.status === 'ok' && !i.exclude)
    : JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8')).entries;
const prefix = set === 'commons' ? '/commons/' : '/images/';
const files = [...new Set(entries.map((e) => e.file))].slice(0, limit);
const jitterFiles = set === 'commons' ? [] : [...new Set(entries.filter((e) => e.subset === 'phone_pos' || e.subset === 'phone_neg').map((e) => e.file))];

const DETECTORS = [
  { key: 'lite0_int8', file: 'efficientdet_lite0.tflite' },
  { key: 'lite0_f16', file: 'efficientdet_lite0_float16.tflite' },
  { key: 'lite2_int8', file: 'efficientdet_lite2_int8.tflite' },
  { key: 'ssd_mnv2_f32', file: 'ssd_mobilenet_v2_float32.tflite' },
];
const RES = [
  { key: '320', w: 320, h: 240 },
  { key: '640', w: 640, h: 480 },
];
const JITTER_CONFIGS = [
  { res: '320', det: 'lite0_int8', roi: false },
  { res: '640', det: 'lite0_int8', roi: false },
  { res: '640', det: 'lite0_int8', roi: true },
  { res: '320', det: 'lite2_int8', roi: false },
  { res: '640', det: 'lite2_int8', roi: false },
];

const server = spawn(process.execPath, [join(HERE, 'server.mjs'), String(port)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 500));
const chromium = await loadChromium();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  await page.goto(`http://127.0.0.1:${port}/index.html`);
  await page.waitForFunction(() => typeof window.runBench === 'function');
  const ua = await page.evaluate(() => navigator.userAgent);
  const t0 = Date.now();
  const timer = setInterval(async () => {
    const n = await page.evaluate(() => window.__progress ?? 0).catch(() => '?');
    console.log(`progress ${n}/${files.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }, 30_000);
  const out = await page.evaluate(
    (req) => window.runBench(req),
    {
      images: files.map((f) => `${prefix}${f}`),
      detectors: DETECTORS,
      resolutions: RES,
      jitterImages: files.filter((f) => jitterFiles.includes(f)).map((f) => `${prefix}${f}`),
      faceLandmarker: set === 'commons' ? 'face_landmarker.task' : undefined,
      jitter: 8,
      jitterConfigs: JITTER_CONFIGS,
    },
  );
  clearInterval(timer);
  mkdirSync(join(HERE, '.cache', 'results'), { recursive: true });
  const meta = { date: new Date().toISOString(), userAgent: ua, platform: `${process.platform} ${process.arch}`, loadMs: out.loadMs, wallS: (Date.now() - t0) / 1000 };
  writeFileSync(join(HERE, '.cache', 'results', set === 'commons' ? 'raw-commons.json' : 'raw.json'), JSON.stringify({ meta, detectors: DETECTORS, results: out.results }));
  console.log('done', meta, 'errors', out.results.filter((r) => r.error).length);
} finally {
  await browser.close();
  server.kill();
}
