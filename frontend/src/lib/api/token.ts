/**
 * Access-token storage (owner: C0). v1.3: memory only — never Web Storage (XSS cannot read it from
 * storage). A reload or a new tab gets a fresh access token from the HttpOnly refresh cookie
 * (`POST /api/v1/auth/refresh`, see client.ts and docs/contracts/auth.md §2).
 */
const LEGACY_KEY = 'sm.accessToken';
let memoryToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

// Remove a token left in sessionStorage by an older build (contract v1.2 and earlier).
try {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(LEGACY_KEY);
} catch {
  /* storage unavailable */
}

export function getToken(): string | null {
  return memoryToken;
}

export function setToken(token: string | null): void {
  memoryToken = token;
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function notifyUnauthorized(): void {
  for (const l of unauthorizedListeners) l();
}
