/**
 * SSE over fetch (owner: C0). EventSource cannot send Authorization headers, so we stream
 * text/event-stream with fetch and parse frames. Auto-reconnects with backoff.
 */
import { API_BASE_URL, refreshAccessToken } from './client';
import { getToken, notifyUnauthorized } from './token';
import type { StreamEvent } from './types';

export type StreamPath = '/api/v1/me/stream' | '/api/v1/teacher/stream';
export type StreamConnection = 'connecting' | 'open' | 'closed';

export interface StreamHandlers {
  onEvent: (event: StreamEvent) => void;
  /** Called on every (re)connect — refetch reports here so missed events don't matter. */
  onOpen?: () => void;
  onStatus?: (status: StreamConnection) => void;
}

export interface SseFrame {
  event: string;
  data: string;
  id?: string;
}

/** Parse complete SSE frames from a buffer; returns frames and the unconsumed remainder. */
export function parseSseChunk(buffer: string): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const block of parts) {
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'id') id = value;
    }
    if (data.length) frames.push({ event, data: data.join('\n'), id });
  }
  return { frames, rest };
}

export function subscribeStream(path: StreamPath, handlers: StreamHandlers): () => void {
  let closed = false;
  let controller: AbortController | null = null;
  let retryMs = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let refreshedOnce = false;

  const setStatus = (s: StreamConnection) => handlers.onStatus?.(s);

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    setStatus('connecting');
    try {
      const token = getToken();
      const res = await fetch(`${API_BASE_URL}${path}`, {
        headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (res.status === 401) {
        // Access token expired: refresh from the cookie and reconnect at once; otherwise log out.
        if (!refreshedOnce && (await refreshAccessToken())) {
          refreshedOnce = true;
          void connect();
          return;
        }
        notifyUnauthorized();
        closed = true;
        setStatus('closed');
        return;
      }
      refreshedOnce = false;
      if (!res.ok || !res.body) throw new Error(`SSE HTTP ${res.status}`);
      retryMs = 1000;
      setStatus('open');
      handlers.onOpen?.();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const { frames, rest } = parseSseChunk(buf);
        buf = rest;
        for (const f of frames) {
          if (f.event !== 'monitoring') continue;
          try {
            handlers.onEvent(JSON.parse(f.data) as StreamEvent);
          } catch {
            /* ignore malformed frame */
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' && closed) return;
    }
    if (closed) return;
    setStatus('connecting');
    timer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 30_000);
  };

  void connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
    setStatus('closed');
  };
}
