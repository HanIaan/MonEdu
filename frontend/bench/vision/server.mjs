#!/usr/bin/env node
/**
 * Static server for the benchmark (same paths as production: /mediapipe/wasm, /models).
 * Sends COOP/COEP so performance.measureUserAgentSpecificMemory() (JS + wasm memory) is available.
 * Usage: node server.mjs [port=3101]
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..', '..');
const port = Number(process.argv[2] ?? 3101);
const ROOTS = [
  ['/mediapipe/wasm/', join(FRONTEND, 'public', 'mediapipe', 'wasm')],
  ['/models/', join(HERE, '.cache', 'models')],
  ['/images/', join(HERE, '.cache', 'images')],
  ['/commons/', join(HERE, '.cache', 'commons')],
  ['/', process.env.BENCH_BUILD_DIR ?? join(tmpdir(), 'study-monitor-vision-bench')],
];
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.mjpeg': 'video/x-motion-jpeg' };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const [prefix, dir] of ROOTS) {
    if (!path.startsWith(prefix)) continue;
    const file = normalize(join(dir, path.slice(prefix.length) || 'index.html'));
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) continue;
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404).end('not found');
}).listen(port, '127.0.0.1', () => console.log(`bench server http://127.0.0.1:${port}`));
