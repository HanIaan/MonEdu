/**
 * SessionSync (owner: C0) — client half of docs/contracts/monitoring-events.md §2.
 * Framework-free and dependency-injected so it is unit-testable with fake timers.
 *
 *  - assigns eventId (UUID v4) + strictly increasing seq to every engine transition
 *  - sends transitions in seq order, one in flight, retrying network/5xx with backoff (1 s → 30 s)
 *  - persists {nextSeq, queue} per session in sessionStorage so a reload can resume
 *  - heartbeats every heartbeatIntervalSec (also during BREAK/UNKNOWN)
 *  - re-asserts engine state with RECONNECTED after a server heartbeat timeout
 */
import { ApiError } from '@/lib/api/client';
import type {
  ActivityState,
  HeartbeatRequest,
  HeartbeatResponse,
  StudySession,
  TransitionRequest,
  TransitionResponse,
} from '@/lib/api/types';
import type { EngineTransition, SyncStatus } from '../contracts';

export interface SyncApi {
  postTransition(sessionId: string, req: TransitionRequest): Promise<TransitionResponse>;
  postHeartbeat(sessionId: string, req: HeartbeatRequest): Promise<HeartbeatResponse>;
}

export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ClientContext {
  engineState: ActivityState;
  cameraActive: boolean;
  pageVisible: boolean;
}

export interface SessionSyncDeps {
  api: SyncApi;
  /** Epoch ms. */
  now: () => number;
  uuid: () => string;
  storage: SyncStorage | null;
  /** Current client-side context, read at heartbeat time. */
  context: () => ClientContext;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  onChange?: () => void;
  /** Called when the server says the session is ENDED (409 SESSION_ENDED) or auth is lost. */
  onFatal?: (reason: 'SESSION_ENDED' | 'UNAUTHORIZED') => void;
}

interface Persisted {
  nextSeq: number;
  queue: TransitionRequest[];
}

const MIN_BACKOFF = 1_000;
const MAX_BACKOFF = 30_000;
const storageKey = (sessionId: string) => `sm.sync.${sessionId}`;

export class SessionSync {
  private readonly d: SessionSyncDeps;
  private session: StudySession | null = null;
  private nextSeq = 1;
  private queue: TransitionRequest[] = [];
  private inFlight = false;
  private backoff = MIN_BACKOFF;
  private retryTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private stopped = true;
  private status: SyncStatus = { online: true, pendingEvents: 0, lastHeartbeatAt: null, lastError: null };
  private drainWaiters: Array<() => void> = [];

  constructor(deps: SessionSyncDeps) {
    this.d = deps;
  }

  get sessionState(): StudySession | null {
    return this.session;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Bind to a freshly started (or resumed) server session and start heartbeating. */
  begin(session: StudySession): void {
    this.stopInternal();
    this.session = session;
    this.stopped = false;
    const restored = this.restore(session.id);
    // Never reuse a seq the server already accepted.
    this.nextSeq = Math.max(restored?.nextSeq ?? 1, session.lastSeq + 1);
    this.queue = (restored?.queue ?? []).filter((e) => e.seq > session.lastSeq);
    this.backoff = MIN_BACKOFF;
    this.patch({ pendingEvents: this.queue.length, lastError: null });
    this.persist();
    this.scheduleHeartbeat(0);
    void this.pump();
  }

  /** Assign eventId + seq to an engine transition and queue it for delivery. */
  enqueue(t: Pick<EngineTransition, 'state' | 'reason' | 'detectedAt' | 'confidence' | 'signals'>): TransitionRequest | null {
    if (!this.session || this.stopped) return null;
    const req: TransitionRequest = {
      eventId: this.d.uuid(),
      seq: this.nextSeq++,
      state: t.state,
      reason: t.reason,
      // Never claim a future onset (server rejects > now + 5 s).
      detectedAt: new Date(Math.min(t.detectedAt, this.d.now())).toISOString(),
      confidence: clamp01(t.confidence),
      signals: t.signals,
    };
    this.queue.push(req);
    this.persist();
    this.patch({ pendingEvents: this.queue.length });
    void this.pump();
    return req;
  }

  /** Network came back: retry immediately and send a heartbeat. */
  notifyOnline(online: boolean): void {
    this.patch({ online });
    if (online && !this.stopped) {
      this.clearRetry();
      this.backoff = MIN_BACKOFF;
      void this.pump();
      this.scheduleHeartbeat(0);
    }
  }

  /** Resolve when the queue is empty, or after `timeoutMs`. */
  drain(timeoutMs: number): Promise<boolean> {
    if (this.queue.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      this.drainWaiters.push(() => finish(true));
      this.d.setTimeout(() => finish(this.queue.length === 0), timeoutMs);
      this.clearRetry();
      void this.pump();
    });
  }

  /** Stop timers. `clear` removes persisted queue (after a successful end). */
  stop(clear = false): void {
    const id = this.session?.id;
    this.stopInternal();
    if (clear && id) this.d.storage?.removeItem(storageKey(id));
  }

  /** Apply a session object returned by the server (e.g. from end). */
  updateSession(session: StudySession): void {
    this.session = session;
    this.d.onChange?.();
  }

  // ───────────────────────────── internals ─────────────────────────────

  private stopInternal(): void {
    this.stopped = true;
    this.clearRetry();
    if (this.heartbeatTimer !== null) this.d.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.inFlight = false;
  }

