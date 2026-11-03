import { ApiError } from '@/lib/api/client';
import type { HeartbeatResponse, StudySession, TransitionRequest, TransitionResponse } from '@/lib/api/types';
import { SessionSync, type ClientContext, type SyncApi, type SyncStorage } from './sync';

const T0 = Date.parse('2026-11-03T00:00:00Z');

function session(over: Partial<StudySession> = {}): StudySession {
  return {
    id: 's1',
    studentId: 'u1',
    status: 'ACTIVE',
    studyDate: '2026-11-03',
    startedAt: new Date(T0).toISOString(),
    currentState: 'UNKNOWN',
    currentStateSince: new Date(T0).toISOString(),
    lastSeq: 0,
    heartbeatIntervalSec: 30,
    heartbeatTimeoutSec: 90,
    ...over,
  };
}

function memStorage(): SyncStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function okResponse(req: TransitionRequest): TransitionResponse {
  return {
    eventId: req.eventId,
    seq: req.seq,
    duplicate: false,
    serverReceivedAt: new Date(T0).toISOString(),
    effectiveAt: req.detectedAt,
    currentState: req.state,
    currentStateSince: req.detectedAt,
    intervalChanged: true,
  };
}

function hb(over: Partial<HeartbeatResponse> = {}): HeartbeatResponse {
  return {
    serverTime: new Date(T0).toISOString(),
    currentState: 'FOCUS_ESTIMATED',
    currentStateSince: new Date(T0).toISOString(),
    lastSeq: 0,
    timedOut: false,
    heartbeatIntervalSec: 30,
    ...over,
  };
}

function setup(api: Partial<SyncApi> = {}, ctx: Partial<ClientContext> = {}) {
  let n = 0;
  const storage = memStorage();
  const sent: TransitionRequest[] = [];
  const heartbeats: unknown[] = [];
  const fullApi: SyncApi = {
    postTransition: vi.fn(async (_id: string, req: TransitionRequest) => {
      sent.push(req);
      return okResponse(req);
    }),
    postHeartbeat: vi.fn(async (_id: string, req) => {
      heartbeats.push(req);
      return hb();
    }),
    ...api,
  };
  const fatal = vi.fn();
  const sync = new SessionSync({
    api: fullApi,
    now: () => Date.now(),
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    storage,
    context: () => ({ engineState: 'FOCUS_ESTIMATED', cameraActive: true, pageVisible: true, ...ctx }),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onFatal: fatal,
  });
  return { sync, api: fullApi, storage, sent, heartbeats, fatal };
}

