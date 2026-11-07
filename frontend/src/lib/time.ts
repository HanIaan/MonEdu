/** Time helpers (owner: C0). Wire = UTC ISO; display = Asia/Seoul. */
export const SEOUL_TZ = 'Asia/Seoul';

/** Asia/Seoul calendar date (YYYY-MM-DD) for an instant. */
export function seoulDate(at: Date | number = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SEOUL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** HH:mm:ss in Asia/Seoul. */
export function formatSeoulTime(iso: string | number | Date | null | undefined): string {
  if (iso === null || iso === undefined) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: SEOUL_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/** 3725 → "1시간 2분 5초"; compact → "1:02:05". */
export function formatDuration(totalSeconds: number | null | undefined, compact = false): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) return '—';
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (compact) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  const parts: string[] = [];
  if (h) parts.push(`${h}시간`);
  if (m || h) parts.push(`${m}분`);
  parts.push(`${sec}초`);
  return parts.join(' ');
}

/**
 * UTC epoch time for observations and API events. Use the actual wall clock: on some platforms
 * performance.now() pauses during system sleep, so timeOrigin + now() can fall minutes behind.
 * performance.now() remains suitable for measuring the execution cost of a model invocation.
 */
export function nowMs(): number {
  return Date.now();
}
