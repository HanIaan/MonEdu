import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineTransition, FrameObservation, VisionPipeline } from '../contracts';
import { createMonitoringController, type ControllerDeps } from './index';

const T0 = Date.parse('2026-11-03T00:13:22.000Z');

class FakeTrack {
  readyState: MediaStreamTrackState = 'live';
  stop = vi.fn(() => {
    this.stopped = true;
  });
  stopped = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener = vi.fn((type: string, l: () => void) => {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  });
  removeEventListener = vi.fn((type: string, l: () => void) => {
    this.listeners.get(type)?.delete(l);
  });
  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
  fire(type: string) {
    for (const l of [...(this.listeners.get(type) ?? [])]) l();
  }
}

function fakeStream(track: FakeTrack): MediaStream {
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}

/** Live camera video: currentTime advances with (fake) wall time unless `frozen`. */
function fakeVideo() {
  const v = {
    readyState: 4,
    srcObject: null as unknown,
    muted: false,
    playsInline: false,
    paused: false,
    frozen: false,
    frozenAt: 0,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    get currentTime(): number {
      return this.frozen ? this.frozenAt : Date.now() / 1000;
    },
    freeze() {
      this.frozenAt = this.currentTime;
      this.frozen = true;
    },
  };
  return v;
}

class FakePipeline implements VisionPipeline {
  readonly backend = 'WORKER' as const;
  load = vi.fn(async () => {});
  dispose = vi.fn();
  analyzeCalls = 0;
  inFlight = 0;
  maxInFlight = 0;
  phoneRuns = 0;
  /** ms each analyze takes (fake-timer time). */
  delayMs = 30;
  scene: (at: number) => Partial<FrameObservation> = () => ({ faceDetected: true, faceScore: 0.9, upperBodyDetected: true, poseScore: 0.9 });
  analyze = vi.fn(async (_src: HTMLVideoElement | ImageBitmap, at: number, opts: { runPhone: boolean }): Promise<FrameObservation> => {
    this.analyzeCalls++;
    if (opts.runPhone) this.phoneRuns++;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setTimeout(r, this.delayMs));
    this.inFlight--;
    return {
      at,
      frameQuality: 'OK',
      faceDetected: false,
      faceScore: 0,
      upperBodyDetected: false,
      poseScore: 0,
      phoneEvaluated: opts.runPhone,
      phoneDetected: false,
      phoneScore: 0,
      inferenceMs: this.delayMs,
      ...this.scene(at),
    };
  });
}

class FakePermissionStatus {
  state = 'granted';
  private ls = new Set<() => void>();
  addEventListener = (_: 'change', l: () => void) => this.ls.add(l);
  removeEventListener = (_: 'change', l: () => void) => this.ls.delete(l);
  get count() {
    return this.ls.size;
  }
  set(state: string) {
    this.state = state;
    for (const l of [...this.ls]) l();
  }
}

class FakeDocument {
  visibilityState: DocumentVisibilityState = 'visible';
  private ls = new Set<() => void>();
  addEventListener = vi.fn((_: string, l: () => void) => this.ls.add(l));
  removeEventListener = vi.fn((_: string, l: () => void) => this.ls.delete(l));
  get count() {
    return this.ls.size;
  }
  setVisibility(v: DocumentVisibilityState) {
    this.visibilityState = v;
    for (const l of [...this.ls]) l();
  }
}

