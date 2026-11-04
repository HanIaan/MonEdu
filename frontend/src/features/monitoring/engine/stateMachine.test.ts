import { describe, expect, it } from 'vitest';
import type { EngineTransition, FrameObservation, StateMachine } from '../contracts';
import { DEFAULT_ENGINE_CONFIG, createStateMachine } from './index';
import { classifyFrame } from './stateMachine';

// 2026-11-03 09:13:22 KST = 00:13:22Z
const T0 = Date.parse('2026-11-03T00:13:22.000Z');
const S = 1000;

type Kind = 'present' | 'faceOnly' | 'bodyOnly' | 'absent' | 'grey' | 'low' | 'error' | 'headDown';

function obs(at: number, kind: Kind, phone?: boolean | number): FrameObservation {
  const base: FrameObservation = {
    at,
    frameQuality: 'OK',
    faceDetected: false,
    faceScore: 0,
    upperBodyDetected: false,
    poseScore: 0,
    phoneEvaluated: phone !== undefined,
    phoneDetected: false,
    phoneScore: 0,
    inferenceMs: 20,
  };
  switch (kind) {
    // v1.2: frames of a real student carry COCO person evidence from the object detector
    case 'present':
      Object.assign(base, { faceDetected: true, faceScore: 0.9, upperBodyDetected: true, poseScore: 0.9, personDetected: true, personScore: 0.9 });
      break;
    case 'faceOnly': // a face with no person detection (e.g. a pet, a poster)
      Object.assign(base, { faceDetected: true, faceScore: 0.85 });
      break;
    case 'bodyOnly':
      Object.assign(base, { upperBodyDetected: true, poseScore: 0.8, personDetected: true, personScore: 0.8 });
      break;
    case 'headDown': // face barely detected (looking down at notebook), shoulders visible
      Object.assign(base, { faceDetected: true, faceScore: 0.25, upperBodyDetected: true, poseScore: 0.7, personDetected: true, personScore: 0.85 });
      break;
    case 'grey':
      Object.assign(base, { faceDetected: true, faceScore: 0.45, poseScore: 0.2 });
      break;
    case 'low':
      base.frameQuality = 'LOW';
      break;
    case 'error':
      base.error = 'face: boom';
      break;
    case 'absent':
      break;
  }
  if (phone !== undefined) {
    const score = typeof phone === 'number' ? phone : phone ? 0.8 : 0.05;
    base.phoneScore = score;
    base.phoneDetected = score >= 0.5;
  }
  return base;
}

/** Feed frames every `stepMs` over [from, to) and collect transitions. */
function run(
  sm: StateMachine,
  from: number,
  to: number,
  kind: Kind | ((t: number, i: number) => FrameObservation),
  stepMs = 500,
): EngineTransition[] {
  const out: EngineTransition[] = [];
  let i = 0;
  for (let t = from; t < to; t += stepMs, i++) {
    const o = typeof kind === 'function' ? kind(t, i) : obs(t, kind);
    const tr = sm.observe(o);
    if (tr) out.push(tr);
  }
  return out;
}

/** Phone channel only evaluated every second frame (1 Hz vs 2 Hz), like the real scheduler. */
const withPhone = (phoneAt: (t: number) => boolean) => (t: number, i: number) =>
  i % 2 === 0 ? obs(t, 'present', phoneAt(t)) : obs(t, 'present');

function seated(start = T0): { sm: StateMachine; t: number } {
  const sm = createStateMachine(undefined, { state: 'UNKNOWN', since: start - 60 * S });
  const tr = run(sm, start, start + 16 * S, 'present');
  expect(tr).toHaveLength(1);
  return { sm, t: start + 16 * S };
}

describe('classifyFrame', () => {
  const cfg = DEFAULT_ENGINE_CONFIG;
  it('person AND (face OR shoulders) = PRESENT; head pose is not an input', () => {
    expect(classifyFrame(obs(0, 'present'), cfg)).toBe('PRESENT');
    expect(classifyFrame(obs(0, 'bodyOnly'), cfg)).toBe('PRESENT');
    expect(classifyFrame(obs(0, 'headDown'), cfg)).toBe('PRESENT');
  });
  it('v1.2: a face alone (no person detection) is never PRESENT', () => {
    expect(classifyFrame(obs(0, 'faceOnly'), cfg)).toBe('UNCERTAIN');
  });
  it('absent / grey / low quality / error', () => {
    expect(classifyFrame(obs(0, 'absent'), cfg)).toBe('ABSENT');
    expect(classifyFrame(obs(0, 'grey'), cfg)).toBe('UNCERTAIN');
    expect(classifyFrame(obs(0, 'low'), cfg)).toBe('UNCERTAIN');
    expect(classifyFrame(obs(0, 'error'), cfg)).toBe('UNCERTAIN');
    // a dark frame with "no detections" must not count as ABSENT
    expect(classifyFrame({ ...obs(0, 'absent'), frameQuality: 'LOW' }, cfg)).toBe('UNCERTAIN');
  });
});

