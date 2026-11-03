/**
 * Cheap frame-quality check: mean luminance + luminance standard deviation on a tiny
 * downscaled copy of the frame. Catches covered lenses, very dark rooms and blank/uniform frames.
 * It does NOT detect blur reliably; it is a coarse gate, not an image-quality metric.
 */

export const QUALITY_SAMPLE_WIDTH = 32;
export const QUALITY_SAMPLE_HEIGHT = 24;

export interface FrameQualityThresholds {
  /** Mean luma (0..255) below this → too dark. */
  minMeanLuma: number;
  /** Mean luma above this → blown out / blank white. */
  maxMeanLuma: number;
  /** Luma standard deviation below this → uniform frame (lens covered, blank image). */
  minLumaStdDev: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: FrameQualityThresholds = {
  minMeanLuma: 20,
  maxMeanLuma: 245,
  minLumaStdDev: 6,
};

export interface FrameQualityResult {
  quality: 'OK' | 'LOW';
  meanLuma: number;
  lumaStdDev: number;
}

/** Pure: assess RGBA pixel data (e.g. from getImageData). */
export function assessFrameQuality(
  rgba: ArrayLike<number>,
  thresholds: FrameQualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): FrameQualityResult {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return { quality: 'LOW', meanLuma: 0, lumaStdDev: 0 };
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // Rec. 601 luma
    const y = 0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0);
    sum += y;
    sumSq += y * y;
  }
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const std = Math.sqrt(variance);
  const low = mean < thresholds.minMeanLuma || mean > thresholds.maxMeanLuma || std < thresholds.minLumaStdDev;
  return { quality: low ? 'LOW' : 'OK', meanLuma: mean, lumaStdDev: std };
}

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/**
 * Reusable sampler that draws a frame into a 32×24 canvas. Works in a worker (OffscreenCanvas) and
 * on the main thread (OffscreenCanvas or <canvas>). Returns null if no 2D canvas is available, in
 * which case callers should treat quality as unknown ('OK') and rely on detector scores.
 */
export class FrameQualitySampler {
  private ctx: Ctx2D | null = null;
  private initialised = false;

  constructor(private readonly thresholds: FrameQualityThresholds = DEFAULT_QUALITY_THRESHOLDS) {}

  private getCtx(): Ctx2D | null {
    if (this.initialised) return this.ctx;
    this.initialised = true;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const c = new OffscreenCanvas(QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT);
        this.ctx = c.getContext('2d', { willReadFrequently: true });
      } else if (typeof document !== 'undefined') {
        const c = document.createElement('canvas');
        c.width = QUALITY_SAMPLE_WIDTH;
        c.height = QUALITY_SAMPLE_HEIGHT;
        this.ctx = c.getContext('2d', { willReadFrequently: true });
      }
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }

  measure(source: CanvasImageSource): FrameQualityResult | null {
    const ctx = this.getCtx();
    if (!ctx) return null;
    try {
      ctx.drawImage(source, 0, 0, QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT);
      const data = ctx.getImageData(0, 0, QUALITY_SAMPLE_WIDTH, QUALITY_SAMPLE_HEIGHT).data;
      return assessFrameQuality(data, this.thresholds);
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.ctx = null;
  }
}
