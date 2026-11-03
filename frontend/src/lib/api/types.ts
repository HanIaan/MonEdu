/** Re-exported wire types generated from docs/contracts/openapi.yaml (npm run gen:api). */
import type { components } from './schema';

type S = components['schemas'];
export type Role = S['Role'];
export type ActivityState = S['ActivityState'];
export type TransitionReason = S['TransitionReason'];
export type LateStatus = S['LateStatus'];
export type ErrorCode = S['ErrorCode'];
export type Problem = S['Problem'];
export type User = S['User'];
export type LoginRequest = S['LoginRequest'];
export type LoginResponse = S['LoginResponse'];
export type StartSessionRequest = S['StartSessionRequest'];
export type StudySession = S['StudySession'];
export type TransitionRequest = S['TransitionRequest'];
export type TransitionResponse = S['TransitionResponse'];
export type HeartbeatRequest = S['HeartbeatRequest'];
export type HeartbeatResponse = S['HeartbeatResponse'];
export type EndSessionRequest = S['EndSessionRequest'];
export type StateTotals = S['StateTotals'];
export type ActivityInterval = S['ActivityInterval'];
export type SessionSummary = S['SessionSummary'];
export type StudyDayReport = S['StudyDayReport'];
export type TeacherStudentOverview = S['TeacherStudentOverview'];
export type StreamEvent = S['StreamEvent'];