describe('seating', () => {
  it('starts UNKNOWN and confirms seating after 3 s (v1.3) with detectedAt = onset (09:13:22 KST)', () => {
    const sm = createStateMachine();
    expect(sm.state).toBe('UNKNOWN');
    const before = run(sm, T0, T0 + 2_500, 'present');
    expect(before).toEqual([]);
    const tr = sm.observe(obs(T0 + 3 * S, 'present'));
    expect(tr).toMatchObject({ from: 'UNKNOWN', state: 'FOCUS_ESTIMATED', reason: 'SEATED_CONFIRMED', detectedAt: T0 });
    expect(new Date(tr!.detectedAt).toISOString()).toBe('2026-11-03T00:13:22.000Z');
    expect(tr!.confidence).toBeGreaterThan(0.8);
    expect(tr!.signals).toMatchObject({ faceDetected: true, upperBodyDetected: true, cameraActive: true, pageVisible: true });
    expect(sm.state).toBe('FOCUS_ESTIMATED');
    expect(sm.stateSince).toBe(T0);
  });

  it('a single contrary frame does not reset the seating run', () => {
    const sm = createStateMachine();
    const tr = run(sm, T0, T0 + 16 * S, (t, i) => obs(t, i === 3 ? 'absent' : 'present'));
    expect(tr).toHaveLength(1);
    expect(tr[0]!.detectedAt).toBe(T0);
  });

  it('emits no transition when target == current', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 60 * S, 'present')).toEqual([]);
  });
});

describe('presence', () => {
  it('face not visible but upper body visible for 60 s → stays FOCUS_ESTIMATED', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 60 * S, 'bodyOnly')).toEqual([]);
    expect(sm.state).toBe('FOCUS_ESTIMATED');
  });

  it('absent 29 s → no change; absent 30 s → AWAY (PRESENCE_LOST, detectedAt = onset)', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 29 * S + 1, 'absent')).toEqual([]);
    expect(sm.state).toBe('FOCUS_ESTIMATED');
    const tr = sm.observe(obs(t + 30 * S, 'absent'));
    expect(tr).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'AWAY', reason: 'PRESENCE_LOST', detectedAt: t });
  });

  it('AWAY → FOCUS_ESTIMATED needs a fresh 3 s present run', () => {
    const { sm, t } = seated();
    run(sm, t, t + 31 * S, 'absent');
    expect(sm.state).toBe('AWAY');
    const back = t + 31 * S;
    expect(run(sm, back, back + 2_500, 'present')).toEqual([]);
    const tr = run(sm, back + 2_500, back + 16 * S, 'present');
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ from: 'AWAY', state: 'FOCUS_ESTIMATED', reason: 'SEATED_CONFIRMED', detectedAt: back });
  });

  it('UNKNOWN never goes directly to AWAY (not in the transition table)', () => {
    const sm = createStateMachine();
    expect(run(sm, T0, T0 + 120 * S, 'absent')).toEqual([]);
    expect(sm.state).toBe('UNKNOWN');
  });
});