const tr = (state: TransitionRequest['state'], reason: TransitionRequest['reason'], at = Date.now()) => ({
  state,
  reason: reason as never,
  detectedAt: at,
  confidence: 0.9,
  signals: { cameraActive: true },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('SessionSync', () => {
  it('assigns uuid + strictly increasing seq and sends in order', async () => {
    const { sync, sent } = setup();
    sync.begin(session());
    sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    sync.enqueue(tr('AWAY', 'PRESENCE_LOST'));
    sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    await vi.runOnlyPendingTimersAsync();
    expect(sent.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(new Set(sent.map((s) => s.eventId)).size).toBe(3);
    expect(sync.getStatus().pendingEvents).toBe(0);
  });

  it('never sends a future detectedAt', () => {
    const { sync } = setup({ postTransition: () => new Promise(() => {}) });
    sync.begin(session());
    const req = sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED', T0 + 60_000));
    expect(req?.detectedAt).toBe(new Date(T0).toISOString());
  });

  it('retries network errors with the SAME eventId and seq (idempotent retry)', async () => {
    const attempts: TransitionRequest[] = [];
    let fail = 2;
    const { sync } = setup({
      postTransition: async (_id, req) => {
        attempts.push(req);
        if (fail-- > 0) throw new ApiError(0, 'NETWORK_ERROR', 'down');
        return okResponse(req);
      },
    });
    sync.begin(session());
    sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getStatus().pendingEvents).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000); // backoff 1s
    await vi.advanceTimersByTimeAsync(2_000); // backoff 2s
    expect(attempts).toHaveLength(3);
    expect(new Set(attempts.map((a) => a.eventId)).size).toBe(1);
    expect(new Set(attempts.map((a) => a.seq)).size).toBe(1);
    expect(sync.getStatus().pendingEvents).toBe(0);
  });

  it('keeps order while offline: later events wait behind the failing head', async () => {
    const order: number[] = [];
    let online = false;
    const { sync } = setup({
      postTransition: async (_id, req) => {
        if (!online) throw new ApiError(503, 'UNKNOWN', 'unavailable');
        order.push(req.seq);
        return okResponse(req);
      },
    });
    sync.begin(session());
    sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    sync.enqueue(tr('AWAY', 'PRESENCE_LOST'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.getStatus().pendingEvents).toBe(2);
    online = true;
    sync.notifyOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1, 2]);
  });

  it('drops events the server can never accept (SEQ_OUT_OF_ORDER) and continues', async () => {
    const { sync, sent } = setup({
      postTransition: async (_id, req) => {
        if (req.seq === 1) throw new ApiError(409, 'SEQ_OUT_OF_ORDER', 'stale');
        sent.push(req);
        return okResponse(req);
      },
    });
    sync.begin(session());
    sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    sync.enqueue(tr('AWAY', 'PRESENCE_LOST'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => s.seq)).toEqual([2]);
    expect(sync.getStatus().pendingEvents).toBe(0);
  });

  it('stops and reports fatal on SESSION_ENDED', async () => {
    const { sync, fatal } = setup({
      postTransition: async () => {
        throw new ApiError(409, 'SESSION_ENDED', 'ended');
      },
    });
    sync.begin(session());
    sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fatal).toHaveBeenCalledWith('SESSION_ENDED');
    expect(sync.enqueue(tr('AWAY', 'PRESENCE_LOST'))).toBeNull();
  });

  it('persists the queue and resumes after reload without reusing accepted seqs', async () => {
    const storage = memStorage();
    const first = setup({ postTransition: () => new Promise(() => {}) });
    // swap storage to share between instances
    Object.assign(first, { storage });
    const s1 = new SessionSync({
      api: { postTransition: () => new Promise(() => {}), postHeartbeat: async () => hb() },
      now: () => Date.now(),
      uuid: () => crypto.randomUUID(),
      storage,
      context: () => ({ engineState: 'FOCUS_ESTIMATED', cameraActive: true, pageVisible: true }),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    s1.begin(session());
    s1.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    s1.enqueue(tr('AWAY', 'PRESENCE_LOST'));
    s1.stop();

    const sent: TransitionRequest[] = [];
    const s2 = new SessionSync({
      api: {
        postTransition: async (_id, req) => {
          sent.push(req);
          return okResponse(req);
        },
        postHeartbeat: async () => hb(),
      },
      now: () => Date.now(),
      uuid: () => crypto.randomUUID(),
      storage,
      context: () => ({ engineState: 'FOCUS_ESTIMATED', cameraActive: true, pageVisible: true }),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    // server already accepted seq 1 before the reload
    s2.begin(session({ lastSeq: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((s) => s.seq)).toEqual([2]);
    expect(s2.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'))?.seq).toBe(3);
  });

  it('heartbeats immediately and then every heartbeatIntervalSec, using elapsed timers', async () => {
    const { sync, heartbeats } = setup();
    sync.begin(session());
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeats).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(heartbeats).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats[1]).toMatchObject({ clientState: 'FOCUS_ESTIMATED', cameraActive: true, lastSeq: 0 });
  });

  it('re-asserts engine state with RECONNECTED after a server heartbeat timeout', async () => {
    const { sync, sent } = setup({ postHeartbeat: async () => hb({ currentState: 'UNKNOWN', timedOut: true }) });
    sync.begin(session());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ state: 'FOCUS_ESTIMATED', reason: 'RECONNECTED', seq: 1 });
  });

  it('does not re-assert when the engine itself is UNKNOWN (camera off)', async () => {
    const { sync, sent } = setup(
      { postHeartbeat: async () => hb({ currentState: 'UNKNOWN', timedOut: true }) },
      { engineState: 'UNKNOWN', cameraActive: false },
    );
    sync.begin(session());
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(0);
  });

  it('drain resolves once the queue is flushed', async () => {
    const { sync } = setup();
    sync.begin(session());
    sync.enqueue(tr('FOCUS_ESTIMATED', 'SEATED_CONFIRMED'));
    const p = sync.drain(5_000);
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBe(true);
  });
});
