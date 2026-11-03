#!/usr/bin/env node
/** Downloads the manifest's COCO val2017 images into .cache/images/ (gitignored). Skips existing files. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.cache', 'images');
mkdirSync(OUT, { recursive: true });
const { entries } = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
let done = 0;
let failed = 0;
const queue = [...new Map(entries.map((e) => [e.file, e])).values()];
async function worker() {
  for (let e = queue.shift(); e; e = queue.shift()) {
    const dst = join(OUT, e.file);
    if (existsSync(dst)) {
      done++;
      continue;
    }
    try {
      const r = await fetch(e.cocoUrl);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
      done++;
    } catch (err) {
      failed++;
      console.error('failed', e.file, err.message);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
console.log(`images: ${done} ok, ${failed} failed → ${OUT}`);
process.exit(failed ? 1 : 0);
