/**
 * Typed REST client for the Spring Boot API (owner: C0).
 * UI code must call these functions instead of using fetch directly.
 */
import type {
  AuthProviders,
  EndSessionRequest,
  ErrorCode,
  HeartbeatRequest,
  HeartbeatResponse,
  InviteCode,
  KakaoCompleteRequest,
  KakaoPending,
  LoginResponse,
  Problem,
  SignupRequest,
  StartSessionRequest,
  StudyDayReport,
  StudySession,
  TeacherLink,
  TeacherStudentOverview,
  TransitionRequest,
  TransitionResponse,
  User,
} from './types';
import { getToken, notifyUnauthorized, setToken } from './token';

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN';
  readonly problem: Problem | null;

  constructor(status: number, code: ApiError['code'], message: string, problem: Problem | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.problem = problem;
  }

  /** Network failure or 5xx — safe to retry. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Skip Authorization header and the 401 → refresh → retry path (auth endpoints). */
  anonymous?: boolean;
  /** Send/receive cookies (auth endpoints: refresh cookie, Kakao sign-up ticket). */
  withCredentials?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Get a new access token from the HttpOnly refresh cookie. Single-flight: concurrent callers share one
 * request (the server additionally tolerates a concurrent refresh from another tab, auth.md §2).
 * Resolves false (and clears the token) when there is no valid refresh cookie.
 */
export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= apiFetch<LoginResponse>('POST', '/api/v1/auth/refresh', undefined, { anonymous: true, withCredentials: true })
    .then((r) => {
      setToken(r.accessToken);
      return true;
    })
    .catch((err: unknown) => {
      // Network failure: keep the current token (a later call will retry); auth failure: drop it.
      if (!(err instanceof ApiError) || err.status !== 0) setToken(null);
      return false;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function apiFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  try {
    return await rawFetch<T>(method, path, body, opts);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || opts.anonymous) throw err;
    // Access token expired/missing: refresh once from the cookie, then retry once.
    if (await refreshAccessToken()) {
      try {
        return await rawFetch<T>(method, path, body, opts);
      } catch (retryErr) {
        if (retryErr instanceof ApiError && retryErr.status === 401) notifyUnauthorized();
        throw retryErr;
      }
    }
    notifyUnauthorized();
    throw err;
  }
}

async function rawFetch<T>(method: 'GET' | 'POST', path: string, body: unknown, opts: RequestOptions): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = opts.anonymous ? null : getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: opts.signal,
      cache: 'no-store',
      credentials: opts.withCredentials ? 'include' : 'same-origin',
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', '서버에 연결할 수 없습니다.');
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  let problem: Problem | null = null;
  try {
    problem = (await res.json()) as Problem;
  } catch {
    /* non-JSON error body */
  }
  throw new ApiError(
    res.status,
    problem?.code ?? 'UNKNOWN',
    problem?.detail ?? problem?.title ?? `HTTP ${res.status}`,
    problem,
  );
}

const enc = encodeURIComponent;

const authCall = (o?: RequestOptions): RequestOptions => ({ ...o, anonymous: true, withCredentials: true });

/** Top-level navigation target for "카카오 로그인" (never fetch it: it redirects to Kakao). */
export const KAKAO_START_URL = `${API_BASE_URL}/api/v1/auth/kakao/start`;

export const api = {
  login: (email: string, password: string, o?: RequestOptions) =>
    apiFetch<LoginResponse>('POST', '/api/v1/auth/login', { email, password }, authCall(o)),
  signup: (req: SignupRequest, o?: RequestOptions) => apiFetch<LoginResponse>('POST', '/api/v1/auth/signup', req, authCall(o)),
  logout: (o?: RequestOptions) => apiFetch<void>('POST', '/api/v1/auth/logout', undefined, authCall(o)),
  getAuthProviders: (o?: RequestOptions) =>
    apiFetch<AuthProviders>('GET', '/api/v1/auth/providers', undefined, { ...o, anonymous: true }),
  kakaoPending: (o?: RequestOptions) => apiFetch<KakaoPending>('GET', '/api/v1/auth/kakao/pending', undefined, authCall(o)),
  kakaoComplete: (req: KakaoCompleteRequest, o?: RequestOptions) =>
    apiFetch<LoginResponse>('POST', '/api/v1/auth/kakao/complete', req, authCall(o)),

  getInviteCode: (o?: RequestOptions) => apiFetch<InviteCode>('GET', '/api/v1/teacher/invite-code', undefined, o),
  rotateInviteCode: (o?: RequestOptions) => apiFetch<InviteCode>('POST', '/api/v1/teacher/invite-code/rotate', undefined, o),
  listMyTeachers: (o?: RequestOptions) => apiFetch<TeacherLink[]>('GET', '/api/v1/me/teachers', undefined, o),
  joinTeacher: (inviteCode: string, o?: RequestOptions) =>
    apiFetch<TeacherLink>('POST', '/api/v1/me/teachers', { inviteCode }, o),

  getMe: (o?: RequestOptions) => apiFetch<User>('GET', '/api/v1/me', undefined, o),

  startSession: (req: StartSessionRequest, o?: RequestOptions) =>
    apiFetch<StudySession>('POST', '/api/v1/study-sessions', req, o),
  getSession: (id: string, o?: RequestOptions) =>
    apiFetch<StudySession>('GET', `/api/v1/study-sessions/${enc(id)}`, undefined, o),
  postTransition: (id: string, req: TransitionRequest, o?: RequestOptions) =>
    apiFetch<TransitionResponse>('POST', `/api/v1/study-sessions/${enc(id)}/transitions`, req, o),
  postHeartbeat: (id: string, req: HeartbeatRequest, o?: RequestOptions) =>
    apiFetch<HeartbeatResponse>('POST', `/api/v1/study-sessions/${enc(id)}/heartbeat`, req, o),
  endSession: (id: string, req: EndSessionRequest, o?: RequestOptions) =>
    apiFetch<StudySession>('POST', `/api/v1/study-sessions/${enc(id)}/end`, req, o),

  getMyStudyDay: (date: string, o?: RequestOptions) =>
    apiFetch<StudyDayReport>('GET', `/api/v1/me/study-days/${enc(date)}`, undefined, o),
  listMyStudents: (o?: RequestOptions) =>
    apiFetch<TeacherStudentOverview[]>('GET', '/api/v1/teacher/students', undefined, o),
  getStudentStudyDay: (studentId: string, date: string, o?: RequestOptions) =>
    apiFetch<StudyDayReport>(
      'GET',
      `/api/v1/teacher/students/${enc(studentId)}/study-days/${enc(date)}`,
      undefined,
      o,
    ),
};
