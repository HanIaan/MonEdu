/**
 * In-browser benchmark entry (bundled by ../build.mjs, driven by ../run.mjs through Playwright).
 * Runs the real MediaPipe Tasks Vision models (same files and options as src/lib/vision) on still
 * images resampled to camera resolutions, and reduces results with the production reducers from
 * src/lib/vision/observation.ts. Results go back to Node as plain JSON; nothing is uploaded anywhere.
 *
 * Detectors run in IMAGE mode here (stills are unrelated frames; VIDEO-mode pose tracking would carry
 * between photos — see public/models/README.md caveat). Production uses VIDEO mode.
 */
import {
  FaceDetector,
  FaceLandmarker,
  FilesetResolver,
  ObjectDetector,
  PoseLandmarker,
  type Detection,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import { bestFaceScore, bestPhoneScore, shoulderScore } from '@/lib/vision/observation';

type Canvas = OffscreenCanvas;

export interface DetectorSpec {
  key: string;
  file: string;
}

export interface Resolution {
  key: string;
  w: number;
  h: number;
}

export interface BenchRequest {
  images: string[];
  detectors: DetectorSpec[];
  resolutions: Resolution[];
  /** Images (subset of `images`) that additionally get `jitter` perturbed frames for temporal tests. */
  jitterImages: string[];
  jitter: number;
  /** Which (resolution, detector) pairs to run on jittered frames, plus the ROI variant. */
  jitterConfigs: { res: string; det: string; roi: boolean }[];
  /** Optional Face Landmarker model (research only, section C): blink blendshapes + head pitch. */
  faceLandmarker?: string;
}

export interface FaceLmOut {
  found: boolean;
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  /** atan2(m6, m10) of the facial transformation matrix, degrees (sign convention not verified). */
  pitchDeg: number | null;
  ms: number;
}

interface DetOut {
  phone: number;
  person: number;
  ms: number;
}

export interface ResOut {
  w: number;
  h: number;
  face: number;
  faceMs: number;
  shoulders: number;
  /** visibility of landmarks 0..24 (head, shoulders, elbows, wrists, hands, hips); [] when no pose. */
  vis: number[];
  poseMs: number;
  det: Record<string, DetOut>;
  /** Object detector on a crop around the upper-body landmarks (null when no pose). */
  roi: Record<string, (DetOut & { cw: number; ch: number; cropMs: number }) | null>;
  faceLm?: FaceLmOut;
}

export interface ImageOut {
  image: string;
  res: Record<string, ResOut>;
  jitter?: Record<string, number[]>;
  jitterPerson?: Record<string, number[]>;
  error?: string;
}

const now = () => performance.now();

function bestCategory(dets: Detection[] | null, name: string): number {
  if (name === 'cell phone') return bestPhoneScore(dets);
  let best = 0;
  for (const d of dets ?? []) for (const c of d.categories) if (c.categoryName === name) best = Math.max(best, c.score);
  return best;
}

/** Fit `src` inside w×h preserving aspect (what a w×h webcam request yields for a 4:3 scene). */
function resample(src: ImageBitmap | Canvas, w: number, h: number): Canvas {
  const s = Math.min(w / src.width, h / src.height);
  const cw = Math.round(src.width * s);
  const ch = Math.round(src.height * s);
  const c = new OffscreenCanvas(cw, ch);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(src, 0, 0, cw, ch);
  return c;
}

/** Deterministic PRNG (mulberry32) so jitter is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small camera-like perturbation: crop 90–100 %, shift, brightness ±15 %, slight blur sometimes. */
function jitterFrame(src: ImageBitmap, rand: () => number): Canvas {
  const scale = 0.9 + rand() * 0.1;
  const sw = src.width * scale;
  const sh = src.height * scale;
  const sx = rand() * (src.width - sw);
  const sy = rand() * (src.height - sh);
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  const b = 0.85 + rand() * 0.3;
  const blur = rand() < 0.3 ? 1 : 0;
  ctx.filter = `brightness(${b.toFixed(2)})${blur ? ' blur(1px)' : ''}`;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, src.width, src.height);
  return c;
}

/** Upper-body ROI from pose landmarks 0..22 (head, shoulders, arms, hands), expanded, ≥ 40 % of the frame side. */
export function upperBodyRoi(lm: NormalizedLandmark[], w: number, h: number) {
  const pts = lm.slice(0, 23);
  if (pts.length < 13) return null;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const padX = (x1 - x0) * 0.25 + 0.05;
  const padY = (y1 - y0) * 0.25 + 0.05;
  x0 = Math.max(0, x0 - padX);
  y0 = Math.max(0, y0 - padY);
  x1 = Math.min(1, x1 + padX);
  y1 = Math.min(1, y1 + padY);
  // Minimum size: never zoom more than 2.5× (detector needs context).
  const minSide = 0.4;
  if (x1 - x0 < minSide) {
    const cx = (x0 + x1) / 2;
    x0 = Math.max(0, cx - minSide / 2);
    x1 = Math.min(1, x0 + minSide);
  }
  if (y1 - y0 < minSide) {
    const cy = (y0 + y1) / 2;
    y0 = Math.max(0, cy - minSide / 2);
    y1 = Math.min(1, y0 + minSide);
  }
  return { x: Math.round(x0 * w), y: Math.round(y0 * h), w: Math.round((x1 - x0) * w), h: Math.round((y1 - y0) * h) };
}

