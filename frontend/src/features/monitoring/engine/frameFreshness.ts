/**
 * Detects whether the analysis <video> has a NEW frame since the last analysed one.
 *
 * Browsers (notably Safari/WebKit) may stop delivering frames to a video element that is not
 * visibly rendered (e.g. the 2×2 px body-attached analysis element). readyState stays >= 2, so
 * without this check the same stale frame would be re-analysed forever → false PRESENT → focus
 * accrues. When no new frame arrives we skip inference, and the state machine's staleFrameMs rule
 * reports INFERENCE_STALLED.
 *
 * Evidence of a new frame:
 *  - **requestVideoFrameCallback is authoritative** once it is supported AND has fired at least once
 *    for this video: then a frame is new only if rVFC fired since the last analysed frame, and
 *    currentTime is ignored. For MediaStream sources currentTime is a wall clock, not a frame counter:
 *    measured in Chromium 156, a stream whose source stopped producing frames (track still live)
 *    advanced currentTime +3.0 s in 3 s while rVFC fired 0 times. rVFC was measured to keep firing for
 *    display:none / detached / 2×2 px videos in Chromium 156 and WebKit (Playwright 27.2), ≈15 fps.
 *  - **Fallback** (rVFC unsupported, or not fired yet): `video.currentTime` changed. LIMITATION: this
 *    cannot detect frozen MediaStream frames (currentTime keeps advancing); it only catches a paused /
 *    stopped element.
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
    if (this.rvfc && this.presented > 0) {
      if (this.presented === this.lastPresented) return false;
      this.lastPresented = this.presented;
      return true;
    }
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
