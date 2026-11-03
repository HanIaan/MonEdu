import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '@/lib/api/auth';
import { ApiError, api } from '@/lib/api';
import { LoginForm } from './LoginForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/login',
}));

describe('LoginForm', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows a clear message for bad credentials', async () => {
    vi.spyOn(api, 'login').mockRejectedValue(new ApiError(401, 'BAD_CREDENTIALS', 'bad credentials'));

    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'student1@demo.local' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toHaveTextContent('이메일 또는 비밀번호가 올바르지 않습니다.');
    });
    expect(api.login).toHaveBeenCalledWith('student1@demo.local', 'wrong-password');
  });

  it('keeps the submit button disabled until both fields are filled', () => {
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    );
    const submit = screen.getByTestId('login-submit');
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('login-email'), { target: { value: 'teacher@demo.local' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'demo1234!' } });
    expect(submit).toBeEnabled();
  });
});