function crop(src: Canvas, r: { x: number; y: number; w: number; h: number }): Canvas {
  const c = new OffscreenCanvas(Math.max(1, r.w), Math.max(1, r.h));
  c.getContext('2d')!.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return createImageBitmap(await r.blob());
}

interface Models {
  face: FaceDetector;
  pose: PoseLandmarker;
  det: Map<string, ObjectDetector>;
  faceLm: FaceLandmarker | null;
}

async function createModels(detectors: DetectorSpec[], faceLandmarker?: string): Promise<Models> {
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const face = await FaceDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite', delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.2,
  });
  const pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numPoses: 1,
    outputSegmentationMasks: false,
  });
  const det = new Map<string, ObjectDetector>();
  for (const d of detectors) {
    det.set(
      d.key,
      await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `/models/${d.file}`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        categoryAllowlist: ['cell phone', 'person'],
        scoreThreshold: 0.05,
        maxResults: 10,
      }),
    );
  }
  const faceLm = faceLandmarker
    ? await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `/models/${faceLandmarker}`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      })
    : null;
  return { face, pose, det, faceLm };
}

function runFaceLm(f: FaceLandmarker, img: Canvas): FaceLmOut {
  const t0 = now();
  const r = f.detect(img);
  const ms = now() - t0;
  const bs = r.faceBlendshapes[0]?.categories ?? [];
  const get = (n: string) => bs.find((c) => c.categoryName === n)?.score ?? 0;
  const m = r.facialTransformationMatrixes[0]?.data;
  return {
    found: r.faceLandmarks.length > 0,
    eyeBlinkLeft: +get('eyeBlinkLeft').toFixed(3),
    eyeBlinkRight: +get('eyeBlinkRight').toFixed(3),
    pitchDeg: m && m.length >= 11 ? +((Math.atan2(m[6]!, m[10]!) * 180) / Math.PI).toFixed(1) : null,
    ms,
  };
}

function runDet(d: ObjectDetector, img: Canvas): DetOut {
  const t0 = now();
  const r = d.detect(img).detections;
  return { phone: bestCategory(r, 'cell phone'), person: bestCategory(r, 'person'), ms: now() - t0 };
}

async function benchImage(m: Models, req: BenchRequest, url: string): Promise<ImageOut> {
  const bmp = await loadBitmap(url);
  const out: ImageOut = { image: url, res: {} };
  try {
    for (const res of req.resolutions) {
      const frame = resample(bmp, res.w, res.h);
      let t0 = now();
      const face = bestFaceScore(m.face.detect(frame).detections);
      const faceMs = now() - t0;
      t0 = now();
      const pr = m.pose.detect(frame);
      const poseMs = now() - t0;
      const lm = pr.landmarks[0] ?? [];
      pr.close();
      const ro: ResOut = {
        w: frame.width,
        h: frame.height,
        face,
        faceMs,
        shoulders: shoulderScore(lm),
        vis: lm.slice(0, 25).map((p) => +(p.visibility ?? 0).toFixed(3)),
        poseMs,
        det: {},
        roi: {},
      };
      for (const [key, d] of m.det) ro.det[key] = runDet(d, frame);
      const roiRect = lm.length ? upperBodyRoi(lm, frame.width, frame.height) : null;
      for (const [key, d] of m.det) {
        if (!roiRect) {
          ro.roi[key] = null;
          continue;
        }
        const tc = now();
        const c = crop(frame, roiRect);
        const cropMs = now() - tc;
        ro.roi[key] = { ...runDet(d, c), cw: c.width, ch: c.height, cropMs };
      }
      if (m.faceLm) ro.faceLm = runFaceLm(m.faceLm, frame);
      out.res[res.key] = ro;
    }
    if (req.jitterImages.includes(url) && req.jitter > 0) {
      out.jitter = {};
      out.jitterPerson = {};
      const rand = rng(url.split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7));
      const frames: Canvas[] = Array.from({ length: req.jitter }, () => jitterFrame(bmp, rand));
      for (const jc of req.jitterConfigs) {
        const res = req.resolutions.find((r) => r.key === jc.res)!;
        const d = m.det.get(jc.det)!;
        const key = `${jc.res}/${jc.det}${jc.roi ? '/roi' : ''}`;
        out.jitter[key] = [];
        out.jitterPerson[key] = [];
        for (const f of frames) {
          let img = resample(f, res.w, res.h);
          if (jc.roi) {
            const pr = m.pose.detect(img);
            const lm = pr.landmarks[0] ?? [];
            pr.close();
            const r = lm.length ? upperBodyRoi(lm, img.width, img.height) : null;
            if (r) img = crop(img, r);
          }
          const o = runDet(d, img);
          out.jitter[key].push(+o.phone.toFixed(3));
          out.jitterPerson[key].push(+o.person.toFixed(3));
        }
      }
    }
  } finally {
    bmp.close();
  }
  return out;
}

