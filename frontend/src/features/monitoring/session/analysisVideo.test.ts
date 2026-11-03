import { ANALYSIS_VIDEO_ID, createAnalysisVideo, removeAnalysisVideo, streamOf } from './analysisVideo';

describe('analysis video host', () => {
  afterEach(() => document.getElementById(ANALYSIS_VIDEO_ID)?.remove());

  it('is attached to <body> (not a React child), rendered, and never display:none', () => {
    const v = createAnalysisVideo();
    expect(v.isConnected).toBe(true);
    expect(v.parentElement).toBe(document.body);
    expect(v.style.display).not.toBe('none');
    expect(v.style.visibility).not.toBe('hidden');
    expect(v.style.width).toBe('2px');
    expect(Number(v.style.opacity)).toBeGreaterThan(0);
    expect(v.muted).toBe(true);
    expect(v.playsInline).toBe(true);
    expect(v.getAttribute('aria-hidden')).toBe('true');
  });

  it('is a singleton and survives unrelated DOM churn (e.g. a preview unmount)', () => {
    const a = createAnalysisVideo();
    const preview = document.createElement('div');
    document.body.appendChild(preview);
    preview.remove();
    expect(createAnalysisVideo()).toBe(a);
    expect(a.isConnected).toBe(true);
  });

  it('removal detaches and clears the stream', () => {
    const v = createAnalysisVideo();
    removeAnalysisVideo(v);
    expect(v.isConnected).toBe(false);
    expect(v.srcObject).toBeNull();
    expect(streamOf(v)).toBeNull();
    expect(streamOf(null)).toBeNull();
  });
});