function setup(overrides: Partial<ControllerDeps> = {}) {
  const track = new FakeTrack();
  const pipeline = new FakePipeline();
  const perm = new FakePermissionStatus();
  const doc = new FakeDocument();
  const getUserMedia = vi.fn(async (constraints?: MediaStreamConstraints) => (void constraints, fakeStream(track)));
  const deps: ControllerDeps = {
    createPipeline: () => pipeline,
    mediaDevices: { getUserMedia },
    permissions: { query: vi.fn(async () => perm) },
    document: doc as unknown as Document,
    now: () => Date.now(),
    memory: () => 1234,
    ...overrides,
  };
  const ctrl = createMonitoringController(undefined, deps);
  const transitions: EngineTransition[] = [];
  ctrl.onTransition((t) => transitions.push(t));
  const video = fakeVideo();
  return { ctrl, track, pipeline, perm, doc, getUserMedia, transitions, video, videoEl: video as unknown as HTMLVideoElement };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MonitoringController', () => {
  it('start → camera with low-res constraints, models loaded, SEATED_CONFIRMED emitted', async () => {
    const { ctrl, getUserMedia, transitions, videoEl, pipeline, video } = setup();
    await ctrl.start(videoEl);
    const constraints = getUserMedia.mock.calls[0]![0] as MediaStreamConstraints;
    expect(constraints.audio).toBe(false);
    expect(constraints.video).toMatchObject({ width: { ideal: 320 }, height: { ideal: 240 } });
    expect(video.srcObject).not.toBeNull();
    expect(pipeline.load).toHaveBeenCalledOnce();
    expect(ctrl.getSnapshot()).toMatchObject({ cameraStatus: 'active', modelStatus: 'ready', inferenceBackend: 'WORKER', engineState: 'UNKNOWN' });

    await vi.advanceTimersByTimeAsync(16_000);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ state: 'FOCUS_ESTIMATED', reason: 'SEATED_CONFIRMED', detectedAt: T0 });
    const snap = ctrl.getSnapshot();
    expect(snap.engineState).toBe('FOCUS_ESTIMATED');
    expect(snap.perf.framesProcessed).toBeGreaterThanOrEqual(30);
    expect(snap.perf.avgInferenceMs).toBeCloseTo(30, 0);
    expect(snap.perf.jsHeapBytes).toBe(1234);
    // object detector at ~1 Hz, face+pose at ~2 Hz
    expect(pipeline.phoneRuns).toBeGreaterThanOrEqual(15);
    expect(pipeline.phoneRuns).toBeLessThanOrEqual(17);
    ctrl.dispose();
  });

  it('never overlaps inferences; skipped ticks are counted', async () => {
    const { ctrl, videoEl, pipeline } = setup();
    pipeline.delayMs = 1_200; // slower than the 500 ms cadence
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pipeline.maxInFlight).toBe(1);
    expect(ctrl.getSnapshot().perf.framesSkipped).toBeGreaterThan(5);
    ctrl.dispose();
  });

  it('track ended → UNKNOWN (CAMERA_STOPPED) and resources released', async () => {
    const { ctrl, videoEl, track, transitions, pipeline } = setup();
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(16_000);
    track.fire('ended');
    expect(transitions.at(-1)).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'UNKNOWN', reason: 'CAMERA_STOPPED', detectedAt: Date.now() });
    expect(ctrl.getSnapshot().cameraStatus).toBe('stopped');
    expect(track.stop).toHaveBeenCalled();
    expect(pipeline.dispose).toHaveBeenCalled();
    const calls = pipeline.analyzeCalls;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pipeline.analyzeCalls).toBe(calls); // no more inference
    ctrl.dispose();
  });

  it('permission revoked → UNKNOWN (CAMERA_PERMISSION_DENIED)', async () => {
    const { ctrl, videoEl, perm, transitions } = setup();
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(16_000);
    perm.set('denied');
    expect(transitions.at(-1)).toMatchObject({ state: 'UNKNOWN', reason: 'CAMERA_PERMISSION_DENIED' });
    expect(ctrl.getSnapshot().cameraStatus).toBe('denied');
    ctrl.dispose();
  });

  it('getUserMedia NotAllowedError → denied, start rejects', async () => {
    const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const { ctrl, videoEl } = setup({ mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(err)) } });
    await expect(ctrl.start(videoEl)).rejects.toThrow('Permission denied');
    expect(ctrl.getSnapshot()).toMatchObject({ cameraStatus: 'denied', engineState: 'UNKNOWN' });
    ctrl.dispose();
  });

  it('model load failure → MODEL_ERROR state, camera released', async () => {
    const { ctrl, videoEl, pipeline, track } = setup();
    pipeline.load.mockRejectedValueOnce(new Error('wasm 404'));
    await expect(ctrl.start(videoEl)).rejects.toThrow('wasm 404');
    expect(ctrl.getSnapshot()).toMatchObject({ modelStatus: 'error' });
    expect(track.stop).toHaveBeenCalled();
    ctrl.dispose();
  });

  it('repeated inference failures → UNKNOWN (MODEL_ERROR)', async () => {
    const { ctrl, videoEl, pipeline, transitions } = setup();
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(16_000);
    pipeline.analyze.mockRejectedValue(new Error('worker crashed'));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(transitions.at(-1)).toMatchObject({ state: 'UNKNOWN', reason: 'MODEL_ERROR' });
    expect(ctrl.getSnapshot().modelStatus).toBe('error');
    ctrl.dispose();
  });

  it('hidden tab with frozen inference → INFERENCE_STALLED on visibilitychange, detectedAt = last frame', async () => {
    const { ctrl, videoEl, doc, transitions, pipeline } = setup();
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(16_000);
    const lastFrameAt = ctrl.getSnapshot().lastFrameAt!;
    // simulate a background tab: inference never resolves (timers frozen / throttled)
    pipeline.analyze.mockImplementation(() => new Promise(() => {}));
    doc.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(10_000);
    doc.setVisibility('visible');
    const stall = transitions.find((t) => t.reason === 'INFERENCE_STALLED');
    expect(stall).toBeDefined();
    expect(stall!.detectedAt).toBeGreaterThanOrEqual(lastFrameAt);
    expect(stall!.detectedAt).toBeLessThanOrEqual(lastFrameAt + 500);
    ctrl.dispose();
  });

  it('pause → MONITORING_PAUSED, camera + pipeline + timers released; resume requires fresh 15 s', async () => {
    const { ctrl, videoEl, track, pipeline, transitions, doc, perm } = setup();
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(16_000);
    ctrl.pause();
    expect(transitions.at(-1)).toMatchObject({ state: 'UNKNOWN', reason: 'MONITORING_PAUSED' });
    expect(track.stop).toHaveBeenCalled();
    expect(pipeline.dispose).toHaveBeenCalled();
    expect(track.listenerCount('ended')).toBe(0);
    expect(doc.count).toBe(0);
    expect(perm.count).toBe(0);
    expect(ctrl.getSnapshot()).toMatchObject({ paused: true, cameraStatus: 'stopped' });

    await vi.advanceTimersByTimeAsync(60_000);
    await ctrl.start(videoEl);
    const resumedAt = Date.now();
    await vi.advanceTimersByTimeAsync(14_000);
    expect(transitions.at(-1)!.reason).toBe('MONITORING_PAUSED');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(transitions.at(-1)).toMatchObject({ reason: 'SEATED_CONFIRMED' });
    expect(transitions.at(-1)!.detectedAt).toBeGreaterThanOrEqual(resumedAt);
    ctrl.dispose();
  });

  it('break: BREAK_STARTED, no inference during break, BREAK_ENDED then fresh seating', async () => {
    const { ctrl, videoEl, transitions, pipeline } = setup();
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(16_000);
    ctrl.startBreak();
    expect(transitions.at(-1)).toMatchObject({ state: 'BREAK', reason: 'BREAK_STARTED' });
    expect(ctrl.getSnapshot().onBreak).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const calls = pipeline.analyzeCalls;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pipeline.analyzeCalls).toBe(calls);
    ctrl.endBreak();
    expect(transitions.at(-1)).toMatchObject({ state: 'UNKNOWN', reason: 'BREAK_ENDED' });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(transitions.at(-1)).toMatchObject({ state: 'FOCUS_ESTIMATED', reason: 'SEATED_CONFIRMED' });
    ctrl.dispose();
  });

  it('subscribe notifications are throttled to ~4/s and getSnapshot is referentially stable', async () => {
    const { ctrl, videoEl } = setup();
    const listener = vi.fn();
    const unsub = ctrl.subscribe(listener);
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listener.mock.calls.length).toBeGreaterThan(5);
    expect(listener.mock.calls.length).toBeLessThanOrEqual(41);
    expect(ctrl.getSnapshot()).toBe(ctrl.getSnapshot());
    unsub();
    ctrl.dispose();
  });

  it('dispose releases tracks, timers, worker/models and listeners; idempotent', async () => {
    const { ctrl, videoEl, track, pipeline, doc, perm, video } = setup();
    const listener = vi.fn();
    ctrl.subscribe(listener);
    await ctrl.start(videoEl);
    await vi.advanceTimersByTimeAsync(3_000);
    ctrl.dispose();
    ctrl.dispose();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(track.listenerCount('ended')).toBe(0);
    expect(pipeline.dispose).toHaveBeenCalledTimes(1);
    expect(doc.count).toBe(0);
    expect(perm.count).toBe(0);
    expect(video.srcObject).toBeNull();
    // only the pending fake analyze() delay (if any) may remain; flush it and verify nothing reschedules
    await vi.advanceTimersByTimeAsync(1_000);
    expect(vi.getTimerCount()).toBe(0);
    const n = listener.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listener.mock.calls.length).toBe(n);
    await expect(ctrl.start(videoEl)).rejects.toThrow('disposed');
  });

  it('pause during start (before getUserMedia resolves) stops the late stream', async () => {
    const track = new FakeTrack();
    let resolve!: (s: MediaStream) => void;
    const { ctrl, videoEl } = setup({
      mediaDevices: { getUserMedia: vi.fn(() => new Promise<MediaStream>((r) => (resolve = r))) },
    });
    const p = ctrl.start(videoEl);
    ctrl.pause();
    resolve(fakeStream(track));
    await expect(p).rejects.toThrow();
    expect(track.stop).toHaveBeenCalled();
    ctrl.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('frame freshness (hidden 2x2 analysis video may stop delivering frames)', () => {
    it('frozen currentTime → no new observations → UNKNOWN (INFERENCE_STALLED) after staleFrameMs; resumed frames re-confirm 15 s', async () => {
      const { ctrl, videoEl, video, pipeline, transitions } = setup();
      await ctrl.start(videoEl);
      await vi.advanceTimersByTimeAsync(16_000);
      expect(transitions.at(-1)).toMatchObject({ reason: 'SEATED_CONFIRMED' });
      video.freeze(); // readyState stays 4, element not paused: frames simply stop
      await vi.advanceTimersByTimeAsync(100); // let an inference already in flight finish
      const lastFrameAt = ctrl.getSnapshot().lastFrameAt!;
      const calls = pipeline.analyzeCalls;
      await vi.advanceTimersByTimeAsync(4_000);
      expect(pipeline.analyzeCalls).toBe(calls); // stale frame is never re-analysed
      expect(ctrl.getSnapshot().engineState).toBe('FOCUS_ESTIMATED'); // not yet stale
      await vi.advanceTimersByTimeAsync(2_000);
      const stall = transitions.at(-1)!;
      expect(stall).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'UNKNOWN', reason: 'INFERENCE_STALLED', detectedAt: lastFrameAt });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(transitions.at(-1)).toBe(stall); // no false PRESENT while frozen
      expect(pipeline.analyzeCalls).toBe(calls);

      video.frozen = false; // frames flow again
      const resumedAt = Date.now();
      await vi.advanceTimersByTimeAsync(14_000);
      expect(transitions.at(-1)).toBe(stall);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(transitions.at(-1)).toMatchObject({ state: 'FOCUS_ESTIMATED', reason: 'SEATED_CONFIRMED' });
      expect(transitions.at(-1)!.detectedAt).toBeGreaterThanOrEqual(resumedAt);
      ctrl.dispose();
    });

    it('unexpectedly paused video with a live track → play() attempted once per tick', async () => {
      const { ctrl, videoEl, video, track, transitions } = setup();
      await ctrl.start(videoEl);
      await vi.advanceTimersByTimeAsync(16_000);
      const before = video.play.mock.calls.length;
      video.paused = true;
      video.freeze();
      await vi.advanceTimersByTimeAsync(2_000); // 4 ticks
      const during = video.play.mock.calls.length - before;
      expect(during).toBeGreaterThanOrEqual(3);
      expect(during).toBeLessThanOrEqual(5);
      // a rejecting play() never throws out of the scheduler
      video.play.mockImplementation(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
      await vi.advanceTimersByTimeAsync(4_000);
      expect(transitions.at(-1)).toMatchObject({ reason: 'INFERENCE_STALLED' });
      // track no longer live → no play() attempts
      track.readyState = 'ended';
      const n = video.play.mock.calls.length;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(video.play.mock.calls.length).toBe(n);
      ctrl.dispose();
    });

    it('play() is not called while the video is playing normally', async () => {
      const { ctrl, videoEl, video } = setup();
      await ctrl.start(videoEl);
      const afterStart = video.play.mock.calls.length; // the initial play() in start()
      await vi.advanceTimersByTimeAsync(10_000);
      expect(video.play.mock.calls.length).toBe(afterStart);
      ctrl.dispose();
    });

    it('requestVideoFrameCallback counts as a new frame even if currentTime is not advancing; callback cancelled on dispose', async () => {
      const { ctrl, videoEl, video, pipeline } = setup();
      let cb: (() => void) | null = null;
      const cancel = vi.fn();
      Object.assign(video, {
        requestVideoFrameCallback: vi.fn((f: () => void) => {
          cb = f;
          return 7;
        }),
        cancelVideoFrameCallback: cancel,
      });
      video.freeze();
      await ctrl.start(videoEl);
      await vi.advanceTimersByTimeAsync(600); // first tick consumes the initial frame
      const n = pipeline.analyzeCalls;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(pipeline.analyzeCalls).toBe(n); // nothing presented
      cb!(); // one frame presented
      await vi.advanceTimersByTimeAsync(600);
      expect(pipeline.analyzeCalls).toBe(n + 1);
      ctrl.dispose();
      expect(cancel).toHaveBeenCalledWith(7);
    });

    it('frozen MediaStream source (currentTime still advancing, rVFC silent after firing) → INFERENCE_STALLED', async () => {
      const { ctrl, videoEl, video, transitions, pipeline } = setup();
      let cb: (() => void) | null = null;
      let producing = true;
      Object.assign(video, {
        requestVideoFrameCallback: (f: () => void) => {
          cb = f;
          return 1;
        },
        cancelVideoFrameCallback: () => {},
      });
      // camera presents a frame every 100 ms while producing
      const present = setInterval(() => producing && cb?.(), 100);
      await ctrl.start(videoEl);
      await vi.advanceTimersByTimeAsync(16_000);
      expect(transitions.at(-1)).toMatchObject({ reason: 'SEATED_CONFIRMED' });
      producing = false; // source stops; video.currentTime (wall clock) keeps advancing
      await vi.advanceTimersByTimeAsync(600); // the last real frame (presented before the freeze) may still be analysed once
      const calls = pipeline.analyzeCalls;
      await vi.advanceTimersByTimeAsync(6_000);
      expect(pipeline.analyzeCalls).toBe(calls);
      expect(transitions.at(-1)).toMatchObject({ state: 'UNKNOWN', reason: 'INFERENCE_STALLED' });
      clearInterval(present);
      ctrl.dispose();
    });
  });
});
