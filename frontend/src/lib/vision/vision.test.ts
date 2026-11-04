import { describe, expect, it, vi } from 'vitest';
import type { FrameObservation, VisionPipeline } from '@/features/monitoring/contracts';
import { visionSettingsFromConfig } from './config';
import { assessFrameQuality } from './frameQuality';
import { toFrameObservation, type RawVisionResults } from './observation';
import { AutoVisionPipeline, WorkerVisionPipeline, defaultWorkerFactory, type WorkerLike } from './pipelines';
import type { FromWorker, ToWorker } from './protocol';

const settings = visionSettingsFromConfig(undefined, 'http://localhost:3000');

function pixels(fn: (i: number) => number, n = 32 * 24): Uint8ClampedArray {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const v = fn(i);
    a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = v;
    a[i * 4 + 3] = 255;
  }
  return a;
}

describe('assessFrameQuality', () => {
  it('flags dark, blown-out and uniform frames as LOW', () => {
    expect(assessFrameQuality(pixels(() => 5)).quality).toBe('LOW');
    expect(assessFrameQuality(pixels((i) => (i % 2 ? 10 : 20))).quality).toBe('LOW'); // dark, mean 15
    expect(assessFrameQuality(pixels(() => 252)).quality).toBe('LOW');
    expect(assessFrameQuality(pixels(() => 128)).quality).toBe('LOW'); // covered lens / blank
    expect(assessFrameQuality(new Uint8ClampedArray(0)).quality).toBe('LOW');
  });
  it('accepts a normally lit textured frame', () => {
    const r = assessFrameQuality(pixels((i) => 60 + ((i * 37) % 120)));
    expect(r.quality).toBe('OK');
    expect(r.meanLuma).toBeGreaterThan(60);
    expect(r.lumaStdDev).toBeGreaterThan(20);
  });
});

describe('toFrameObservation', () => {
  const raw = (p: Partial<RawVisionResults>): RawVisionResults => ({
    at: 1,
    frameQuality: 'OK',
    faceDetections: [],
    poseLandmarks: [],
    objectDetections: null,
    phoneEvaluated: false,
    errors: [],
    inferenceMs: 12,
    ...p,
  });
  const lm = (l: number, r: number) => Array.from({ length: 33 }, (_, i) => ({ visibility: i === 11 ? l : i === 12 ? r : 0.99, x: 0.5, y: 0.5 }));

  it('reduces to coarse scores only (no landmarks / boxes)', () => {
    const o = toFrameObservation(
      raw({
        faceDetections: [{ categories: [{ score: 0.7 }] }, { categories: [{ score: 0.93 }] }],
        poseLandmarks: lm(0.8, 0.6),
        objectDetections: [{ categories: [{ score: 0.35, categoryName: 'cell phone' }] }, { categories: [{ score: 0.9, categoryName: 'cup' }] }],
        phoneEvaluated: true,
      }),
      settings,
    );
    expect(o).toEqual({
      at: 1,
      frameQuality: 'OK',
      faceDetected: true,
      faceScore: 0.93,
      upperBodyDetected: true,
      poseScore: 0.6,
      phoneEvaluated: true,
      phoneDetected: false,
      phoneScore: 0.35,
      inferenceMs: 12,
      personDetected: false, // v1.2: object detector ran, no person category in its output
      personScore: 0,
    } satisfies FrameObservation);
  });

  it('v1.3 eyes: eyesClosedScore = min(eyeBlinkLeft, eyeBlinkRight), absent without blendshapes', () => {
    const bs = (l: number, r: number) => [
      { score: l, categoryName: 'eyeBlinkLeft' },
      { score: 0.9, categoryName: 'jawOpen' },
      { score: r, categoryName: 'eyeBlinkRight' },
    ];
    expect(toFrameObservation(raw({ faceBlendshapes: bs(0.8, 0.7) }), settings).eyesClosedScore).toBe(0.7);
    expect(toFrameObservation(raw({ faceBlendshapes: bs(0.9, 0.1) }), settings).eyesClosedScore).toBe(0.1); // one-eye wink
    expect(toFrameObservation(raw({ faceBlendshapes: null }), settings)).not.toHaveProperty('eyesClosedScore');
    expect(toFrameObservation(raw({}), settings)).not.toHaveProperty('eyesClosedScore');
    expect(toFrameObservation(raw({ faceBlendshapes: [{ score: 0.9, categoryName: 'eyeBlinkLeft' }] }), settings)).not.toHaveProperty('eyesClosedScore');
  });

  it('upperBodyDetected needs BOTH shoulders visible', () => {
    expect(toFrameObservation(raw({ poseLandmarks: lm(0.9, 0.3) }), settings)).toMatchObject({ upperBodyDetected: false, poseScore: 0.3 });
    expect(toFrameObservation(raw({ poseLandmarks: null }), settings)).toMatchObject({ upperBodyDetected: false, poseScore: 0 });
  });

  it('phone only when evaluated; errors surfaced', () => {
    const o = toFrameObservation(raw({ objectDetections: [{ categories: [{ score: 0.9, categoryName: 'cell phone' }] }], phoneEvaluated: false, errors: ['pose: x'] }), settings);
    expect(o).toMatchObject({ phoneEvaluated: false, phoneDetected: false, phoneScore: 0, error: 'pose: x' });
    const p = toFrameObservation(raw({ objectDetections: [{ categories: [{ score: 0.9, categoryName: 'cell phone' }] }], phoneEvaluated: true }), settings);
    expect(p).toMatchObject({ phoneDetected: true, phoneScore: 0.9 });
  });

  it('v1.2 person evidence: only on object-detector ticks, best "person" score vs personMinScore', () => {
    const dets = [
      { categories: [{ score: 0.42, categoryName: 'person' }] },
      { categories: [{ score: 0.77, categoryName: 'person' }] },
      { categories: [{ score: 0.6, categoryName: 'cell phone' }] },
    ];
    const o = toFrameObservation(raw({ objectDetections: dets, phoneEvaluated: true }), settings);
    expect(o).toMatchObject({ personDetected: true, personScore: 0.77, phoneScore: 0.6 });
    const weak = toFrameObservation(raw({ objectDetections: [dets[0]!], phoneEvaluated: true }), settings);
    expect(weak).toMatchObject({ personDetected: false, personScore: 0.42 });
    // detector did not run this tick → not reported (undefined), never "no person"
    const skipped = toFrameObservation(raw({ objectDetections: null, phoneEvaluated: false }), settings);
    expect(skipped.personDetected).toBeUndefined();
    expect(skipped.personScore).toBeUndefined();
  });
});

