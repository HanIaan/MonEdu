import { render, screen, within } from '@testing-library/react';
import { makeOverview, SAMPLE_TOTALS } from './testFixtures';
import { TeacherStudentsView } from './TeacherStudentsView';

describe('TeacherStudentsView', () => {
  it('renders one row per assigned student with state badges', () => {
    const students = [
      makeOverview(),
      makeOverview({
        student: { id: 'student-2', email: 'student2@demo.local', displayName: '이바다', role: 'STUDENT' },
        activeSessionId: null,
        currentState: 'AWAY',
        currentStateSince: '2026-11-03T00:40:00Z',
        lastHeartbeatAt: null,
        today: {
          date: '2026-11-03',
          firstSeatedAt: null,
          lateSeconds: null,
          lateStatus: 'NOT_SEATED',
          totals: { ...SAMPLE_TOTALS, focusSeconds: 0 },
          currentStreakSeconds: 0,
          longestStreakSeconds: 0,
        },
      }),
    ];

    render(<TeacherStudentsView students={students} loading={false} error={null} onRetry={vi.fn()} />);

    const rows = screen.getAllByTestId('student-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-student-id', 'student-1');
    expect(rows[1]).toHaveAttribute('data-student-id', 'student-2');

    expect(within(rows[0]!).getByTestId('student-state')).toHaveAttribute('data-state', 'FOCUS_ESTIMATED');
    expect(within(rows[0]!).getByText('김하늘')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('13분 22초 지각')).toBeInTheDocument();

    expect(within(rows[1]!).getByTestId('student-state')).toHaveAttribute('data-state', 'AWAY');
    expect(within(rows[1]!).getByText('이바다')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('미착석')).toBeInTheDocument();
  });

  it('shows an empty state when no students are assigned', () => {
    render(<TeacherStudentsView students={[]} loading={false} error={null} onRetry={vi.fn()} />);
    expect(screen.getByText('배정된 학생이 없습니다')).toBeInTheDocument();
  });
});
