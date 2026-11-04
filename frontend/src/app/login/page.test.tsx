import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '@/lib/api/auth';
import { api } from '@/lib/api';
import LoginPage from './page';

const nav = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  prefetch: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/login',
  useSearchParams: () => nav.searchParams,
}));

function renderPage() {
  return render(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    nav.searchParams = new URLSearchParams();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.spyOn(api, 'getAuthProviders').mockResolvedValue({ password: true, kakao: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows the Kakao button only when the server reports Kakao is configured', async () => {
    vi.spyOn(api, 'getAuthProviders').mockResolvedValue({ password: true, kakao: true });
    renderPage();

    expect(await screen.findByTestId('login-kakao')).toHaveTextContent('카카오 로그인');
  });

  it('hides the Kakao button when Kakao is disabled', async () => {
    let resolveProviders: (value: { password: boolean; kakao: boolean }) => void = () => {};
    const pending = new Promise<{ password: boolean; kakao: boolean }>((resolve) => {
      resolveProviders = resolve;
    });
    vi.spyOn(api, 'getAuthProviders').mockReturnValue(pending);

    renderPage();
    expect(screen.queryByTestId('login-kakao')).toBeNull();

    await act(async () => {
      resolveProviders({ password: true, kakao: false });
    });
    expect(screen.queryByTestId('login-kakao')).toBeNull();
  });

  it('shows the demo-account hint only with NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=1', () => {
    vi.stubEnv('NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS', '1');
    renderPage();
    expect(screen.getByTestId('demo-accounts')).toHaveTextContent('student1@demo.local');
  });

  it('hides the demo-account hint by default', () => {
    renderPage();
    expect(screen.queryByTestId('demo-accounts')).toBeNull();
  });

  it('links to the sign-up page', () => {
    renderPage();
    expect(screen.getByTestId('login-signup-link')).toHaveAttribute('href', '/signup');
  });

  it('explains Kakao cancellation carried in ?error=', async () => {
    nav.searchParams = new URLSearchParams('error=kakao_cancelled');
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toHaveTextContent('카카오 로그인이 취소되었습니다.');
    });
  });

  it('explains a failed Kakao login carried in ?error=', async () => {
    nav.searchParams = new URLSearchParams('error=kakao_failed');
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('login-error')).toHaveTextContent('카카오 로그인에 실패했습니다.');
    });
  });
});