  private async pump(): Promise<void> {
    if (this.inFlight || this.stopped || !this.session || this.retryTimer !== null) return;
    const head = this.queue[0];
    if (!head) {
      this.flushDrainWaiters();
      return;
    }
    this.inFlight = true;
    const sessionId = this.session.id;
    try {
      const res = await this.d.api.postTransition(sessionId, head);
      if (this.session?.id !== sessionId) return;
      this.dropHead(head);
      this.backoff = MIN_BACKOFF;
      this.session = {
        ...this.session,
        currentState: res.currentState,
        currentStateSince: res.currentStateSince,
        lastSeq: Math.max(this.session.lastSeq, res.seq),
      };
      this.patch({ online: true, lastError: null });
    } catch (err) {
      if (this.session?.id !== sessionId) return;
      this.handleSendError(err, head);
    } finally {
      this.inFlight = false;
    }
    if (this.retryTimer === null) void this.pump();
  }

  private handleSendError(err: unknown, head: TransitionRequest): void {
    if (!(err instanceof ApiError)) {
      this.scheduleRetry(String(err));
      return;
    }
    if (err.retryable) {
      this.patch({ online: err.status !== 0 ? this.status.online : false });
      this.scheduleRetry(err.message);
      return;
    }
    switch (err.code) {
      case 'SESSION_ENDED':
        this.patch({ lastError: '세션이 이미 종료되었습니다.' });
        this.stopInternal();
        this.d.onFatal?.('SESSION_ENDED');
        return;
      case 'UNAUTHORIZED':
        this.patch({ lastError: '로그인이 만료되었습니다.' });
        this.stopInternal();
        this.d.onFatal?.('UNAUTHORIZED');
        return;
      default:
        // SEQ_OUT_OF_ORDER (server already has newer state), EVENT_ID_CONFLICT, VALIDATION_FAILED,
        // CLOCK_SKEW: the event can never succeed — drop it so the queue is not poisoned.
        if (err.status === 401) {
          this.stopInternal();
          this.d.onFatal?.('UNAUTHORIZED');
          return;
        }
        this.dropHead(head);
        this.patch({ lastError: `${err.code}: ${err.message}` });
    }
  }

  private dropHead(head: TransitionRequest): void {
    if (this.queue[0]?.eventId === head.eventId) this.queue.shift();
    this.persist();
    this.patch({ pendingEvents: this.queue.length });
    if (this.queue.length === 0) this.flushDrainWaiters();
  }

  private flushDrainWaiters(): void {
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const w of waiters) w();
  }

  private scheduleRetry(message: string): void {
    this.patch({ lastError: message });
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
    this.retryTimer = this.d.setTimeout(() => {
      this.retryTimer = null;
      void this.pump();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.d.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private scheduleHeartbeat(delayMs: number): void {
    if (this.heartbeatTimer !== null) this.d.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = this.d.setTimeout(() => {
      this.heartbeatTimer = null;
      void this.heartbeat();
    }, delayMs);
  }

  private async heartbeat(): Promise<void> {
    const session = this.session;
    if (!session || this.stopped) return;
    const intervalMs = Math.max(5, session.heartbeatIntervalSec) * 1000;
    const ctx = this.d.context();
    try {
      const res = await this.d.api.postHeartbeat(session.id, {
        sentAt: new Date(this.d.now()).toISOString(),
        clientState: ctx.engineState,
        cameraActive: ctx.cameraActive,
        pageVisible: ctx.pageVisible,
        lastSeq: this.nextSeq - 1,
      });
      if (this.session?.id !== session.id || this.stopped) return;
      this.session = {
        ...this.session,
        currentState: res.currentState,
        currentStateSince: res.currentStateSince,
        heartbeatIntervalSec: res.heartbeatIntervalSec,
      };
      this.patch({ online: true, lastHeartbeatAt: this.d.now() });
      // Server timed us out (UNKNOWN/HEARTBEAT_TIMEOUT) but we are monitoring again → re-assert.
      const pendingReassert = this.queue.some((e) => e.reason === 'RECONNECTED');
      if (res.timedOut && ctx.engineState !== 'UNKNOWN' && !pendingReassert) {
        this.enqueue({
          state: ctx.engineState,
          reason: 'RECONNECTED',
          detectedAt: this.d.now(),
          confidence: 1,
          signals: { cameraActive: ctx.cameraActive, pageVisible: ctx.pageVisible },
        });
      }
      this.scheduleHeartbeat(res.heartbeatIntervalSec * 1000);
    } catch (err) {
      if (this.stopped) return;
      if (err instanceof ApiError && err.code === 'SESSION_ENDED') {
        this.stopInternal();
        this.d.onFatal?.('SESSION_ENDED');
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        this.stopInternal();
        this.d.onFatal?.('UNAUTHORIZED');
        return;
      }
      this.patch({ online: !(err instanceof ApiError && err.status === 0), lastError: (err as Error).message });
      this.scheduleHeartbeat(intervalMs);
    }
  }

  private restore(sessionId: string): Persisted | null {
    try {
      const raw = this.d.storage?.getItem(storageKey(sessionId));
      if (!raw) return null;
      const p = JSON.parse(raw) as Persisted;
      if (typeof p.nextSeq !== 'number' || !Array.isArray(p.queue)) return null;
      return p;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.session) return;
    try {
      this.d.storage?.setItem(
        storageKey(this.session.id),
        JSON.stringify({ nextSeq: this.nextSeq, queue: this.queue } satisfies Persisted),
      );
    } catch {
      /* storage full/unavailable — in-memory queue still works */
    }
  }

  private patch(p: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...p };
    this.d.onChange?.();
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
