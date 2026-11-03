/**
 * Pure reduction of raw MediaPipe results to the coarse `FrameObservation` contract.
 * Only scores/booleans survive; landmarks, boxes and keypoints are dropped here and never leave
 * the function.
 */
import type { FrameObservation } from '@/features/monitoring/contracts';
import { LEFT_SHOULDER, PHONE_CATEGORY, RIGHT_SHOULDER } from './config';

interface CategoryLike {
  score: number;
  categoryName?: string;
}
interface DetectionLike {
  categories: CategoryLike[];
}
interface LandmarkLike {
  visibility?: number;
}

export interface RawVisionResults {
  at: number;
  frameQuality: 'OK' | 'LOW';
  /** null when the face model did not run / failed. */
  faceDetections: DetectionLike[] | null;
  /** First pose's landmarks, [] when no pose, null when not run / failed. */
  poseLandmarks: LandmarkLike[] | null;
  /** null when the object detector did not run this tick. */
  objectDetections: DetectionLike[] | null;
  phoneEvaluated: boolean;
  errors: string[];
  inferenceMs: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function bestFaceScore(detections: DetectionLike[] | null): number {
  if (!detections) return 0;
  let best = 0;
  for (const d of detections) for (const c of d.categories) best = Math.max(best, c.score);
  return clamp01(best);
}

/** Min visibility of both shoulders (0 if no pose). */
export function shoulderScore(landmarks: LandmarkLike[] | null): number {
  if (!landmarks || landmarks.length <= RIGHT_SHOULDER) return 0;
  const l = landmarks[LEFT_SHOULDER]?.visibility ?? 0;
  const r = landmarks[RIGHT_SHOULDER]?.visibility ?? 0;
  return clamp01(Math.min(l, r));
}

export function bestPhoneScore(detections: DetectionLike[] | null): number {
  if (!detections) return 0;
  let best = 0;
  for (const d of detections)
    for (const c of d.categories) if (c.categoryName === PHONE_CATEGORY) best = Math.max(best, c.score);
  return clamp01(best);
}

export function toFrameObservation(
  raw: RawVisionResults,
  thresholds: { poseMinVisibility: number; phoneMinScore: number },
): FrameObservation {
  const faceScore = bestFaceScore(raw.faceDetections);
  const poseScore = shoulderScore(raw.poseLandmarks);
  const phoneScore = raw.phoneEvaluated ? bestPhoneScore(raw.objectDetections) : 0;
  const obs: FrameObservation = {
    at: raw.at,
    frameQuality: raw.frameQuality,
    faceDetected: faceScore > 0,
    faceScore,
    upperBodyDetected: poseScore >= thresholds.poseMinVisibility,
    poseScore,
    phoneEvaluated: raw.phoneEvaluated,
    phoneDetected: raw.phoneEvaluated && phoneScore >= thresholds.phoneMinScore,
    phoneScore,
    inferenceMs: Math.max(0, raw.inferenceMs),
  };
  if (raw.errors.length > 0) obs.error = raw.errors.join('; ').slice(0, 300);
  return obs;
}
