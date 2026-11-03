/**
 * Session sync layer (owner: C0).
 * PHASE 0 STUB: exposes the final `useStudySession()` signature so W3 can build the study screen.
 * C0 replaces the internals with the real implementation (engine ↔ API, seq queue, heartbeat)
 * during integration. Do not depend on anything except the StudySessionApi contract.
 */
'use client';
import { useMemo } from 'react';
import type { MonitoringSnapshot, StudySessionApi } from '../contracts';

export const IDLE_SNAPSHOT: MonitoringSnapshot = {
  cameraStatus: 'idle',
  modelStatus: 'idle',
  engineState: 'UNKNOWN',
  stateSince: 0,
  lastFrameAt: null,
  lastObservation: null,
  pageVisible: true,
  inferenceBackend: null,
  onBreak: false,
  paused: false,
  perf: { framesProcessed: 0, framesSkipped: 0, avgInferenceMs: 0, jsHeapBytes: null },
  error: null,
};

export function useStudySession(): StudySessionApi {
  return useMemo<StudySessionApi>(
    () => ({
      status: 'idle',
      session: null,
      monitoring: IDLE_SNAPSHOT,
      sync: { online: true, pendingEvents: 0, lastHeartbeatAt: null, lastError: null },
      start: async () => {
        throw new Error('useStudySession: not integrated yet (Phase 0 stub)');
      },
      pauseMonitoring: () => {},
      resumeMonitoring: async () => {},
      startBreak: () => {},
      endBreak: () => {},
      end: async () => {},
    }),
    [],
  );
}
