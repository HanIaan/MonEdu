import { render, screen } from '@testing-library/react';
import { ACTIVITY_STATES } from '@/features/monitoring/contracts';
import { STATE_META, StateBadge } from './StateBadge';

const EXPECTED_LABELS: Record<string, string> = {
  FOCUS_ESTIMATED: '집중 추정',
  DISTRACTION_SUSPECTED: '비집중 의심',
  AWAY: '자리비움',
  UNKNOWN: '측정 불가',
  BREAK: '휴식',
};

describe('StateBadge', () => {
  it.each(ACTIVITY_STATES)('renders the Korean label for %s and never a verdict', (state) => {
    render(<StateBadge state={state} testId="badge" />);
    const badge = screen.getByTestId('badge');
    expect(badge).toHaveAttribute('data-state', state);
    expect(badge).toHaveTextContent(EXPECTED_LABELS[state]!);
    expect(STATE_META[state].label).toBe(EXPECTED_LABELS[state]);
  });

  it('uses estimate/suspicion wording, not confirmed language', () => {
    expect(STATE_META.FOCUS_ESTIMATED.label).toContain('추정');
    expect(STATE_META.DISTRACTION_SUSPECTED.label).toContain('의심');
    expect(STATE_META.FOCUS_ESTIMATED.label).not.toContain('확정');
  });

  it('falls back to 측정 불가 for a missing state', () => {
    render(<StateBadge state={null} testId="badge" />);
    expect(screen.getByTestId('badge')).toHaveAttribute('data-state', 'UNKNOWN');
    expect(screen.getByTestId('badge')).toHaveTextContent('측정 불가');
  });
});
