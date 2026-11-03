import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import { InviteCodeCard } from './InviteCodeCard';

function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

describe('InviteCodeCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getInviteCode').mockResolvedValue({ code: 'ABCD2345', createdAt: '2026-11-04T00:00:00Z' });
  });

  afterEach(() => {
    setClipboard(undefined);
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
  });

  it('renders the active code and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<InviteCodeCard />);

    const code = await screen.findByTestId('invite-code');
    expect(code).toHaveAttribute('data-code', 'ABCD2345');
    expect(code).toHaveTextContent('ABCD2345');

    fireEvent.click(screen.getByTestId('invite-code-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD2345'));
    expect(await screen.findByText('복사되었습니다.')).toBeInTheDocument();
  });

  it('falls back to the legacy copy command when the Clipboard API is unavailable', async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    render(<InviteCodeCard />);

    await screen.findByTestId('invite-code');
    fireEvent.click(screen.getByTestId('invite-code-copy'));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(await screen.findByText('복사되었습니다.')).toBeInTheDocument();
  });

  it('explains the consequences before rotating and swaps in the new code', async () => {
    vi.spyOn(api, 'rotateInviteCode').mockResolvedValue({ code: 'WXYZ6789', createdAt: '2026-11-04T01:00:00Z' });
    render(<InviteCodeCard />);
    await screen.findByTestId('invite-code');

    fireEvent.click(screen.getByTestId('invite-code-rotate'));
    expect(screen.getByText(/기존 코드는 즉시 사용할 수 없게 됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/이미 연결된 학생은 그대로 유지됩니다/)).toBeInTheDocument();
    expect(api.rotateInviteCode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('invite-code-rotate-confirm'));
    await waitFor(() => expect(screen.getByTestId('invite-code')).toHaveAttribute('data-code', 'WXYZ6789'));
    expect(api.rotateInviteCode).toHaveBeenCalledTimes(1);
  });
});
