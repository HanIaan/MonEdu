import { beforeAll, describe, expect, it, vi } from 'vitest';
import { visionSettingsFromConfig } from './config';
import { MediaPipeRunner } from './mediapipeRunner';

function fakeTasks() {
  const calls = { face: [] as number[], pose: [] as number[], object: [] as number[] };
  const closed = { face: 0, pose: 0, object: 0, poseResult: 0 };
  const opts: Record<string, unknown> = {};
  const mk = (name: 'face' | 'pose' | 'object', result: () => unknown) => ({
    createFromOptions: vi.fn(async (_fs: unknown, o: unknown) => {
      opts[name] = o;
      return {
        detectForVideo: (_img: unknown, ts: number) => {
          calls[name].push(ts);
          return result();
        },
        close: () => closed[name]++,
      };
    }),
  });
  const shoulders = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
  const tasks = {
    FilesetResolver: { forVisionTasks: vi.fn(async () => ({ wasmLoaderPath: 'x', wasmBinaryPath: 'y' })) },
    FaceDetector: mk('face', () => ({ detections: [{ categories: [{ score: 0.8, index: 0, categoryName: '', displayName: '' }], keypoints: [] }] })),
    PoseLandmarker: mk('pose', () => ({ landmarks: [shoulders], worldLandmarks: [], close: () => closed.poseResult++ })),
    ObjectDetector: mk('object', () => ({ detections: [{ categories: [{ score: 0.7, index: 76, categoryName: 'cell phone', displayName: '' }], keypoints: [] }] })),
  };
  return { tasks, calls, closed, opts };
}

describe('MediaPipeRunner', () => {
  // jsdom has no 2D canvas; the quality sampler then reports unknown (treated as OK).
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  const settings = visionSettingsFromConfig(undefined, 'http://localhost:3000');
  const img = {} as HTMLCanvasElement;
  const EPOCH = Date.parse('2026-11-03T00:13:22Z');

  it('configures tasks (VIDEO, CPU, phone + person allowlist) and loads from same-origin paths', async () => {
    const { tasks, opts } = fakeTasks();
    await MediaPipeRunner.create(tasks as never, settings, true);
    expect(tasks.FilesetResolver.forVisionTasks).toHaveBeenCalledWith('http://localhost:3000/mediapipe/wasm', true);
    expect(opts.object).toMatchObject({
      runningMode: 'VIDEO',
      categoryAllowlist: ['cell phone', 'person'],
      maxResults: 10,
      baseOptions: { modelAssetPath: 'http://localhost:3000/models/efficientdet_lite0.tflite', delegate: 'CPU' },
    });
    expect(opts.pose).toMatchObject({ numPoses: 1, outputSegmentationMasks: false });
  });

  it('uses small, strictly increasing timestamps even for epoch-ms frame times (int32 regression)', async () => {
    const { tasks, calls } = fakeTasks();
    const r = await MediaPipeRunner.create(tasks as never, settings, true);
    r.analyze(img, EPOCH, true);
    r.analyze(img, EPOCH + 500, false);
    r.analyze(img, EPOCH + 500, true); // same capture time must still advance
    r.analyze(img, EPOCH + 400, false); // clock went backwards
    expect(calls.face).toEqual([1, 501, 502, 503]);
    expect(calls.pose).toEqual(calls.face);
    expect(calls.object).toEqual([1, 502]);
    for (const ts of calls.face) expect(ts).toBeLessThan(2 ** 31 / 1000);
  });

  it('returns coarse observation, gates the phone model, closes pose results and models', async () => {
    const { tasks, calls, closed } = fakeTasks();
    const r = await MediaPipeRunner.create(tasks as never, settings, true);
    const a = r.analyze(img, EPOCH, false);
    expect(a).toMatchObject({ frameQuality: 'OK', faceScore: 0.8, poseScore: 0.9, upperBodyDetected: true, phoneEvaluated: false, phoneScore: 0 });
    expect(calls.object).toHaveLength(0);
    const b = r.analyze(img, EPOCH + 500, true);
    expect(b).toMatchObject({ phoneEvaluated: true, phoneDetected: true, phoneScore: 0.7 });
    expect(Object.keys(b)).not.toContain('landmarks');
    expect(closed.poseResult).toBe(2);
    r.close();
    r.close();
    expect(closed).toMatchObject({ face: 1, pose: 1, object: 1 });
    expect(() => r.analyze(img, EPOCH + 1000, false)).toThrow('closed');
  });

  it('a failing model yields an error observation instead of throwing', async () => {
    const { tasks } = fakeTasks();
    const r = await MediaPipeRunner.create(tasks as never, settings, true);
    // make pose throw on next call
    const pose = await tasks.PoseLandmarker.createFromOptions.mock.results[0]!.value;
    pose.detectForVideo = () => {
      throw new Error('graph error');
    };
    const o = r.analyze(img, EPOCH, false);
    expect(o.error).toContain('pose: graph error');
    expect(o.faceScore).toBe(0.8);
  });

  it('closes already-created tasks when a later model fails to load', async () => {
    const { tasks, closed } = fakeTasks();
    tasks.ObjectDetector.createFromOptions.mockRejectedValueOnce(new Error('404'));
    await expect(MediaPipeRunner.create(tasks as never, settings, true)).rejects.toThrow('404');
    expect(closed).toMatchObject({ face: 1, pose: 1 });
  });
});
