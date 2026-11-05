import { render } from '@testing-library/react';
import { makeReport } from '@/features/dashboard/testFixtures';
import type { StudyDayReport } from '@/lib/api';
import { StudentScreen } from './StudentScreen';

const state = vi.hoisted(() => ({
  status: 'active', seq: 1, report: null as StudyDayReport | null,
  end: vi.fn(async () => {}), refresh: vi.fn(),
}));
vi.mock('@/features/monitoring/session', () => ({
  useStudySession: () => ({
    status: state.status, session: { id: 'session-1', lastSeq: state.seq }, end: state.end,
  }),
}));
vi.mock('@/features/dashboard/useStudyDay', () => ({
  useStudyDay: () => ({ data: state.report, refresh: state.refresh }),
}));
vi.mock('@/features/account/TeacherConnectCard', () => ({ TeacherConnectCard: () => null }));
vi.mock('./StudentStudyScreen', () => ({ StudentStudyScreen: () => null }));

it('refetches on acknowledged activity and reconciles a server-ended session locally', () => {
  state.report = makeReport();
  const { rerender } = render(<StudentScreen />);
  expect(state.end).not.toHaveBeenCalled();
  expect(state.refresh).toHaveBeenCalledTimes(1);
  state.seq += 1;
  rerender(<StudentScreen />);
  expect(state.refresh).toHaveBeenCalledTimes(2);
  state.report = makeReport({ sessions: [{ ...state.report.sessions[0]!, status: 'ENDED',
    endedAt: state.report.computedAt, endReason: 'HEARTBEAT_TIMEOUT' }], activeSessionId: null });
  rerender(<StudentScreen />);
  expect(state.end).toHaveBeenCalledTimes(1);
});
