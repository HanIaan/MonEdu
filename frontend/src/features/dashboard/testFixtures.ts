import type { ActivityInterval, StudyDayReport, TeacherStudentOverview } from '@/lib/api';

/** Day 2026-11-03 in Asia/Seoul: 09:00 KST == 00:00Z. */
export const DAY = '2026-11-03';
export const REFERENCE = '2026-11-03T00:00:00Z';

export const SAMPLE_TOTALS = {
  focusSeconds: 3000,
  distractionSeconds: 120,
  awaySeconds: 60,
  unknownSeconds: 30,
  breakSeconds: 0,
};

export const SAMPLE_INTERVALS: ActivityInterval[] = [
  {
    id: 'interval-1',
    sessionId: 'session-1',
    state: 'FOCUS_ESTIMATED',
    reason: 'SEATED_CONFIRMED',
    startedAt: '2026-11-03T00:00:00Z',
    endedAt: '2026-11-03T00:30:00Z',
    durationSeconds: 1800,
    open: false,
  },
  {
    id: 'interval-2',
    sessionId: 'session-1',
    state: 'AWAY',
    reason: 'PRESENCE_LOST',
    startedAt: '2026-11-03T00:30:00Z',
    endedAt: '2026-11-03T00:35:00Z',
    durationSeconds: 300,
    open: false,
  },
  {
    id: 'interval-3',
    sessionId: 'session-1',
    state: 'FOCUS_ESTIMATED',
    reason: 'SEATED_CONFIRMED',
    startedAt: '2026-11-03T00:35:00Z',
    endedAt: null,
    durationSeconds: 1500,
    open: true,
  },
];

export function makeReport(overrides: Partial<StudyDayReport> = {}): StudyDayReport {
  return {
    studentId: 'student-1',
    studentName: '김하늘',
    date: DAY,
    timezone: 'Asia/Seoul',
    referenceTime: REFERENCE,
    firstSeatedAt: '2026-11-03T00:13:22Z',
    lateSeconds: 802,
    lateStatus: 'LATE',
    totals: { ...SAMPLE_TOTALS },
    currentStreakSeconds: 1200,
    longestStreakSeconds: 2400,
    currentState: 'FOCUS_ESTIMATED',
    currentStateSince: '2026-11-03T00:35:00Z',
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        status: 'ACTIVE',
        startedAt: '2026-11-03T00:00:00Z',
        endedAt: null,
        endReason: null,
      },
    ],
    intervals: SAMPLE_INTERVALS.map((interval) => ({ ...interval })),
    computedAt: '2026-11-03T01:00:00Z',
    ...overrides,
  };
}

export function makeOverview(overrides: Partial<TeacherStudentOverview> = {}): TeacherStudentOverview {
  return {
    student: {
      id: 'student-1',
      email: 'student1@demo.local',
      displayName: '김하늘',
      role: 'STUDENT',
    },
    activeSessionId: 'session-1',
    currentState: 'FOCUS_ESTIMATED',
    currentStateSince: '2026-11-03T00:13:22Z',
    lastHeartbeatAt: '2026-11-03T01:00:20Z',
    today: {
      date: DAY,
      firstSeatedAt: '2026-11-03T00:13:22Z',
      lateSeconds: 802,
      lateStatus: 'LATE',
      totals: { ...SAMPLE_TOTALS },
      currentStreakSeconds: 1200,
      longestStreakSeconds: 2400,
    },
    ...overrides,
  };
}
