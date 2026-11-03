import type { MonitoringSnapshot } from '../contracts';

export const IDLE_SNAPSHOT: MonitoringSnapshot = {
  cameraStatus: 'idle',
  modelStatus: 'idle',
  engineState: 'UNKNOWN',
  stateSince: 0,
  lastFrameAt: null,
  lastObservation: null,
  pageVisible: true,
  inferenceBackend: null,
  onBreak: false,
  paused: false,
  perf: { framesProcessed: 0, framesSkipped: 0, avgInferenceMs: 0, jsHeapBytes: null },
  error: null,
};