declare global {
  interface Window {
    runBench(req: BenchRequest): Promise<{ results: ImageOut[]; loadMs: number }>;
    memoryProbe(spec: { kind: 'face' | 'pose' | 'det'; file: string; w: number; h: number }): Promise<Record<string, number | null>>;
    __progress?: number;
  }
}

window.runBench = async (req) => {
  const t0 = now();
  const m = await createModels(req.detectors, req.faceLandmarker);
  const loadMs = now() - t0;
  // Warm-up (first inference allocates; excluded from timing).
  const warm = new OffscreenCanvas(320, 240);
  warm.getContext('2d')!.fillRect(0, 0, 10, 10);
  m.face.detect(warm);
  m.pose.detect(warm).close();
  for (const d of m.det.values()) d.detect(warm);
  const results: ImageOut[] = [];
  for (const [i, url] of req.images.entries()) {
    try {
      results.push(await benchImage(m, req, url));
    } catch (e) {
      results.push({ image: url, res: {}, error: e instanceof Error ? e.message : String(e) });
    }
    window.__progress = i + 1;
  }
  m.face.close();
  m.pose.close();
  for (const d of m.det.values()) d.close();
  m.faceLm?.close();
  return { results, loadMs };
};

type MemRecord = Record<string, number | null>;
async function uaMemory(): Promise<number | null> {
  const p = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  if (!crossOriginIsolated || !p.measureUserAgentSpecificMemory) return null;
  try {
    return (await p.measureUserAgentSpecificMemory()).bytes;
  } catch {
    return null; // headless Chromium 156 throws SecurityError even when cross-origin isolated
  }
}

/** Track every wasm linear memory created by tasks-vision (sum of buffer sizes = wasm heap). */
const wasmMemories: WebAssembly.Memory[] = [];
const trackInstance = (inst: WebAssembly.Instance) => {
  for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Memory) wasmMemories.push(v);
};
const origInstantiate = WebAssembly.instantiate.bind(WebAssembly);
const origStreaming = WebAssembly.instantiateStreaming?.bind(WebAssembly);
(WebAssembly as { instantiate: unknown }).instantiate = async (...args: Parameters<typeof WebAssembly.instantiate>) => {
  const r = (await (origInstantiate as (...a: unknown[]) => Promise<unknown>)(...args)) as WebAssembly.WebAssemblyInstantiatedSource | WebAssembly.Instance;
  trackInstance('instance' in r ? r.instance : r);
  return r;
};
if (origStreaming) {
  (WebAssembly as { instantiateStreaming: unknown }).instantiateStreaming = async (...args: Parameters<typeof WebAssembly.instantiateStreaming>) => {
    const r = await origStreaming(...args);
    trackInstance(r.instance);
    return r;
  };
}
const wasmBytes = () => wasmMemories.reduce((n, m) => n + m.buffer.byteLength, 0);
const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;

/** Load ONE model in a fresh page and report memory deltas + 30-frame latency. */
window.memoryProbe = async ({ kind, file, w, h }) => {
  const before = await uaMemory();
  const heap0 = heap();
  const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
  const base = { baseOptions: { modelAssetPath: `/models/${file}`, delegate: 'CPU' as const }, runningMode: 'IMAGE' as const };
  const task =
    kind === 'face'
      ? await FaceDetector.createFromOptions(fileset, base)
      : kind === 'pose'
        ? await PoseLandmarker.createFromOptions(fileset, { ...base, numPoses: 1 })
        : await ObjectDetector.createFromOptions(fileset, { ...base, categoryAllowlist: ['cell phone', 'person'], maxResults: 10 });
  const img = await loadBitmap('/images/probe.jpg');
  const frame = resample(img, w, h);
  const times: number[] = [];
  for (let i = 0; i < 31; i++) {
    const t0 = now();
    const r = (task as { detect(x: Canvas): unknown }).detect(frame);
    (r as { close?: () => void }).close?.();
    if (i > 0) times.push(now() - t0);
  }
  const after = await uaMemory();
  const rec: MemRecord = {
    uaMemBefore: before,
    uaMemAfter: after,
    uaMemDelta: before !== null && after !== null ? after - before : null,
    heapDelta: heap0 !== null && heap() !== null ? heap()! - heap0 : null,
    wasmInstances: wasmMemories.length,
    wasmHeapBytes: wasmBytes(),
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
  };
  task.close();
  return rec;
};