class FakeWorker implements WorkerLike {
  posted: { msg: ToWorker; transfer?: Transferable[] }[] = [];
  terminated = false;
  private ls = new Map<string, Set<(ev: never) => void>>();
  constructor(private readonly behaviour: 'ok' | 'loadError' | 'silent' | 'hangsAfterStart') {}
  addEventListener(type: string, l: (ev: never) => void) {
    if (!this.ls.has(type)) this.ls.set(type, new Set());
    this.ls.get(type)!.add(l);
  }
  removeEventListener(type: string, l: (ev: never) => void) {
    this.ls.get(type)?.delete(l);
  }
  listenerCount() {
    return [...this.ls.values()].reduce((n, s) => n + s.size, 0);
  }
  private reply(msg: FromWorker) {
    queueMicrotask(() => this.ls.get('message')?.forEach((l) => (l as (e: MessageEvent<FromWorker>) => void)({ data: msg } as MessageEvent<FromWorker>)));
  }
  postMessage(msg: ToWorker, transfer?: Transferable[]) {
    this.posted.push({ msg, transfer });
    if (msg.type === 'load') {
      if (this.behaviour !== 'silent') this.reply({ type: 'ready', moduleWorker: false });
      if (this.behaviour === 'ok') this.reply({ type: 'loaded' });
      if (this.behaviour === 'loadError') this.reply({ type: 'loadError', message: 'no OffscreenCanvas' });
    }
    if (msg.type === 'analyze') {
      this.reply({
        type: 'result',
        id: msg.id,
        observation: { at: msg.at, frameQuality: 'OK', faceDetected: true, faceScore: 0.9, upperBodyDetected: true, poseScore: 0.8, phoneEvaluated: msg.runPhone, phoneDetected: false, phoneScore: 0, inferenceMs: 9 },
      });
    }
  }
  terminate() {
    this.terminated = true;
  }
}