describe('phone suspicion', () => {
  it('phone continuously 20 s → DISTRACTION_SUSPECTED with detectedAt = onset', () => {
    const { sm, t } = seated();
    const trs = run(sm, t, t + 21 * S, withPhone(() => true));
    expect(trs).toHaveLength(1);
    expect(trs[0]).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'DISTRACTION_SUSPECTED', reason: 'PHONE_SUSPECTED', detectedAt: t });
    expect(trs[0]!.signals.phoneDetected).toBe(true);
    // fired at exactly onset + 20 s, not earlier
    const sm2 = seated().sm;
    expect(run(sm2, t, t + 20 * S, withPhone(() => true))).toEqual([]);
  });

  it('intermittent false positives (1 frame in 5) → no transition', () => {
    const { sm, t } = seated();
    let k = 0;
    const tr = run(sm, t, t + 120 * S, (at, i) => (i % 2 === 0 ? obs(at, 'present', k++ % 5 === 0) : obs(at, 'present')));
    expect(tr).toEqual([]);
    expect(sm.state).toBe('FOCUS_ESTIMATED');
  });

  it('v1.3: the detector misses the phone in every other tick → still DISTRACTION after 20 s (detectedAt = first detection)', () => {
    const { sm, t } = seated();
    // detector ticks every 1 s; phone seen at even seconds only
    const trs = run(sm, t, t + 22 * S, withPhone((at) => Math.round((at - t) / S) % 2 === 0));
    expect(trs).toHaveLength(1);
    expect(trs[0]).toMatchObject({ state: 'DISTRACTION_SUSPECTED', reason: 'PHONE_SUSPECTED', detectedAt: t });
    expect(trs[0]!.confidence).toBeCloseTo(0.8, 2);
  });

  it('v1.3: 2 s phone bursts with 1 s gaps (seen in 2 of 3 ticks) → DISTRACTION; the old continuous rule missed this', () => {
    const { sm, t } = seated();
    const trs = run(sm, t, t + 30 * S, withPhone((at) => (at - t) % (3 * S) < 2 * S));
    expect(trs.map((x) => x.reason)).toEqual(['PHONE_SUSPECTED']);
  });

  it('v1.3: phone in only 1 of 3 ticks for 2 min → no transition (below the 50 % ratio)', () => {
    const { sm, t } = seated();
    const tr = run(sm, t, t + 120 * S, withPhone((at) => Math.round((at - t) / S) % 3 === 0));
    expect(tr).toEqual([]);
  });

  it('v1.3: a phone gap longer than 6 s ends the episode; the 20 s count restarts', () => {
    const { sm, t } = seated();
    // 15 s phone, 7 s none, then phone again
    expect(run(sm, t, t + 22 * S, withPhone((at) => at - t < 15 * S))).toEqual([]);
    const again = t + 22 * S;
    expect(run(sm, again, again + 20 * S, withPhone(() => true))).toEqual([]);
    expect(run(sm, again + 20 * S, again + 21 * S, withPhone(() => true))[0]).toMatchObject({ reason: 'PHONE_SUSPECTED', detectedAt: again });
  });

  it('v1.3: low-power cadence (detector every 4 s) keeps the episode alive between ticks', () => {
    const { sm, t } = seated();
    const lowPower = (at: number, i: number) => (i % 8 === 0 ? obs(at, 'present', true) : obs(at, 'present'));
    const trs = run(sm, t, t + 24 * S, lowPower);
    expect(trs).toMatchObject([{ reason: 'PHONE_SUSPECTED', detectedAt: t }]);
  });

  it('phone gone 15 s → FOCUS_RESUMED (detectedAt = first no-phone frame)', () => {
    const { sm, t } = seated();
    run(sm, t, t + 21 * S, withPhone(() => true));
    expect(sm.state).toBe('DISTRACTION_SUSPECTED');
    const gone = t + 21 * S;
    expect(run(sm, gone, gone + 14 * S, withPhone(() => false))).toEqual([]);
    const tr = run(sm, gone + 14 * S, gone + 16 * S, withPhone(() => false));
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ from: 'DISTRACTION_SUSPECTED', state: 'FOCUS_ESTIMATED', reason: 'FOCUS_RESUMED', detectedAt: gone });
  });

  it('phone is only evaluated on PRESENT frames', () => {
    const { sm, t } = seated();
    // phone-like score but nobody there → AWAY, never DISTRACTION
    const tr = run(sm, t, t + 40 * S, (at) => obs(at, 'absent', true));
    expect(tr.map((x) => x.state)).toEqual(['AWAY']);
  });

  it('phone frames before seating cannot back-date DISTRACTION before FOCUS began', () => {
    const sm = createStateMachine();
    const trs = run(sm, T0, T0 + 40 * S, withPhone(() => true));
    expect(trs.map((x) => x.state)).toEqual(['FOCUS_ESTIMATED', 'DISTRACTION_SUSPECTED']);
    expect(trs[1]!.detectedAt).toBeGreaterThanOrEqual(trs[0]!.detectedAt);
  });
});

