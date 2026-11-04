#!/usr/bin/env node
/**
 * Behaviour metrics of the REAL state machine on measured scores (raw.json / raw-commons.json), used
 * to compare engine versions (RESULTS.md §E). Run it once per engine version and keep the outputs:
 *   node compare.mjs --label v1.2-baseline        → .cache/results/compare-v1.2-baseline.json
 *   node compare.mjs --label v1.3 [--config '{"phoneMinScore":0.4}']
 * Metrics: time to FOCUS_ESTIMATED from the start (people) / false seating (pets, empty); phone suspicion
 * within 60 s and false suspicion on phone-free images, with independent and correlated ("sticky") draws;
 * eyes-closed suspicion on Face Landmarker scores when the engine supports it.
 */
import { build } from 'rolldown';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..', '..');
const RES_DIR = join(HERE, '.cache', 'results');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const label = arg('--label', 'current');
const config = JSON.parse(arg('--config', '{}'));

const BUILD = process.env.BENCH_BUILD_DIR ?? join(tmpdir(), 'study-monitor-vision-bench');
mkdirSync(BUILD, { recursive: true });
const simFile = join(BUILD, `sim-${process.pid}.mjs`);
await build({
  input: join(HERE, 'harness', 'sim.ts'),
  resolve: { alias: { '@': join(FRONTEND, 'src') } },
  output: { file: simFile, format: 'esm' },
  logLevel: 'warn',
});
const sim = await import(pathToFileURL(simFile).href);
const cfg = { ...sim.DEFAULT_ENGINE_CONFIG, ...config };

const raw = JSON.parse(readFileSync(join(RES_DIR, 'raw.json'), 'utf8'));
const { entries } = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const byFile = new Map(raw.results.map((r) => [r.image.replace('/images/', ''), r]));
const subset = (name) => entries.filter((e) => e.subset === name).map((e) => byFile.get(e.file)).filter((r) => r && !r.error);

const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '–');
const f3 = (v) => (Number.isFinite(v) ? v.toFixed(3) : '–');

const RES = '640';
const IV = cfg.inferenceIntervalMs;
const PIV = cfg.phoneIntervalMs;
const scene = (r) => ({ face: r.res[RES].face, shoulders: r.res[RES].shoulders, person: r.res[RES].det.lite0_int8.person, phone: r.res[RES].det.lite0_int8.phone });
const out = { label, config, engine: cfg, seating: [], phone: [], eyes: [] };
const md = [`# compare.mjs — ${label}`, '', `config override: ${JSON.stringify(config)}`, ''];

// ───────────── seating ─────────────
md.push(`## Seating from UNKNOWN (still scene @${RES}, ${IV}/${PIV} ms cadence, 60 s)`, '');
md.push('| Subset | n | expected | reached FOCUS ≤ 60 s | median s | p95 s |', '|---|---|---|---|---|---|');
let commons = [];
try {
  const rc = JSON.parse(readFileSync(join(RES_DIR, 'raw-commons.json'), 'utf8'));
  const cm = JSON.parse(readFileSync(join(HERE, 'commons-manifest.json'), 'utf8')).items.filter((i) => i.status === 'ok' && !i.exclude);
  const byc = new Map(rc.results.map((r) => [r.image.replace('/commons/', ''), r]));
  commons = cm.map((i) => ({ i, r: byc.get(i.file) })).filter((x) => x.r && !x.r.error);
} catch {
  /* commons set not run */
}
const seatSets = [
  ['person_upper', subset('person_upper'), true],
  ['face_hidden', subset('face_hidden'), true],
  ['phone_neg (people)', subset('phone_neg'), true],
  ['commons people', commons.filter((x) => x.i.person).map((x) => x.r), true],
  ['pets', subset('pets'), false],
  ['empty', subset('empty'), false],
  ['commons no person', commons.filter((x) => !x.i.person).map((x) => x.r), false],
];
for (const [name, rs, person] of seatSets) {
  const lat = [];
  for (const r of rs) {
    const l = sim.timeToState({ scene: scene(r), intervalMs: IV, phoneIntervalMs: PIV, durationMs: 60_000, config });
    if (l !== null) lat.push(l / 1000);
  }
  const row = { name, n: rs.length, expected: person ? 'FOCUS' : 'never', rate: lat.length / rs.length, med: pct(lat, 50), p95: pct(lat, 95) };
  out.seating.push(row);
  md.push(`| ${name} | ${row.n} | ${row.expected} | ${f2(row.rate)} | ${f1(row.med)} | ${f1(row.p95)} |`);
}

