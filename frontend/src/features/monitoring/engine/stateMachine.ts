/**
 * Pure, deterministic monitoring state machine (docs/contracts/state-machine.md §2–§3).
 * No timers, no Date.now(): every time value comes from observations (`obs.at`) or an explicit `now`.
 */
import {
  DEFAULT_ENGINE_CONFIG,
  type ActivityState,
  type ClientTransitionReason,
  type CreateStateMachine,
  type EngineConfig,
  type EngineTransition,
  type FrameObservation,
  type StateMachine,
  type TransitionSignals,
} from '../contracts';
import { EvidenceRun } from './evidenceRun';

export type FrameEvidence = 'PRESENT' | 'ABSENT' | 'UNCERTAIN';

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const round2 = (v: number) => Math.round(clamp01(v) * 100) / 100;

export function mergeConfig(config?: Partial<EngineConfig>): EngineConfig {
  return {
    ...DEFAULT_ENGINE_CONFIG,
    ...config,
    camera: { ...DEFAULT_ENGINE_CONFIG.camera, ...config?.camera },
  };
}

/**
 * Person evidence (contract v1.2: COCO "person" from the object detector, which runs at the phone
 * cadence) is held for this long; older evidence counts as "not known". ≥ the slowest adaptive phone
 * interval (4 s) so a low-power cadence does not starve the presence rule.
 */
export const PERSON_HOLD_MS = 5_000;
/** A person score this high is human evidence on its own (head down, face and shoulders hidden). */
export const PERSON_STRONG_SCORE = 0.7;
/** Default for `personDetected` when a producer reports only `personScore`. */
const PERSON_MIN_SCORE = 0.5;

export interface PersonEvidence {
  detected: boolean;
  score: number;
}

/** Person evidence carried by this observation itself (undefined fields = not reported). */
export function personOf(obs: FrameObservation): PersonEvidence | null {
  if (obs.personDetected === undefined && obs.personScore === undefined) return null;
  const score = obs.personScore ?? (obs.personDetected ? 1 : 0);
  return { detected: obs.personDetected ?? score >= PERSON_MIN_SCORE, score };
}

/**
 * §2 per-frame classification (v1.2 presence rule, bench/vision/RESULTS.md §B).
 * Head pose / gaze is intentionally not an input.
 *  - PRESENT needs human evidence: a recent COCO person detection AND (shoulders visible OR face
 *    ≥ presenceMinScore OR person score ≥ PERSON_STRONG_SCORE). A face alone never confirms presence
 *    (pets: BlazeFace 0.71–0.79 on cats/dogs; pose also fires on 15 % of pet photos).
 *  - ABSENT: no face (< absentMaxScore), no shoulders, and no person detected IN THIS FRAME.
 *  - UNCERTAIN: anything else — face/shoulders without a person detection (pet, poster, detector not
 *    run yet), person without face/shoulders below the strong score, grey zone, low quality, error.
 * `held` = the most recent person evidence (≤ PERSON_HOLD_MS old; the detector runs at the phone
 * cadence) and only CORROBORATES face/shoulders seen in this frame. A frame with no face and no
 * shoulders is judged on its own person evidence only, so leaving is not delayed by the hold.
 */
export function classifyFrame(obs: FrameObservation, cfg: EngineConfig, held: PersonEvidence | null = personOf(obs)): FrameEvidence {
  if (obs.error || obs.frameQuality !== 'OK') return 'UNCERTAIN';
  const own = personOf(obs);
  const upperBody = obs.upperBodyDetected || obs.poseScore >= cfg.poseMinVisibility;
  const face = obs.faceScore >= cfg.presenceMinScore;
  if (obs.faceScore < cfg.absentMaxScore && !upperBody) {
    if (!own?.detected) return 'ABSENT';
    return own.score >= PERSON_STRONG_SCORE ? 'PRESENT' : 'UNCERTAIN';
  }
  const person = own ?? held;
  if (person?.detected && (upperBody || face || person.score >= PERSON_STRONG_SCORE)) return 'PRESENT';
  return 'UNCERTAIN';
}

/** Per-frame confidence that the frame supports its own classification. */
function frameConfidence(ev: FrameEvidence, obs: FrameObservation, person: PersonEvidence | null): number {
  const cue = Math.max(obs.faceScore, obs.poseScore);
  if (ev === 'PRESENT') return clamp01(person ? (cue + person.score) / 2 : cue);
  if (ev === 'ABSENT') return clamp01(1 - Math.max(cue, person?.score ?? 0));
  return 0.5;
}

