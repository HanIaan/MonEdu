/** Message protocol between WorkerVisionPipeline (main) and vision.worker.ts. */
import type { FrameObservation } from '@/features/monitoring/contracts';
import type { VisionSettings } from './config';

export type ToWorker =
  | { type: 'load'; settings: VisionSettings }
  | { type: 'analyze'; id: number; bitmap: ImageBitmap; at: number; runPhone: boolean }
  | { type: 'dispose' };

export type FromWorker =
  | { type: 'loaded' }
  | { type: 'loadError'; message: string }
  | { type: 'result'; id: number; observation: FrameObservation }
  | { type: 'analyzeError'; id: number; message: string };