/** Present frame with a Face Landmarker eye-closure score (undefined = landmarker did not run / no face). */
const eyes = (at: number, closed: number | undefined, kind: Kind = 'present'): FrameObservation =>
  closed === undefined ? obs(at, kind) : { ...obs(at, kind), eyesClosedScore: closed };

describe('v1.3 drowsiness (eyes closed)', () => {
  it('eyes closed 15 s while present → DISTRACTION_SUSPECTED (DROWSINESS_SUSPECTED, detectedAt = onset)', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 14_500, (at) => eyes(at, 0.8))).toEqual([]);
    const tr = sm.observe(eyes(t + 15 * S, 0.8));
    expect(tr).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'DISTRACTION_SUSPECTED', reason: 'DROWSINESS_SUSPECTED', detectedAt: t });
    expect(tr!.confidence).toBeCloseTo(0.8, 2);
  });

  it('blinks (closed for ≤ 1 s every 3 s) for 10 min → stays FOCUS_ESTIMATED', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 600 * S, (at) => eyes(at, (at - t) % (3 * S) < 1 * S ? 0.9 : 0.1))).toEqual([]);
  });

  it('half-closed / looking-down scores below eyesClosedMinScore (0.6) never count', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 120 * S, (at) => eyes(at, 0.55))).toEqual([]);
  });

  it('eyes open again → FOCUS_RESUMED after focusResumeMs, detectedAt = first open frame', () => {
    const { sm, t } = seated();
    run(sm, t, t + 16 * S, (at) => eyes(at, 0.8));
    expect(sm.state).toBe('DISTRACTION_SUSPECTED');
    const open = t + 16 * S;
    expect(run(sm, open, open + 14_500, (at) => eyes(at, 0.05))).toEqual([]);
    expect(sm.observe(eyes(open + 15 * S, 0.05))).toMatchObject({ state: 'FOCUS_ESTIMATED', reason: 'FOCUS_RESUMED', detectedAt: open });
  });

  it('drowsy, then the face can no longer be measured → resume counts focusResumeMs from the last closed-eye sample', () => {
    const { sm, t } = seated();
    run(sm, t, t + 16 * S, (at) => eyes(at, 0.8));
    expect(sm.state).toBe('DISTRACTION_SUSPECTED');
    const lastClosed = t + 15_500;
    const lost = t + 16 * S;
    expect(run(sm, lost, lastClosed + 14_500, (at) => eyes(at, undefined))).toEqual([]);
    expect(sm.observe(eyes(lastClosed + 15 * S, undefined))).toMatchObject({ reason: 'FOCUS_RESUMED', detectedAt: lastClosed });
  });

  it('eyes not measured (face turned / head down over a notebook) never cause drowsiness', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 120 * S, (at) => eyes(at, undefined, 'headDown'))).toEqual([]);
  });

  it('closed-eye evidence that goes stale (face lost for > 5 s) restarts the count', () => {
    const { sm, t } = seated();
    // 10 s closed, 6 s without a landmarker face, 10 s closed again: never 15 s of fresh evidence
    const pattern = (at: number) => {
      const d = (at - t) % (26 * S);
      return eyes(at, d < 10 * S || d >= 16 * S ? 0.8 : undefined);
    };
    expect(run(sm, t, t + 25 * S, pattern)).toEqual([]);
  });

  it('closed eyes without person evidence are not a cue (not PRESENT)', () => {
    const { sm, t } = seated();
    const trs = run(sm, t, t + 40 * S, (at) => eyes(at, 0.9, 'faceOnly'));
    expect(trs.map((x) => x.reason)).not.toContain('DROWSINESS_SUSPECTED');
  });

  it('phone then eyes closed: resume needs both cues gone for focusResumeMs', () => {
    const { sm, t } = seated();
    run(sm, t, t + 21 * S, withPhone(() => true));
    expect(sm.state).toBe('DISTRACTION_SUSPECTED');
    const p = t + 21 * S;
    // phone gone, eyes closed for 20 s → still distracted
    expect(run(sm, p, p + 20 * S, (at, i) => (i % 2 === 0 ? { ...obs(at, 'present', false), eyesClosedScore: 0.9 } : eyes(at, 0.9)))).toEqual([]);
    const open = p + 20 * S;
    const trs = run(sm, open, open + 16 * S, (at, i) => (i % 2 === 0 ? { ...obs(at, 'present', false), eyesClosedScore: 0.1 } : eyes(at, 0.1)));
    expect(trs).toMatchObject([{ state: 'FOCUS_ESTIMATED', reason: 'FOCUS_RESUMED', detectedAt: open }]);
  });

  it('eyes closed during a break or before seating do not trigger drowsiness', () => {
    const sm = createStateMachine();
    const trs = run(sm, T0, T0 + 10 * S, (at) => eyes(at, 0.9));
    expect(trs.map((x) => x.reason)).toEqual(['SEATED_CONFIRMED']);
  });
});