class StateMachineImpl implements StateMachine {
  private readonly cfg: EngineConfig;
  private _state: ActivityState;
  private _since: number;
  private readonly presence: EvidenceRun<FrameEvidence>;
  private readonly phone: EvidenceRun<boolean>;
  /** Time of the last processed (accepted) frame; null before the first frame. */
  private lastFrameAt: number | null = null;
  /** Observations captured at or before this instant are ignored (pause, camera loss, break end). */
  private ignoreUntil = Number.NEGATIVE_INFINITY;
  private lastObs: FrameObservation | null = null;
  /** Last observation on which the object detector ran (phone signals must come from it, not from a face/pose-only tick). */
  private lastPhoneObs: FrameObservation | null = null;
  /** Most recent person evidence (v1.2) and its capture time. */
  private person: (PersonEvidence & { at: number }) | null = null;
  private pageVisible = true;
  private cameraActive = true;

  constructor(config?: Partial<EngineConfig>, initial?: { state: ActivityState; since: number }) {
    this.cfg = mergeConfig(config);
    this._state = initial?.state ?? 'UNKNOWN';
    this._since = initial?.since ?? 0;
    this.presence = new EvidenceRun<FrameEvidence>(this.cfg.debounceMs);
    this.phone = new EvidenceRun<boolean>(this.cfg.debounceMs);
  }

  get state(): ActivityState {
    return this._state;
  }
  get stateSince(): number {
    return this._since;
  }

  // ───────────────────────── frames ─────────────────────────

  observe(obs: FrameObservation): EngineTransition | null {
    if (this._state === 'BREAK') return null;
    if (!Number.isFinite(obs.at) || obs.at <= this.ignoreUntil) return null;
    if (this.lastFrameAt !== null && obs.at < this.lastFrameAt) return null; // out of order

    this.cameraActive = true;
    // A gap longer than staleFrameMs means inference stalled (e.g. hidden tab whose timers froze and
    // no tick() ran meanwhile). Evidence must not span the gap.
    let stall: EngineTransition | null = null;
    if (this.lastFrameAt !== null && obs.at - this.lastFrameAt > this.cfg.staleFrameMs) {
      stall = this.stallTransition();
      this.resetEvidence();
    }

    this.lastFrameAt = obs.at;
    this.lastObs = obs;
    if (obs.phoneEvaluated) this.lastPhoneObs = obs;
    const own = personOf(obs);
    if (own) this.person = { ...own, at: obs.at };
    const person = this.person && obs.at - this.person.at <= PERSON_HOLD_MS ? this.person : null;
    const ev = classifyFrame(obs, this.cfg, person);
    this.presence.update(ev, obs.at, frameConfidence(ev, obs, person));
    if (ev === 'PRESENT' && obs.phoneEvaluated) {
      const isPhone = obs.phoneScore >= this.cfg.phoneMinScore;
      // Baseline is "no phone": a phone run must itself survive the debounce, even on the first sample.
      if (this.phone.current === null) this.phone.update(false, obs.at, 1);
      this.phone.update(isPhone, obs.at, isPhone ? obs.phoneScore : 1 - obs.phoneScore);
    }
    if (stall) return stall; // one transition per call; fresh runs now accumulate from this frame
    return this.evaluate(obs.at);
  }

