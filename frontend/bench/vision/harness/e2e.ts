/**
 * Behaviour check with the REAL MonitoringController + real models (main-thread pipeline) on a
 * synthetic camera: a canvas stream that shows a still image scaled to the requested camera
 * resolution (honours getUserMedia width/height like a webcam would). Driven by ../run-e2e.mjs.
 */
import { createVisionPipeline } from '@/lib/vision';
import { createMonitoringController } from '@/features/monitoring/engine';
import type { EngineConfig, EngineTransition, MonitoringSnapshot } from '@/features/monitoring/contracts';

export interface E2ERequest {
  /** Timeline of images: [{url, fromMs}] — the camera switches to `url` at `fromMs` after start. */
  scenes: { url: string; fromMs: number }[];
  durationMs: number;
  config?: Partial<EngineConfig>;
}

export interface E2EResult {
  startedAt: number;
  transitions: (EngineTransition & { emittedAt: number })[];
  snapshots: { t: number; state: string; face: number; pose: number; phone: number; person: number | null; perf: MonitoringSnapshot['perf'] }[];
  camera: { width: number; height: number };
}

async function bitmap(url: string) {
  const r = await fetch(url);
  return createImageBitmap(await r.blob());
}

declare global {
  interface Window {
    runE2E(req: E2ERequest): Promise<E2EResult>;
  }
}

window.runE2E = async (req) => {
  const images = await Promise.all(req.scenes.map((s) => bitmap(s.url)));
  let canvas: HTMLCanvasElement | null = null;
  let drawTimer: ReturnType<typeof setInterval> | null = null;
  const t0 = performance.timeOrigin + performance.now();
  const camera = { width: 0, height: 0 };
  const getUserMedia = async (c?: MediaStreamConstraints) => {
    const v = (c?.video ?? {}) as MediaTrackConstraints;
    const w = Number((v.width as ConstrainULongRange)?.ideal ?? 640);
    const h = Number((v.height as ConstrainULongRange)?.ideal ?? 480);
    canvas = document.createElement('canvas');
    canvas.width = camera.width = w;
    canvas.height = camera.height = h;
    const ctx = canvas.getContext('2d')!;
    const draw = () => {
      const el = performance.timeOrigin + performance.now() - t0;
      let idx = 0;
      req.scenes.forEach((s, i) => {
        if (el >= s.fromMs) idx = i;
      });
      const img = images[idx]!;
      const s = Math.max(w / img.width, h / img.height); // cover, like a webcam's field of view
      ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
      // tiny per-frame noise so frames are not byte-identical
      ctx.fillStyle = `rgba(${(el / 7) % 255},0,0,0.01)`;
      ctx.fillRect(0, 0, 2, 2);
    };
    draw();
    drawTimer = setInterval(draw, 66);
    return canvas.captureStream(15);
  };
  const ctrl = createMonitoringController(req.config, {
    mediaDevices: { getUserMedia },
    createPipeline: (c) => createVisionPipeline(c, { forceMainThread: true }),
  });
  const transitions: E2EResult['transitions'] = [];
  ctrl.onTransition((t) => transitions.push({ ...t, emittedAt: performance.timeOrigin + performance.now() }));
  const snapshots: E2EResult['snapshots'] = [];
  const video = document.getElementById('v') as HTMLVideoElement;
  await ctrl.start(video);
  const startedAt = t0;
  const sampler = setInterval(() => {
    const s = ctrl.getSnapshot();
    const o = s.lastObservation;
    snapshots.push({
      t: performance.timeOrigin + performance.now() - t0,
      state: s.engineState,
      face: o?.faceScore ?? 0,
      pose: o?.poseScore ?? 0,
      phone: o?.phoneScore ?? 0,
      person: o?.personScore ?? null,
      perf: s.perf,
    });
  }, 1000);
  await new Promise((r) => setTimeout(r, req.durationMs));
  clearInterval(sampler);
  ctrl.dispose();
  if (drawTimer) clearInterval(drawTimer);
  images.forEach((b) => b.close());
  return { startedAt, transitions, snapshots, camera };
};
