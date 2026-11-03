/**
 * Test/measurement hook (owner: C0). Exposes a READ-ONLY monitoring snapshot getter on
 * `window.__smDiag` so E2E/soak tests can read perf counters (framesProcessed, inference ms, state).
 * Enabled in `next dev` and in builds made with NEXT_PUBLIC_E2E_DIAGNOSTICS=1; absent otherwise.
 * The snapshot never contains pixels, landmarks or boxes, and nothing here is sent anywhere.
 */
import type { MonitoringController, MonitoringSnapshot } from '../contracts';

export interface MonitoringDiagnostics {
  snapshot(): MonitoringSnapshot;
}

declare global {
  interface Window {
    __smDiag?: MonitoringDiagnostics;
  }
}

export function diagnosticsEnabled(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_E2E_DIAGNOSTICS === '1';
}

export function exposeDiagnostics(controller: MonitoringController): void {
  if (typeof window === 'undefined' || !diagnosticsEnabled()) return;
  window.__smDiag = { snapshot: () => controller.getSnapshot() };
}