// ───────────── phone ─────────────
md.push('', `## Phone suspicion (seated student, phone for 60 s; 5 seeds × image; phone_neg = false suspicion over 300 s)`, '');
md.push('| jitter set | draws | per-eval det. rate (pos) | suspected ≤ 60 s | latency median s | p95 s | false suspicion / 300 s (neg) |', '|---|---|---|---|---|---|---|');
const pos = subset('phone_pos');
const neg = subset('phone_neg');
for (const key of ['640/lite0_int8', '320/lite0_int8']) {
  for (const stickiness of [0, 0.8]) {
    const lat = [];
    let hits = 0, runs = 0, fp = 0, fpRuns = 0;
    const rate = pos.reduce((s, r) => s + r.jitter[key].filter((x) => x >= cfg.phoneMinScore).length / r.jitter[key].length, 0) / pos.length;
    for (const r of pos)
      for (let seed = 1; seed <= 5; seed++) {
        runs++;
        const l = sim.phoneLatency({ phoneScores: r.jitter[key], intervalMs: IV, phoneIntervalMs: PIV, durationMs: 60_000, seed, stickiness, config });
        if (l !== null) {
          hits++;
          lat.push(l / 1000);
        }
      }
    for (const r of neg)
      for (let seed = 1; seed <= 5; seed++) {
        fpRuns++;
        if (sim.phoneLatency({ phoneScores: r.jitter[key], intervalMs: IV, phoneIntervalMs: PIV, durationMs: 300_000, seed, stickiness, config }) !== null) fp++;
      }
    const row = { key, stickiness, rate, hit: hits / runs, med: pct(lat, 50), p95: pct(lat, 95), fp: fp / fpRuns, fpRuns };
    out.phone.push(row);
    md.push(`| ${key} | ${stickiness ? `sticky ${stickiness}` : 'independent'} | ${f2(rate)} | ${f2(row.hit)} | ${f1(row.med)} | ${f1(row.p95)} | ${f3(row.fp)} (${fp}/${fpRuns}) |`);
  }
}

// ───────────── eyes closed ─────────────
const lmPath = join(RES_DIR, 'raw-facelm.json');
let lm = null;
try {
  lm = JSON.parse(readFileSync(lmPath, 'utf8'));
} catch {
  /* Face Landmarker pass not run */
}
if (sim.supportsEyes?.()) {
  md.push('', `## Eyes closed → DROWSINESS (still scene from FOCUS_ESTIMATED, 120 s)`, '');
  md.push('| Set | n (face found) | expected | DISTRACTION ≤ 120 s | median s |', '|---|---|---|---|---|');
  const eyeSets = [];
  const lmByFile = new Map((lm?.results ?? []).map((r) => [r.image, r]));
  const withLm = (name, rs, expect) => eyeSets.push([name, rs.filter((r) => r?.res?.[RES]?.faceLm?.found), expect]);
  for (const s of ['person_upper', 'face_hidden', 'phone_neg', 'phone_pos']) withLm(`COCO ${s}`, subset(s).map((r) => lmByFile.get(r.image) ?? r), 'never');
  for (const sit of [...new Set(commons.map((x) => x.i.situation))]) {
    const rs = commons.filter((x) => x.i.situation === sit && x.i.person).map((x) => x.r);
    if (rs.length) withLm(`commons ${sit}`, rs, sit === 'eyes_closed_seated' ? 'DROWSY' : 'never');
  }
  for (const [name, rs, expect] of eyeSets) {
    const lat = [];
    for (const r of rs) {
      const f = r.res[RES];
      const sc = { face: f.face, shoulders: f.shoulders, person: f.det?.lite0_int8?.person ?? 0.9, phone: 0, eyesClosed: Math.min(f.faceLm.eyeBlinkLeft, f.faceLm.eyeBlinkRight) };
      const l = sim.timeToState({ scene: sc, intervalMs: IV, phoneIntervalMs: PIV, durationMs: 120_000, config, from: 'FOCUS_ESTIMATED', target: 'DISTRACTION_SUSPECTED' });
      if (l !== null) lat.push(l / 1000);
    }
    const row = { name, n: rs.length, expect, rate: rs.length ? lat.length / rs.length : NaN, med: pct(lat, 50) };
    out.eyes.push(row);
    md.push(`| ${name} | ${rs.length} | ${expect} | ${lat.length}/${rs.length} | ${f1(row.med)} |`);
  }
}

mkdirSync(RES_DIR, { recursive: true });
writeFileSync(join(RES_DIR, `compare-${label}.json`), JSON.stringify(out, null, 1));
writeFileSync(join(RES_DIR, `compare-${label}.md`), md.join('\n') + '\n');
console.log(md.join('\n'));
