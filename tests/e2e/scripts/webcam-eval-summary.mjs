#!/usr/bin/env node
// Aggregate webcam field-evaluation runs (test-results/webcam-eval-*.json) into one Markdown table.
// Usage: node scripts/webcam-eval-summary.mjs [--include-fake] [files…]
// Only numbers are read; the JSON files contain no images.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const includeFake = args.includes('--include-fake');
const dir = join(import.meta.dirname, '..', 'test-results');
let files = args.filter((a) => !a.startsWith('--'));
if (!files.length)
  files = readdirSync(dir)
    .filter((f) => /^webcam-eval-.*\.json$/.test(f) && (includeFake || !f.startsWith('webcam-eval-fake-')))
    .map((f) => join(dir, f));
if (!files.length) {
  console.error('no webcam-eval results found (run WEBCAM_EVAL=1 npx playwright test --project webcam-eval)');
  process.exit(1);
}

const runs = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const f = (x, d = 2) => (x === null || x === undefined ? '—' : typeof x === 'number' ? x.toFixed(d) : String(x));

console.log(`runs: ${runs.length}`);
for (const r of runs) console.log(`- ${r.startedAt} ${r.kind} ${r.env?.videoWidth}×${r.env?.videoHeight} note="${r.note}"`);
console.log('');
console.log('| 구간 | 기대 상태 | 통과 | 도달 시간 중앙값 s | 유지율 평균 | 오판 AWAY s | 오판 비집중 s | 얼굴≥0.6 | 어깨 | 사람≥0.5 | 휴대폰≥0.5 | 상태별 시간 합계 s |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
const ids = [...new Set(runs.flatMap((r) => r.segments.map((s) => s.id)))];
for (const id of ids) {
  const segs = runs.flatMap((r) => r.segments.filter((s) => s.id === id));
  const judged = segs.filter((s) => s.pass !== null);
  const states = {};
  for (const s of segs) for (const [k, v] of Object.entries(s.stateSeconds)) states[k] = +((states[k] ?? 0) + v).toFixed(1);
  const ev = (k) => mean(segs.map((s) => s.evidence[k]).filter((x) => x !== null));
  console.log(
    `| ${segs[0].title} (${id}) | ${segs[0].expect ?? '관찰만'} | ${judged.length ? `${judged.filter((s) => s.pass).length}/${judged.length}` : '—'} | ${f(median(segs.map((s) => s.reachedAfterSec).filter((x) => x !== null)), 1)} | ${f(mean(segs.map((s) => s.heldShare).filter((x) => x !== null)))} | ${f(segs.reduce((a, s) => a + (s.falseAwaySec ?? 0), 0), 1)} | ${f(segs.reduce((a, s) => a + (s.falseDistractionSec ?? 0), 0), 1)} | ${f(ev('faceGe06'))} | ${f(ev('upperBody'))} | ${f(ev('personGe05'))} | ${f(ev('phoneGe05'))} | ${JSON.stringify(states)} |`,
  );
}