describe('defaultWorkerFactory', () => {
  it('creates a CLASSIC worker (Turbopack worker bootstrap uses importScripts → illegal in module workers)', () => {
    const ctor = vi.fn();
    vi.stubGlobal('Worker', ctor);
    try {
      defaultWorkerFactory();
      const [url, opts] = ctor.mock.calls[0]! as [URL, WorkerOptions];
      expect(String(url)).toMatch(/vision\.worker\.ts/);
      expect(opts.type).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('WorkerVisionPipeline', () => {
  it('loads, transfers a fresh ImageBitmap per frame, disposes the worker', async () => {
    const w = new FakeWorker('ok');
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const p = new WorkerVisionPipeline(settings, { createWorker: () => w, createBitmap: async () => bitmap });
    expect(p.backend).toBe('WORKER');
    await p.load();
    expect(w.posted[0]!.msg).toEqual({ type: 'load', settings });
    const obs = await p.analyze({} as HTMLVideoElement, 42, { runPhone: true });
    expect(obs).toMatchObject({ at: 42, phoneEvaluated: true });
    const sent = w.posted[1]!;
    expect(sent.msg).toMatchObject({ type: 'analyze', at: 42, runPhone: true, bitmap });
    expect(sent.transfer).toEqual([bitmap]);
    p.dispose();
    p.dispose();
    expect(w.posted.at(-1)!.msg).toEqual({ type: 'dispose' });
    expect(w.terminated).toBe(true);
    expect(w.listenerCount()).toBe(0);
    await expect(p.analyze({} as HTMLVideoElement, 43, { runPhone: false })).rejects.toThrow();
  });

  it('rejects load on worker loadError', async () => {
    await expect(new WorkerVisionPipeline(settings, { createWorker: () => new FakeWorker('loadError') }).load()).rejects.toThrow('no OffscreenCanvas');
  });

  it('fails fast (default 4 s) when the worker script never starts, before the long model-load timeout', async () => {
    vi.useFakeTimers();
    try {
      const p = new WorkerVisionPipeline(settings, { createWorker: () => new FakeWorker('silent') });
      const l = p.load();
      const assertion = expect(l).rejects.toThrow('did not start');
      await vi.advanceTimersByTimeAsync(4_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a started worker gets the longer model-load timeout', async () => {
    vi.useFakeTimers();
    try {
      const p = new WorkerVisionPipeline(settings, { createWorker: () => new FakeWorker('hangsAfterStart'), loadTimeoutMs: 30_000 });
      let settled = false;
      const l = p.load().catch((e: Error) => {
        settled = true;
        throw e;
      });
      const assertion = expect(l).rejects.toThrow('model load timed out');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(settled).toBe(false); // past the 4 s start timeout: worker is running, keep waiting
      expect(p.moduleWorker).toBe(false);
      await vi.advanceTimersByTimeAsync(20_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('worker error event rejects load immediately (e.g. bootstrap failure)', async () => {
    const w = new FakeWorker('silent');
    const p = new WorkerVisionPipeline(settings, { createWorker: () => w });
    const l = p.load();
    (w as unknown as { ls: Map<string, Set<(e: Event) => void>> }).ls.get('error')!.forEach((f) => f({ message: "Module scripts don't support importScripts()" } as ErrorEvent));
    await expect(l).rejects.toThrow('importScripts');
  });
});

describe('AutoVisionPipeline', () => {
  const mainStub = (): VisionPipeline => ({
    backend: 'MAIN_THREAD',
    load: vi.fn(async () => {}),
    analyze: vi.fn(async (_s, at) => ({ at }) as FrameObservation),
    dispose: vi.fn(),
  });

  it('uses the worker when it loads', async () => {
    const w = new FakeWorker('ok');
    const main = mainStub();
    const p = new AutoVisionPipeline(settings, { createWorker: () => w, createBitmap: async () => ({ close() {} }) as ImageBitmap, createMain: () => main });
    await p.load();
    expect(p.backend).toBe('WORKER');
    expect(main.load).not.toHaveBeenCalled();
    p.dispose();
    expect(w.terminated).toBe(true);
  });

  it('falls back to the main thread when the worker fails to initialise', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new FakeWorker('loadError');
    const main = mainStub();
    const p = new AutoVisionPipeline(settings, { createWorker: () => w, createMain: () => main });
    await p.load();
    expect(p.backend).toBe('MAIN_THREAD');
    expect(p.workerError).toContain('no OffscreenCanvas');
    expect(w.terminated).toBe(true);
    await p.analyze({} as HTMLVideoElement, 5, { runPhone: false });
    expect(main.analyze).toHaveBeenCalled();
    p.dispose();
    expect(main.dispose).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back when Worker construction throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const main = mainStub();
    const p = new AutoVisionPipeline(settings, {
      createWorker: () => {
        throw new Error('SecurityError');
      },
      createMain: () => main,
    });
    await p.load();
    expect(p.backend).toBe('MAIN_THREAD');
    p.dispose();
    warn.mockRestore();
  });
});
