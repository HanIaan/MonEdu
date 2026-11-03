#!/usr/bin/env node
/** Bundles harness/*.ts (+ the production modules they import) for the browser into $BENCH_BUILD_DIR (default: OS tmp). */
import { build } from 'rolldown';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..', '..');
// Generated bundles live outside the repo tree so `eslint .` never lints them.
export const SITE = process.env.BENCH_BUILD_DIR ?? join(tmpdir(), 'study-monitor-vision-bench');
mkdirSync(SITE, { recursive: true });

for (const name of ['bench', 'e2e']) {
  if (!existsSync(join(HERE, 'harness', `${name}.ts`))) continue;
  await build({
    input: join(HERE, 'harness', `${name}.ts`),
    external: ['@mediapipe/tasks-vision'],
    resolve: { alias: { '@': join(FRONTEND, 'src') } },
    output: { file: join(SITE, `${name}.js`), format: 'esm', codeSplitting: false, paths: { '@mediapipe/tasks-vision': '/vision_bundle.mjs' } },
    logLevel: 'warn',
  });
}
cpSync(join(FRONTEND, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'), join(SITE, 'vision_bundle.mjs'));
writeFileSync(
  join(SITE, 'index.html'),
  '<!doctype html><meta charset="utf-8"><title>bench</title><script type="module" src="/bench.js"></script>\n',
);
writeFileSync(
  join(SITE, 'e2e.html'),
  '<!doctype html><meta charset="utf-8"><title>e2e</title><video id="v" muted playsinline style="width:2px;height:2px"></video><script type="module" src="/e2e.js"></script>\n',
);
console.log('built →', SITE);
