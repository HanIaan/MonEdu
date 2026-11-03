/**
 * Static asset locations + detector settings for the in-browser vision pipeline (owner: W1).
 * Everything is served same-origin: WASM from /mediapipe/wasm (copied by `npm ci` postinstall),
 * models from /models (committed, see public/models/README.md). No CDN at runtime.
 */
import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from '@/features/monitoring/contracts';

export const WASM_BASE_PATH = '/mediapipe/wasm';
export const MODEL_BASE_PATH = '/models';

export const MODEL_FILES = {
  face: 'blaze_face_short_range.tflite',
  pose: 'pose_landmarker_lite.task',
  object: 'efficientdet_lite0.tflite',
} as const;

/** COCO label used by EfficientDet-Lite0 for phones. */
export const PHONE_CATEGORY = 'cell phone';
/** COCO label for people (contract v1.2 `personScore`: rejects non-human faces such as pets). */
export const PERSON_CATEGORY = 'person';

/** Default `personMinScore` (internal; not part of EngineConfig). */
export const PERSON_MIN_SCORE = 0.5;

/** MediaPipe Pose landmark indices. */
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;

/** Serializable settings shared by the worker and main-thread pipelines. */
export interface VisionSettings {
  /** Absolute (or root-relative) URL of the WASM directory. */
  wasmBaseUrl: string;
  /** Absolute (or root-relative) URL of the models directory. */
  modelBaseUrl: string;
  /** Visibility both shoulders need for `upperBodyDetected`. */
  poseMinVisibility: number;
  /** Score needed for `phoneDetected`. */
  phoneMinScore: number;
  /** Score needed for `personDetected` (W1-internal tunable, see bench/vision/RESULTS.md §B). */
  personMinScore: number;
  /**
   * Detector-internal score floors. Deliberately below the engine thresholds so grey-zone
   * scores are reported (the engine, not the detector, decides PRESENT/ABSENT/UNCERTAIN).
   */
  faceMinDetectionConfidence: number;
  objectScoreThreshold: number;
}

export function visionSettingsFromConfig(
  config: Pick<EngineConfig, 'poseMinVisibility' | 'phoneMinScore'> = DEFAULT_ENGINE_CONFIG,
  origin?: string,
): VisionSettings {
  const base = origin ?? (typeof location !== 'undefined' ? location.origin : '');
  return {
    wasmBaseUrl: `${base}${WASM_BASE_PATH}`,
    modelBaseUrl: `${base}${MODEL_BASE_PATH}`,
    poseMinVisibility: config.poseMinVisibility,
    phoneMinScore: config.phoneMinScore,
    personMinScore: PERSON_MIN_SCORE,
    faceMinDetectionConfidence: 0.2,
    objectScoreThreshold: 0.2,
  };
}