describe('head pose is never a distraction signal', () => {
  it('head-down / low face score with shoulders visible for 10 min → stays FOCUS_ESTIMATED', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 600 * S, (at, i) => (i % 2 === 0 ? obs(at, 'headDown', false) : obs(at, 'headDown')))).toEqual([]);
    expect(sm.state).toBe('FOCUS_ESTIMATED');
  });
});

describe('uncertainty', () => {
  it('LOW frame quality for 10 s → UNKNOWN (LOW_CONFIDENCE, onset)', () => {
    const { sm, t } = seated();
    expect(run(sm, t, t + 9_500, 'low')).toEqual([]);
    const tr = sm.observe(obs(t + 10 * S, 'low'));
    expect(tr).toMatchObject({ state: 'UNKNOWN', reason: 'LOW_CONFIDENCE', detectedAt: t });
  });

  it('model errors for 10 s → UNKNOWN (LOW_CONFIDENCE)', () => {
    const { sm, t } = seated();
    const tr = run(sm, t, t + 11 * S, 'error');
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ state: 'UNKNOWN', reason: 'LOW_CONFIDENCE', detectedAt: t });
  });

  it('grey-zone frames for 10 s from AWAY → UNKNOWN', () => {
    const { sm, t } = seated();
    run(sm, t, t + 31 * S, 'absent');
    expect(sm.state).toBe('AWAY');
    const tr = run(sm, t + 31 * S, t + 45 * S, 'grey');
    expect(tr.map((x) => x.reason)).toEqual(['LOW_CONFIDENCE']);
  });
});

describe('camera / model loss', () => {
  it('camera stopped → immediate UNKNOWN; resuming needs fresh 3 s confirmation', () => {
    const { sm, t } = seated();
    const lost = sm.cameraLost('CAMERA_STOPPED', t + 100);
    expect(lost).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'UNKNOWN', reason: 'CAMERA_STOPPED', detectedAt: t + 100 });
    expect(lost!.signals.cameraActive).toBe(false);
    const back = t + 60 * S;
    expect(run(sm, back, back + 2_500, 'present')).toEqual([]);
    const tr = run(sm, back + 2_500, back + 4 * S, 'present');
    expect(tr[0]).toMatchObject({ state: 'FOCUS_ESTIMATED', reason: 'SEATED_CONFIRMED', detectedAt: back });
  });

  it('permission denied → immediate UNKNOWN', () => {
    const { sm, t } = seated();
    expect(sm.cameraLost('CAMERA_PERMISSION_DENIED', t)).toMatchObject({ state: 'UNKNOWN', reason: 'CAMERA_PERMISSION_DENIED' });
  });

  it('model error → immediate UNKNOWN; a second loss while UNKNOWN emits nothing', () => {
    const { sm, t } = seated();
    expect(sm.cameraLost('MODEL_ERROR', t)).toMatchObject({ state: 'UNKNOWN', reason: 'MODEL_ERROR', detectedAt: t });
    expect(sm.cameraLost('CAMERA_STOPPED', t + 1)).toBeNull();
  });

  it('in-flight frames captured before the camera loss are ignored', () => {
    const sm = createStateMachine();
    run(sm, T0, T0 + 2 * S, 'present');
    sm.cameraLost('CAMERA_STOPPED', T0 + 2 * S);
    // late result of a frame captured before the loss + fresh frames: must not complete the old run
    expect(sm.observe(obs(T0 + 1_900, 'present'))).toBeNull();
    expect(run(sm, T0 + 2_500, T0 + 5 * S, 'present')).toEqual([]);
    expect(sm.state).toBe('UNKNOWN');
  });
});

