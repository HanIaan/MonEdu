/**
 * AnalysisVideoHost (owner: C0).
 *
 * The <video> element that feeds MediaPipe is owned by the session layer, NOT by any UI component,
 * so opening/closing/unmounting a camera preview can never stop inference (contract v1.1).
 *
 * Why not `display:none` / a detached element: browsers (notably WebKit/Safari) may stop decoding or
 * delivering frames to video elements that are not rendered. The element therefore stays attached to
 * <body>, inside the viewport, rendered at 2×2 px with near-zero opacity and no pointer events.
 * Whether frames keep flowing is VERIFIED, not assumed: the engine treats a non-advancing video clock
 * as a stall → UNKNOWN (state-machine.md §3), and tests/e2e measures it per browser engine.
 */
export const ANALYSIS_VIDEO_ID = 'sm-analysis-video';

export function createAnalysisVideo(doc: Document = document): HTMLVideoElement {
  const existing = doc.getElementById(ANALYSIS_VIDEO_ID);
  if (existing instanceof HTMLVideoElement) return existing;
  const v = doc.createElement('video');
  v.id = ANALYSIS_VIDEO_ID;
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  v.setAttribute('aria-hidden', 'true');
  v.setAttribute('tabindex', '-1');
  v.dataset.testid = 'analysis-video';
  Object.assign(v.style, {
    position: 'fixed',
    right: '0px',
    bottom: '0px',
    width: '2px',
    height: '2px',
    opacity: '0.01',
    pointerEvents: 'none',
    zIndex: '-1',
  } satisfies Partial<CSSStyleDeclaration>);
  doc.body.appendChild(v);
  return v;
}

export function removeAnalysisVideo(v: HTMLVideoElement | null): void {
  if (!v) return;
  try {
    v.pause();
  } catch {
    /* ignore */
  }
  v.srcObject = null;
  v.remove();
}

/** The live stream currently attached to the analysis video (null when camera is off/ended). */
export function streamOf(v: HTMLVideoElement | null): MediaStream | null {
  const s = v?.srcObject;
  if (!s || typeof MediaStream === 'undefined' || !(s instanceof MediaStream)) return null;
  return s.getVideoTracks().some((t) => t.readyState === 'live') ? s : null;
}
