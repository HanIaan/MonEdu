import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api';
import type { User } from '@/lib/api';
import { DeleteAccountSection } from './DeleteAccountSection';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

const deleteAccount = vi.fn();
let currentUser: User | null = null;
vi.mock('@/lib/api/auth', () => ({
  useAuth: () => ({ user: currentUser, deleteAccount }),
}));

const STUDENT: User = { id: 's-1', email: 'student@sample.test', displayName: '학생', role: 'STUDENT' };
const KAKAO_TEACHER: User = { id: 't-1', email: null, displayName: '선생님', role: 'TEACHER' };

function open() {
  render(<DeleteAccountSection />);
  fireEvent.click(screen.getByTestId('delete-account-open'));
}

describe('DeleteAccountSection', () => {
  beforeEach(() => {
    replace.mockReset();
    deleteAccount.mockReset();
    currentUser = STUDENT;
  });

  it('stays collapsed until opened and lists what a student loses', () => {
    render(<DeleteAccountSection />);
    expect(screen.queryByTestId('delete-account-submit')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-account-open'));
    expect(screen.getByText(/모든 공부 기록/)).toBeInTheDocument();
  });

  it('needs the password and the confirmation before it can submit', () => {
    open();
    const submit = screen.getByTestId('delete-account-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('delete-account-password'), { target: { value: 'NobleStudy82!' } });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByTestId('delete-account-confirm'));
    expect(submit).toBeEnabled();
  });

  it('deletes with the password and goes to the login page', async () => {
    deleteAccount.mockResolvedValue(undefined);
    open();
    fireEvent.change(screen.getByTestId('delete-account-password'), { target: { value: 'NobleStudy82!' } });
    fireEvent.click(screen.getByTestId('delete-account-confirm'));
    fireEvent.click(screen.getByTestId('delete-account-submit'));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?deleted=1'));
    expect(deleteAccount).toHaveBeenCalledWith({ password: 'NobleStudy82!', confirm: true });
  });

  it('shows the server message for a wrong password and keeps the user on the page', async () => {
    deleteAccount.mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'invalid', {
        type: 'about:blank',
        title: 'Bad Request',
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'password', message: '비밀번호가 올바르지 않습니다.' }],
      } as never),
    );
    open();
    fireEvent.change(screen.getByTestId('delete-account-password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByTestId('delete-account-confirm'));
    fireEvent.click(screen.getByTestId('delete-account-submit'));

    expect(await screen.findByTestId('delete-account-error')).toHaveTextContent('비밀번호가 올바르지 않습니다.');
    expect(screen.getByTestId('delete-account-password')).toHaveAttribute('aria-invalid', 'true');
    expect(replace).not.toHaveBeenCalled();
  });

  it('asks a Kakao-only account for confirmation only', async () => {
    currentUser = KAKAO_TEACHER;
    deleteAccount.mockResolvedValue(undefined);
    open();
    expect(screen.queryByTestId('delete-account-password')).not.toBeInTheDocument();
    expect(screen.getByText(/학생 계정과 기록은 남아요/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-account-confirm'));
    fireEvent.click(screen.getByTestId('delete-account-submit'));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith({ confirm: true }));
  });
});
