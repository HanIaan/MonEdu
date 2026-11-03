import { describe, expect, it, vi } from 'vitest';
import type { FrameObservation, VisionPipeline } from '@/features/monitoring/contracts';
import { visionSettingsFromConfig } from './config';
import { assessFrameQuality } from './frameQuality';
import { toFrameObservation, type RawVisionResults } from './observation';
import { AutoVisionPipeline, WorkerVisionPipeline, type WorkerLike } from './pipelines';
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
        objectDetections: [{ categories: [{ score: 0.4, categoryName: 'cell phone' }] }, { categories: [{ score: 0.9, categoryName: 'cup' }] }],
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
      phoneScore: 0.4,
      inferenceMs: 12,
    } satisfies FrameObservation);
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
});

class FakeWorker implements WorkerLike {
  posted: { msg: ToWorker; transfer?: Transferable[] }[] = [];
  terminated = false;
  private ls = new Map<string, Set<(ev: never) => void>>();
  constructor(private readonly behaviour: 'ok' | 'loadError' | 'silent') {}
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

  it('rejects load on worker loadError and on timeout', async () => {
    await expect(new WorkerVisionPipeline(settings, { createWorker: () => new FakeWorker('loadError') }).load()).rejects.toThrow('no OffscreenCanvas');
    vi.useFakeTimers();
    try {
      const p = new WorkerVisionPipeline(settings, { createWorker: () => new FakeWorker('silent'), loadTimeoutMs: 1000 });
      const l = p.load();
      const assertion = expect(l).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
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