  private evaluate(now: number): EngineTransition | null {
    const c = this.cfg;
    const p = this.presence;
    const s = this._state;

    if (s === 'FOCUS_ESTIMATED' || s === 'DISTRACTION_SUSPECTED' || s === 'AWAY') {
      if (p.is('UNCERTAIN') && p.duration(now) >= c.uncertainMs) {
        return this.go('UNKNOWN', 'LOW_CONFIDENCE', p.onset, p.confidence);
      }
    }
    if (s === 'FOCUS_ESTIMATED' || s === 'DISTRACTION_SUSPECTED') {
      if (p.is('ABSENT') && p.duration(now) >= c.awayMs) {
        return this.go('AWAY', 'PRESENCE_LOST', p.onset, p.confidence);
      }
    }
    if (!p.is('PRESENT')) return null;

    if (s === 'UNKNOWN' || s === 'AWAY') {
      if (p.duration(now) >= c.seatedConfirmMs) return this.go('FOCUS_ESTIMATED', 'SEATED_CONFIRMED', p.onset, p.confidence);
      return null;
    }
    // Phone runs only count while present: the combined run starts at the later onset.
    const onset = Math.max(p.onset, this.phone.onset);
    if (s === 'FOCUS_ESTIMATED' && this.phone.is(true) && now - onset >= c.phoneSuspectMs) {
      return this.go('DISTRACTION_SUSPECTED', 'PHONE_SUSPECTED', onset, this.phone.confidence);
    }
    if (s === 'DISTRACTION_SUSPECTED' && this.phone.is(false) && now - onset >= c.focusResumeMs) {
      return this.go('FOCUS_ESTIMATED', 'FOCUS_RESUMED', onset, Math.min(p.confidence, this.phone.confidence));
    }
    return null;
  }

  // ───────────────────────── periodic / external events ─────────────────────────

  tick(now: number, pageVisible: boolean): EngineTransition | null {
    this.pageVisible = pageVisible;
    if (this._state === 'BREAK' || this._state === 'UNKNOWN') return null;
    const last = this.lastFrameAt ?? this._since;
    if (now - last > this.cfg.staleFrameMs) {
      const t = this.stallTransition();
      this.resetEvidence();
      return t;
    }
    return null;
  }

  private stallTransition(): EngineTransition | null {
    if (this._state === 'BREAK' || this._state === 'UNKNOWN') return null;
    const at = this.lastFrameAt ?? this._since;
    return this.go('UNKNOWN', 'INFERENCE_STALLED', at, 1);
  }

  cameraLost(reason: 'CAMERA_STOPPED' | 'CAMERA_PERMISSION_DENIED' | 'MODEL_ERROR', now: number): EngineTransition | null {
    this.cameraActive = false;
    this.halt(now);
    if (this._state === 'BREAK') return null;
    return this.go('UNKNOWN', reason, now, 1);
  }

  pause(now: number): EngineTransition | null {
    this.cameraActive = false;
    this.halt(now);
    if (this._state === 'BREAK') return null;
    return this.go('UNKNOWN', 'MONITORING_PAUSED', now, 1);
  }

  startBreak(now: number): EngineTransition | null {
    this.halt(now);
    return this.go('BREAK', 'BREAK_STARTED', now, 1);
  }

  endBreak(now: number): EngineTransition | null {
    if (this._state !== 'BREAK') return null;
    this.halt(now);
    return this.go('UNKNOWN', 'BREAK_ENDED', now, 1);
  }

  resetEvidence(): void {
    this.person = null;
    this.lastPhoneObs = null;
    this.presence.reset();
    this.phone.reset();
    this.lastFrameAt = null;
  }

  /** Drop evidence and ignore any in-flight frame captured before `now`. */
  private halt(now: number) {
    this.resetEvidence();
    this.ignoreUntil = Math.max(this.ignoreUntil, now);
  }

  // ───────────────────────── emit ─────────────────────────

  private go(state: ActivityState, reason: ClientTransitionReason, detectedAt: number, confidence: number): EngineTransition | null {
    if (state === this._state) return null;
    // Never back-date before the current state began (keeps the client timeline monotonic; the
    // server applies the same clamp).
    const at = Math.max(detectedAt, this._since);
    const t: EngineTransition = {
      from: this._state,
      state,
      reason,
      detectedAt: at,
      confidence: round2(confidence),
      signals: this.signals(),
    };
    this._state = state;
    this._since = at;
    return t;
  }

  private signals(): TransitionSignals {
    const o = this.lastObs;
    const sig: TransitionSignals = { cameraActive: this.cameraActive, pageVisible: this.pageVisible };
    if (o && this.cameraActive) {
      sig.faceDetected = o.faceDetected;
      sig.upperBodyDetected = o.upperBodyDetected;
      const p = this.lastPhoneObs ?? o;
      sig.phoneDetected = p.phoneDetected;
      sig.faceScore = round2(o.faceScore);
      sig.poseScore = round2(o.poseScore);
      sig.phoneScore = round2(p.phoneScore);
    }
    return sig;
  }
}

export const createStateMachine: CreateStateMachine = (config, initial) => new StateMachineImpl(config, initial);
