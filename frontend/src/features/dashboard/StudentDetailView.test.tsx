import { render, screen } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import { makeReport } from './testFixtures';
import { StudentDetailView } from './StudentDetailView';

const baseProps = {
  studentId: 'student-9',
  date: '2026-11-03',
  report: null,
  loading: false,
  error: null,
  onRetry: vi.fn(),
  onDateChange: vi.fn(),
};

describe('StudentDetailView', () => {
  it('renders a friendly access-denied page for STUDENT_NOT_ASSIGNED', () => {
    render(
      <StudentDetailView
        {...baseProps}
        error={new ApiError(403, 'STUDENT_NOT_ASSIGNED', 'not assigned')}
      />,
    );
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(screen.getByTestId('access-denied')).toHaveTextContent('접근 권한이 없습니다');
    expect(screen.queryByTestId('timeline')).not.toBeInTheDocument();
  });

  it('also denies on a bare 403', () => {
    render(<StudentDetailView {...baseProps} error={new ApiError(403, 'FORBIDDEN', 'forbidden')} />);
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
  });

  it('renders summary stats and the timeline from a report', () => {
    render(<StudentDetailView {...baseProps} report={makeReport()} />);
    expect(screen.getByText('김하늘')).toBeInTheDocument();
    expect(screen.getByTestId('focus-total')).toHaveAttribute('data-seconds', '3000');
    expect(screen.getByTestId('focus-total')).toHaveTextContent('50분 0초');
    expect(screen.getByTestId('timeline')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-segment')).toHaveLength(3);
    expect(screen.getByTestId('date-picker')).toHaveValue('2026-11-03');
  });
});
