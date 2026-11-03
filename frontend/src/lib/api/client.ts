/**
 * Typed REST client for the Spring Boot API (owner: C0).
 * UI code must call these functions instead of using fetch directly.
 */
import type {
  EndSessionRequest,
  ErrorCode,
  HeartbeatRequest,
  HeartbeatResponse,
  LoginResponse,
  Problem,
  StartSessionRequest,
  StudyDayReport,
  StudySession,
  TeacherStudentOverview,
  TransitionRequest,
  TransitionResponse,
  User,
} from './types';
import { getToken, notifyUnauthorized } from './token';

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
  /** Skip Authorization header (login). */
  anonymous?: boolean;
}

export async function apiFetch<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
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
  if (res.status === 401 && !opts.anonymous) notifyUnauthorized();
  throw new ApiError(
    res.status,
    problem?.code ?? 'UNKNOWN',
    problem?.detail ?? problem?.title ?? `HTTP ${res.status}`,
    problem,
  );
}

const enc = encodeURIComponent;

export const api = {
  login: (email: string, password: string, o?: RequestOptions) =>
    apiFetch<LoginResponse>('POST', '/api/v1/auth/login', { email, password }, { ...o, anonymous: true }),
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
