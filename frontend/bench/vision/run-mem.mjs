#!/usr/bin/env node
/**
 * Model size / memory / single-model latency probe. Each model is loaded in a FRESH page (cross-origin
 * isolated, so performance.measureUserAgentSpecificMemory() includes wasm memory) and run 31× on one
 * image (first run excluded). Writes .cache/results/mem.json.
 * Usage: node build.mjs && node run-mem.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadChromium } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const port = 3101;
const { entries } = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
// A fixed phone_pos image as the probe input (640×480-ish photo).
copyFileSync(join(HERE, '.cache', 'images', entries.find((e) => e.subset === 'phone_pos').file), join(HERE, '.cache', 'images', 'probe.jpg'));

const MODELS = [
  { kind: 'face', file: 'blaze_face_short_range.tflite' },
  { kind: 'pose', file: 'pose_landmarker_lite.task' },
  { kind: 'det', file: 'efficientdet_lite0.tflite' },
  { kind: 'det', file: 'efficientdet_lite0_float16.tflite' },
  { kind: 'det', file: 'efficientdet_lite2_int8.tflite' },
  { kind: 'det', file: 'ssd_mobilenet_v2_float32.tflite' },
];
const RES = [
  [320, 240],
  [640, 480],
];
const server = spawn(process.execPath, [join(HERE, 'server.mjs'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const chromium = await loadChromium();
const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
const out = [];
try {
  for (const m of MODELS)
    for (const [w, h] of RES) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${port}/index.html`);
      await page.waitForFunction(() => typeof window.memoryProbe === 'function');
      const iso = await page.evaluate(() => crossOriginIsolated);
      const r = await page.evaluate((spec) => window.memoryProbe(spec), { ...m, w, h });
      const bytes = statSync(join(HERE, '.cache', 'models', m.file)).size;
      out.push({ ...m, w, h, fileBytes: bytes, crossOriginIsolated: iso, ...r });
      console.log(m.file, `${w}×${h}`, JSON.stringify(r));
      await ctx.close();
    }
} finally {
  await browser.close();
  server.kill();
}
mkdirSync(join(HERE, '.cache', 'results'), { recursive: true });
writeFileSync(join(HERE, '.cache', 'results', 'mem.json'), JSON.stringify(out, null, 1));
