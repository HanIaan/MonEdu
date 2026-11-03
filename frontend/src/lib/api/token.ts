/** Access-token storage (owner: C0). sessionStorage: survives reload, cleared when the tab closes. */
const KEY = 'sm.accessToken';
let memoryToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = typeof window === 'undefined' ? null : window.sessionStorage.getItem(KEY);
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export function setToken(token: string | null): void {
  memoryToken = token;
  try {
    if (typeof window === 'undefined') return;
    if (token) window.sessionStorage.setItem(KEY, token);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private mode) — memory only */
  }
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function notifyUnauthorized(): void {
  for (const l of unauthorizedListeners) l();
}