describe('stall detection', () => {
  it('no frames for > 5 s (hidden tab) → UNKNOWN (INFERENCE_STALLED) with detectedAt = last frame', () => {
    const { sm, t } = seated();
    const last = t - 500; // last processed frame of seated()
    expect(sm.tick(last + 5 * S, false)).toBeNull();
    const tr = sm.tick(last + 5_001, false);
    expect(tr).toMatchObject({ state: 'UNKNOWN', reason: 'INFERENCE_STALLED', detectedAt: last });
    expect(tr!.signals.pageVisible).toBe(false);
    // recovery needs fresh confirmation
    const back = last + 60 * S;
    expect(run(sm, back, back + 2_500, 'present')).toEqual([]);
    expect(run(sm, back + 2_500, back + 3_500, 'present')[0]).toMatchObject({ reason: 'SEATED_CONFIRMED', detectedAt: back });
  });

  it('a frame arriving after a gap > 5 s (timers frozen, no tick ran) reports the stall', () => {
    const { sm, t } = seated();
    const last = t - 500;
    const tr = sm.observe(obs(last + 20 * S, 'present'));
    expect(tr).toMatchObject({ state: 'UNKNOWN', reason: 'INFERENCE_STALLED', detectedAt: last });
  });

  it('tick does nothing in UNKNOWN or BREAK', () => {
    const sm = createStateMachine(undefined, { state: 'UNKNOWN', since: T0 });
    expect(sm.tick(T0 + 60 * S, true)).toBeNull();
    sm.startBreak(T0);
    expect(sm.tick(T0 + 600 * S, true)).toBeNull();
  });
});

describe('elapsed time, not tick counts', () => {
  it('irregular tick spacing (100 ms bursts and 4 s gaps) gives the same transitions as regular ticks', () => {
    const scenario = (t: number): Kind => {
      const d = t - T0;
      if (d < 40 * S) return 'present';
      if (d < 80 * S) return 'absent';
      if (d < 100 * S) return 'present';
      return 'low';
    };
    const regular = createStateMachine();
    const r1 = run(regular, T0, T0 + 130 * S, (t) => obs(t, scenario(t)), 500);

    const irregular = createStateMachine();
    const r2: EngineTransition[] = [];
    let t = T0;
    let i = 0;
    while (t < T0 + 130 * S) {
      const tr = irregular.observe(obs(t, scenario(t)));
      if (tr) r2.push(tr);
      // alternate: ten 100 ms ticks, then a 4 s gap
      t += i++ % 11 === 10 ? 4 * S : 100;
    }
    const key = (x: EngineTransition) => `${x.from}->${x.state}:${x.reason}@${x.detectedAt - T0}`;
    expect(r1.map(key)).toEqual(['UNKNOWN->FOCUS_ESTIMATED:SEATED_CONFIRMED@0', 'FOCUS_ESTIMATED->AWAY:PRESENCE_LOST@40000', 'AWAY->FOCUS_ESTIMATED:SEATED_CONFIRMED@80000', 'FOCUS_ESTIMATED->UNKNOWN:LOW_CONFIDENCE@100000']);
    expect(r2.map(key)).toEqual(r1.map(key));
  });

  it('a few dense ticks never confirm seating early', () => {
    const sm = createStateMachine();
    expect(run(sm, T0, T0 + 1_000, 'present', 10)).toEqual([]); // 100 frames in 1 s
    expect(sm.state).toBe('UNKNOWN');
  });
});

describe('break and pause', () => {
  it('break start/end: BREAK_STARTED, frames ignored, BREAK_ENDED → UNKNOWN, then fresh 3 s', () => {
    const { sm, t } = seated();
    expect(sm.startBreak(t)).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'BREAK', reason: 'BREAK_STARTED', detectedAt: t });
    expect(sm.startBreak(t + 1)).toBeNull();
    expect(run(sm, t, t + 60 * S, 'absent')).toEqual([]);
    expect(sm.cameraLost('CAMERA_STOPPED', t + 61 * S)).toBeNull(); // any except BREAK
    expect(sm.pause(t + 61 * S)).toBeNull();
    expect(sm.state).toBe('BREAK');
    const end = t + 300 * S;
    expect(sm.endBreak(end)).toMatchObject({ from: 'BREAK', state: 'UNKNOWN', reason: 'BREAK_ENDED', detectedAt: end });
    expect(sm.endBreak(end + 1)).toBeNull();
    // frames captured at or before the break ended are ignored; the run starts with the next frame
    expect(sm.observe(obs(end, 'present'))).toBeNull();
    const first = end + 500;
    expect(run(sm, first, first + 2_500, 'present')).toEqual([]);
    expect(sm.observe(obs(first + 3 * S, 'present'))).toMatchObject({ reason: 'SEATED_CONFIRMED', detectedAt: first });
  });

  it('pause → UNKNOWN (MONITORING_PAUSED); paused twice emits once', () => {
    const { sm, t } = seated();
    expect(sm.pause(t)).toMatchObject({ state: 'UNKNOWN', reason: 'MONITORING_PAUSED', detectedAt: t });
    expect(sm.pause(t + 1)).toBeNull();
  });

  it('break from UNKNOWN and from DISTRACTION_SUSPECTED', () => {
    const sm = createStateMachine();
    expect(sm.startBreak(T0)).toMatchObject({ from: 'UNKNOWN', state: 'BREAK' });
    const s2 = seated().sm;
    run(s2, T0 + 16 * S, T0 + 40 * S, withPhone(() => true));
    expect(s2.state).toBe('DISTRACTION_SUSPECTED');
    expect(s2.startBreak(T0 + 41 * S)).toMatchObject({ from: 'DISTRACTION_SUSPECTED', state: 'BREAK' });
  });
});

