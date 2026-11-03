import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '@/lib/api/auth';
import { ApiError, api, type LoginResponse } from '@/lib/api';
import { SignupForm } from './SignupForm';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/signup',
}));

function loginResponse(role: 'STUDENT' | 'TEACHER'): LoginResponse {
  return {
    accessToken: 'token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    user: { id: 'u-1', email: role === 'STUDENT' ? 'student@example.com' : null, displayName: '김하늘', role },
  };
}

function renderForm() {
  return render(
    <AuthProvider>
      <SignupForm />
    </AuthProvider>,
  );
}

function fillValidFields({ teacher = false }: { teacher?: boolean } = {}) {
  if (teacher) fireEvent.click(screen.getByTestId('signup-role-teacher'));
  fireEvent.change(screen.getByTestId('signup-display-name'), { target: { value: '김하늘' } });
  fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'student@example.com' } });
  fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'study1234' } });
  fireEvent.change(screen.getByTestId('signup-password-confirm'), { target: { value: 'study1234' } });
  fireEvent.click(screen.getByTestId('signup-agree-terms'));
  fireEvent.click(screen.getByTestId('signup-agree-privacy'));
}

describe('SignupForm', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    vi.restoreAllMocks();
  });

  it('shows live password hints mirroring the server policy', () => {
    renderForm();
    const hints = screen.getByTestId('signup-password-hints');
    const rule = (id: string) => hints.querySelector(`[data-rule="${id}"]`);

    expect(rule('length')).toHaveAttribute('data-ok', 'false');
    expect(rule('alnum')).toHaveAttribute('data-ok', 'false');

    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'student@example.com' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'study1234' } });

    expect(rule('length')).toHaveAttribute('data-ok', 'true');
    expect(rule('alnum')).toHaveAttribute('data-ok', 'true');
    expect(rule('email')).toHaveAttribute('data-ok', 'true');
  });

  it('flags a password containing the email local part', () => {
    renderForm();
    fireEvent.change(screen.getByTestId('signup-email'), { target: { value: 'study@example.com' } });
    fireEvent.change(screen.getByTestId('signup-password'), { target: { value: 'study1234' } });

    const hints = screen.getByTestId('signup-password-hints');
    expect(hints.querySelector('[data-rule="email"]')).toHaveAttribute('data-ok', 'false');
  });

  it('blocks submit and reports a password-confirmation mismatch', async () => {
    const signupSpy = vi.spyOn(api, 'signup');
    renderForm();
    fillValidFields();
    fireEvent.change(screen.getByTestId('signup-password-confirm'), { target: { value: 'other1234' } });
    fireEvent.click(screen.getByTestId('signup-submit'));

    expect(await screen.findByTestId('signup-error-password-confirm')).toHaveTextContent(
      '비밀번호가 일치하지 않습니다.',
    );
    expect(signupSpy).not.toHaveBeenCalled();
  });

  it('maps EMAIL_TAKEN to Korean copy', async () => {
    vi.spyOn(api, 'signup').mockRejectedValue(new ApiError(409, 'EMAIL_TAKEN', 'email taken'));
    renderForm();
    fillValidFields();
    fireEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('signup-error')).toHaveTextContent('이미 가입된 이메일입니다.');
    });
    expect(screen.getByTestId('signup-error-email')).toHaveTextContent('이미 가입된 이메일입니다.');
  });

  it('shows per-field messages from VALIDATION_FAILED problem.errors', async () => {
    vi.spyOn(api, 'signup').mockRejectedValue(
      new ApiError(400, 'VALIDATION_FAILED', 'validation failed', {
        type: 'about:blank',
        title: 'validation failed',
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: [{ field: 'password', message: '흔히 쓰이는 비밀번호입니다.' }],
      }),
    );
    renderForm();
    fillValidFields();
    fireEvent.click(screen.getByTestId('signup-submit'));

    expect(await screen.findByTestId('signup-error-password')).toHaveTextContent('흔히 쓰이는 비밀번호입니다.');
    expect(screen.getByTestId('signup-error')).toHaveTextContent('입력 값을 확인해 주세요.');
  });

  it('explains throttling and network failures', async () => {
    const signupSpy = vi.spyOn(api, 'signup').mockRejectedValue(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'slow down'));
    renderForm();
    fillValidFields();
    fireEvent.click(screen.getByTestId('signup-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('signup-error')).toHaveTextContent('잠시 후 다시 시도해 주세요.');
    });

    signupSpy.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));
    fireEvent.click(screen.getByTestId('signup-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('signup-error')).toHaveTextContent('네트워크 연결을 확인한 뒤 다시 시도해 주세요.');
    });
  });

  it('routes a student to /student after sign-up', async () => {
    vi.spyOn(api, 'signup').mockResolvedValue(loginResponse('STUDENT'));
    renderForm();
    fillValidFields();
    fireEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/student'));
  });

  it('routes a teacher to /teacher after sign-up', async () => {
    vi.spyOn(api, 'signup').mockResolvedValue(loginResponse('TEACHER'));
    renderForm();
    fillValidFields({ teacher: true });
    fireEvent.click(screen.getByTestId('signup-submit'));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/teacher'));
    expect(api.signup).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'TEACHER',
        displayName: '김하늘',
        email: 'student@example.com',
        agreements: { terms: true, privacy: true },
      }),
    );
  });
});
