import { render } from '@testing-library/react';
import { makeOverview } from './testFixtures';
import { TeacherStudentsView } from './TeacherStudentsView';

/**
 * Render audit (P2-W3 step 1): dashboard views are memoised, so a parent re-render with the
 * same data does not re-render the rows. Counted through the StateBadge leaf.
 */
const counters = vi.hoisted(() => ({ stateBadge: 0 }));

vi.mock('@/components/StateBadge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/StateBadge')>();
  const React = await import('react');
  return {
    ...actual,
    StateBadge: (props: Parameters<typeof actual.StateBadge>[0]) => {
      counters.stateBadge += 1;
      return React.createElement(actual.StateBadge, props);
    },
  };
});

const STUDENTS = [makeOverview()];
const NOOP = () => {};

function Harness() {
  return <TeacherStudentsView students={STUDENTS} loading={false} error={null} onRetry={NOOP} />;
}

describe('TeacherStudentsView memo', () => {
  beforeEach(() => {
    counters.stateBadge = 0;
  });

  it('does not re-render rows when the parent re-renders with unchanged props', () => {
    const { rerender } = render(<Harness />);
    expect(counters.stateBadge).toBe(1);

    rerender(<Harness />);
    rerender(<Harness />);
    expect(counters.stateBadge).toBe(1);
  });

  it('re-renders rows when the student data changes', () => {
    const { rerender } = render(<Harness />);
    expect(counters.stateBadge).toBe(1);

    rerender(
      <TeacherStudentsView
        students={[makeOverview({ currentState: 'AWAY' })]}
        loading={false}
        error={null}
        onRetry={NOOP}
      />,
    );
    expect(counters.stateBadge).toBe(2);
  });
});