describe('config', () => {
  it('thresholds are configurable', () => {
    const sm = createStateMachine({ seatedConfirmMs: 2_000, debounceMs: 500 });
    const tr = run(sm, T0, T0 + 2_500, 'present');
    expect(tr[0]).toMatchObject({ reason: 'SEATED_CONFIRMED', detectedAt: T0 });
  });
});

describe('v1.2 presence rule: pets / head-down / person evidence (bench/vision/RESULTS.md §B)', () => {
  const cfg = DEFAULT_ENGINE_CONFIG;
  const o = (at: number, p: Partial<FrameObservation>): FrameObservation => ({
    at,
    frameQuality: 'OK',
    faceDetected: false,
    faceScore: 0,
    upperBodyDetected: false,
    poseScore: 0,
    phoneEvaluated: false,
    phoneDetected: false,
    phoneScore: 0,
    inferenceMs: 20,
    ...p,
  });
  // Measured pet profile: BlazeFace 0.71–0.79, pose sometimes fires, COCO person ≈ 0.
  const pet = (at: number, i: number) =>
    o(at, { faceDetected: true, faceScore: 0.75, upperBodyDetected: i % 3 === 0, poseScore: i % 3 === 0 ? 0.6 : 0.1, ...(i % 2 === 0 ? { phoneEvaluated: true, personDetected: false, personScore: 0.07 } : {}) });
  // Head down writing: face lost, shoulders visible, person detected at 1 Hz (every other frame).
  const writing = (at: number, i: number) =>
    o(at, { faceScore: 0.1, upperBodyDetected: true, poseScore: 0.95, ...(i % 2 === 0 ? { phoneEvaluated: true, personDetected: true, personScore: 0.86 } : {}) });

  it('pet face (and even pet "shoulders") without a person detection is UNCERTAIN, never PRESENT', () => {
    expect(classifyFrame(pet(0, 0), cfg)).toBe('UNCERTAIN');
    expect(classifyFrame(pet(0, 1), cfg)).toBe('UNCERTAIN');
    expect(classifyFrame(o(0, { faceScore: 0.79, upperBodyDetected: true, poseScore: 0.8, personDetected: false, personScore: 0.1 }), cfg)).toBe('UNCERTAIN');
  });

  it('pet alone in front of the camera for 2 min never confirms seating', () => {
    const sm = createStateMachine(undefined, { state: 'UNKNOWN', since: T0 });
    expect(run(sm, T0, T0 + 120 * S, pet)).toEqual([]);
    expect(sm.state).toBe('UNKNOWN');
  });

  it('student leaves and a pet takes the seat → UNKNOWN (LOW_CONFIDENCE), not FOCUS', () => {
    const { sm, t } = seated();
    const tr = run(sm, t, t + 60 * S, pet);
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ from: 'FOCUS_ESTIMATED', state: 'UNKNOWN', reason: 'LOW_CONFIDENCE', detectedAt: t });
  });

  it('head-down writing (no face, shoulders + person at 1 Hz) confirms seating and stays FOCUS for 10 min', () => {
    const sm = createStateMachine(undefined, { state: 'UNKNOWN', since: T0 - 60 * S });
    const tr = run(sm, T0, T0 + 600 * S, writing);
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ state: 'FOCUS_ESTIMATED', reason: 'SEATED_CONFIRMED', detectedAt: T0 });
  });

  it('shoulders hidden too: a strong person score (≥ 0.7) alone is PRESENT, a weak one is UNCERTAIN', () => {
    expect(classifyFrame(o(0, { personDetected: true, personScore: 0.86 }), cfg)).toBe('PRESENT');
    expect(classifyFrame(o(0, { personDetected: true, personScore: 0.6 }), cfg)).toBe('UNCERTAIN');
    // person detection + grey-zone face (0.3–0.6), no shoulders
    expect(classifyFrame(o(0, { faceScore: 0.45, personDetected: true, personScore: 0.6 }), cfg)).toBe('UNCERTAIN');
    expect(classifyFrame(o(0, { faceScore: 0.45, personDetected: true, personScore: 0.75 }), cfg)).toBe('PRESENT');
  });

  it('person evidence is held ≤ 5 s across detector gaps (low-power phone cadence 4 s), then expires', () => {
    const sm = createStateMachine(undefined, { state: 'UNKNOWN', since: T0 - 60 * S });
    // face + shoulders every 500 ms, person only every 4 s
    const lowPower = (at: number, i: number) =>
      o(at, { faceScore: 0.9, upperBodyDetected: true, poseScore: 0.9, ...(i % 8 === 0 ? { phoneEvaluated: true, personDetected: true, personScore: 0.9 } : {}) });
    expect(run(sm, T0, T0 + 16 * S, lowPower)).toMatchObject([{ reason: 'SEATED_CONFIRMED', detectedAt: T0 }]);
    // detector stops reporting (e.g. object model failing): after 5 s face+shoulders alone are UNCERTAIN
    const t = T0 + 16 * S;
    const noPerson = (at: number) => o(at, { faceScore: 0.9, upperBodyDetected: true, poseScore: 0.9 });
    const tr = run(sm, t, t + 30 * S, noPerson);
    expect(tr).toHaveLength(1);
    expect(tr[0]).toMatchObject({ state: 'UNKNOWN', reason: 'LOW_CONFIDENCE' });
    // last person evidence was at T0 + 12 s (frame 24); first frame with expired evidence = +5.5 s
    expect(tr[0]!.detectedAt).toBe(T0 + 12 * S + 5_500);
  });

  it('leaving is not delayed by held person evidence: AWAY onset = first empty frame', () => {
    const { sm, t } = seated();
    const tr = run(sm, t, t + 31 * S, 'absent'); // no detector output on these frames at all
    expect(tr).toMatchObject([{ state: 'AWAY', reason: 'PRESENCE_LOST', detectedAt: t }]);
  });

  it('empty desk with a weak person false positive (0.5–0.7) is UNCERTAIN, not PRESENT', () => {
    expect(classifyFrame(o(0, { faceScore: 0.32, personDetected: true, personScore: 0.62 }), cfg)).toBe('UNCERTAIN');
    expect(classifyFrame(o(0, { personDetected: false, personScore: 0.3 }), cfg)).toBe('ABSENT');
  });

  it('producer without person evidence (v1.1 / object detector down): face + shoulders never confirm seating', () => {
    const sm = createStateMachine(undefined, { state: 'UNKNOWN', since: T0 });
    const v11 = (at: number) => o(at, { faceDetected: true, faceScore: 0.9, upperBodyDetected: true, poseScore: 0.9 });
    expect(run(sm, T0, T0 + 60 * S, v11)).toEqual([]);
    expect(classifyFrame(v11(0), cfg)).toBe('UNCERTAIN');
  });
});

describe('transition signals', () => {
  it('PHONE_SUSPECTED carries the phone score of the last detector tick, not of a face/pose-only tick', () => {
    const { sm, t } = seated();
    // detector every 3rd frame: the frame that completes 20 s (frame 40) is a face/pose-only frame
    const tr = run(sm, t, t + 25 * S, (at, i) => (i % 3 === 0 ? obs(at, 'present', true) : obs(at, 'present')));
    expect(tr.find((x) => x.reason === 'PHONE_SUSPECTED')!.detectedAt).toBe(t);
    const sus = tr.find((x) => x.reason === 'PHONE_SUSPECTED')!;
    expect(sus).toBeDefined();
    expect(sus.signals).toMatchObject({ phoneDetected: true, phoneScore: 0.8 });
  });
});
