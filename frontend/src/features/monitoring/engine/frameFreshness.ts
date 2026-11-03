/**
 * Detects whether the analysis <video> has a NEW frame since the last analysed one.
 *
 * Browsers (notably Safari/WebKit) may stop delivering frames to a video element that is not
 * visibly rendered (e.g. the 2×2 px body-attached analysis element). readyState stays >= 2, so
 * without this check the same stale frame would be re-analysed forever → false PRESENT → focus
 * accrues. When no new frame arrives we skip inference, and the state machine's staleFrameMs rule
 * reports INFERENCE_STALLED.
 *
 * Evidence of a new frame (either suffices):
 *  - `video.currentTime` changed (advances continuously for a playing MediaStream), or
 *  - a `requestVideoFrameCallback` fired (where supported; may not fire for non-composited videos,
 *    which is why currentTime is also accepted).
 * If neither signal is observable (no numeric currentTime and no rVFC) every tick counts as new,
 * i.e. the previous behaviour.
 */
type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class VideoFrameTracker {
  private presented = 0;
  private lastPresented = -1;
  private lastTime: number | null = null;
  private handle: number | null = null;
  private readonly rvfc: boolean;
  private disposed = false;

  constructor(private readonly video: RvfcVideo) {
    this.rvfc = typeof video.requestVideoFrameCallback === 'function';
    if (this.rvfc) this.handle = video.requestVideoFrameCallback!(this.onFrame);
  }

  private readonly onFrame = () => {
    if (this.disposed) return;
    this.presented++;
    this.handle = this.video.requestVideoFrameCallback!(this.onFrame);
  };

  /** True when a new frame is available since the last call that returned true (and consumes it). */
  consumeNewFrame(): boolean {
    const t = this.video.currentTime;
    const timeKnown = typeof t === 'number' && Number.isFinite(t);
    if (!timeKnown && !this.rvfc) return true;
    const timeAdvanced = timeKnown && t !== this.lastTime;
    const frameCallback = this.rvfc && this.presented !== this.lastPresented;
    if (!timeAdvanced && !frameCallback) return false;
    if (timeKnown) this.lastTime = t;
    this.lastPresented = this.presented;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.handle !== null) {
      try {
        this.video.cancelVideoFrameCallback?.(this.handle);
      } catch {
        /* ignore */
      }
    }
    this.handle = null;
  }
}
