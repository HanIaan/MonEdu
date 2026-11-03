'use client';
/**
 * useStudySession (owner: C0) — glues W1's MonitoringController to the Spring API via SessionSync.
 * Contract: StudySessionApi in ../contracts.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from '@/lib/api/client';
import type { StudySession } from '@/lib/api/types';
import { nowMs } from '@/lib/time';
import { createMonitoringController } from '../engine';
import type { MonitoringController, MonitoringSnapshot, SessionStatus, StudySessionApi, SyncStatus } from '../contracts';
import { SessionSync } from './sync';
import { IDLE_SNAPSHOT } from './idle';
import { createAnalysisVideo, removeAnalysisVideo, streamOf } from './analysisVideo';

const ENGINE_VERSION = 'study-monitor-engine/1';

function safeSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function useStudySession(): StudySessionApi {
  const controllerRef = useRef<MonitoringController | null>(null);
  const syncRef = useRef<SessionSync | null>(null);
  const unsubTransitionRef = useRef<(() => void) | null>(null);
  const analysisVideoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [session, setSession] = useState<StudySession | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    online: true,
    pendingEvents: 0,
    lastHeartbeatAt: null,
    lastError: null,
  });

  const getController = useCallback((): MonitoringController => {
    if (!controllerRef.current) controllerRef.current = createMonitoringController();
    return controllerRef.current;
  }, []);

  const getSync = useCallback((): SessionSync => {
    if (!syncRef.current) {
      syncRef.current = new SessionSync({
        api: { postTransition: api.postTransition, postHeartbeat: api.postHeartbeat },
        now: nowMs,
        uuid: () => crypto.randomUUID(),
        storage: safeSessionStorage(),
        context: () => {
          const snap = controllerRef.current?.getSnapshot() ?? IDLE_SNAPSHOT;
          return {
            engineState: snap.engineState,
            cameraActive: snap.cameraStatus === 'active' && !snap.paused,
            pageVisible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
          };
        },
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (h) => window.clearTimeout(h as number),
        onChange: () => {
          const s = syncRef.current;
          if (!s) return;
          setSyncStatus(s.getStatus());
          setSession(s.sessionState);
        },
        onFatal: (reason) => {
          controllerRef.current?.pause();
          setStatus(reason === 'SESSION_ENDED' ? 'ended' : 'error');
        },
      });
    }
    return syncRef.current;
  }, []);

  // Monitoring snapshot as an external store (controller throttles notifications).
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof window === 'undefined') return () => {};
      return getController().subscribe(listener);
    },
    [getController],
  );
  const getSnapshot = useCallback(
    (): MonitoringSnapshot => controllerRef.current?.getSnapshot() ?? IDLE_SNAPSHOT,
    [],
  );
  const monitoring = useSyncExternalStore(subscribe, getSnapshot, () => IDLE_SNAPSHOT);
  // Preview stream: derived from the analysis video whenever the camera is live.
  const cameraStream = useMemo(
    () => (monitoring.cameraStatus === 'active' ? streamOf(analysisVideoRef.current) : null),
    [monitoring.cameraStatus],
  );

  const getAnalysisVideo = useCallback((): HTMLVideoElement => {
    if (!analysisVideoRef.current || !analysisVideoRef.current.isConnected) {
      analysisVideoRef.current = createAnalysisVideo();
    }
    return analysisVideoRef.current;
  }, []);

  // Online/offline → immediate retry.
  useEffect(() => {
    const on = () => syncRef.current?.notifyOnline(true);
    const off = () => syncRef.current?.notifyOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // Unmount: release camera/models/timers. Do NOT end the session (closing a tab ≠ ending study;
  // the server heartbeat timeout marks UNKNOWN).
  useEffect(
    () => () => {
      unsubTransitionRef.current?.();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      syncRef.current?.stop();
      removeAnalysisVideo(analysisVideoRef.current);
      analysisVideoRef.current = null;
    },
    [],
  );

  const start = useCallback(
    async () => {
      const video = getAnalysisVideo();
      setStatus('starting');
      try {
        const controller = getController();
        const sync = getSync();
        const s = await api.startSession({
          clientStartedAt: new Date(nowMs()).toISOString(),
          clientInfo: { userAgent: navigator.userAgent.slice(0, 512), engineVersion: ENGINE_VERSION },
        });
        setSession(s);
        sync.begin(s);
        unsubTransitionRef.current?.();
        unsubTransitionRef.current = controller.onTransition((t) => sync.enqueue(t));
        setStatus('active');
        // Camera failures surface through monitoring.cameraStatus; the session stays ACTIVE (UNKNOWN).
        await controller.start(video).catch(() => undefined);
      } catch (err) {
        setStatus('error');
        setSyncStatus((p) => ({ ...p, lastError: err instanceof ApiError ? err.message : String(err) }));
        throw err;
      }
    },
    [getController, getSync, getAnalysisVideo],
  );

  const pauseMonitoring = useCallback(() => controllerRef.current?.pause(), []);
  const resumeMonitoring = useCallback(async () => {
    await getController()
      .start(getAnalysisVideo())
      .catch(() => undefined);
  }, [getController, getAnalysisVideo]);
  const startBreak = useCallback(() => controllerRef.current?.startBreak(), []);
  const endBreak = useCallback(() => controllerRef.current?.endBreak(), []);

  const end = useCallback(async () => {
    const sync = syncRef.current;
    const current = sync?.sessionState;
    if (!sync || !current) return;
    setStatus('ending');
    // Stop measuring first (emits MONITORING_PAUSED), then flush queued transitions in order.
    controllerRef.current?.pause();
    await sync.drain(5_000);
    try {
      const ended = await api.endSession(current.id, { endedAt: new Date(nowMs()).toISOString() });
      sync.updateSession(ended);
      sync.stop(true);
      setSession(ended);
      setStatus('ended');
    } catch (err) {
      setStatus('active');
      setSyncStatus((p) => ({ ...p, lastError: err instanceof ApiError ? err.message : String(err) }));
      throw err;
    } finally {
      // Keep the controller instance (the snapshot store is subscribed to it); camera is already
      // released by pause(). Full dispose happens on unmount.
      unsubTransitionRef.current?.();
      unsubTransitionRef.current = null;
    }
  }, []);

  return useMemo(
    () => ({
      status,
      session,
      monitoring,
      sync: syncStatus,
      cameraStream,
      start,
      pauseMonitoring,
      resumeMonitoring,
      startBreak,
      endBreak,
      end,
    }),
    [status, session, monitoring, syncStatus, cameraStream, start, pauseMonitoring, resumeMonitoring, startBreak, endBreak, end],
  );
}
