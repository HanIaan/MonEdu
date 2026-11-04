import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '@/lib/api/auth';
import { ApiError, api, type LoginResponse } from '@/lib/api';
import { KakaoSignupForm } from './KakaoSignupForm';

const nav = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/signup/kakao',
}));

function loginResponse(role: 'STUDENT' | 'TEACHER'): LoginResponse {
  return {
    accessToken: 'token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    user: { id: 'u-1', email: null, displayName: '카카오닉', role },
  };
}

function renderForm() {
  return render(
    <AuthProvider>
      <KakaoSignupForm />
    </AuthProvider>,
  );
}

describe('KakaoSignupForm', () => {
  beforeEach(() => {
    nav.replace.mockClear();
    vi.restoreAllMocks();
  });

  it('prefills the display name with the Kakao nickname', async () => {
    vi.spyOn(api, 'kakaoPending').mockResolvedValue({ nickname: '카카오닉' });
    renderForm();

    const input = await screen.findByTestId('kakao-signup-display-name');
    await waitFor(() => expect(input).toHaveValue('카카오닉'));
  });

  it('shows the expiry message and a login link on 401', async () => {
    vi.spyOn(api, 'kakaoPending').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'no ticket'));
    renderForm();

    const alert = await screen.findByTestId('kakao-signup-error');
    expect(alert).toHaveTextContent('카카오 인증이 만료되었습니다. 다시 로그인해 주세요.');
    expect(screen.getByRole('link', { name: '로그인 화면으로 이동' })).toHaveAttribute('href', '/login');
  });

  it('treats a missing pending ticket (404) as expired', async () => {
    vi.spyOn(api, 'kakaoPending').mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'missing'));
    renderForm();

    expect(await screen.findByTestId('kakao-signup-error')).toHaveTextContent('카카오 인증이 만료되었습니다.');
  });

  it('routes a teacher to /teacher after completing the Kakao sign-up', async () => {
    vi.spyOn(api, 'kakaoPending').mockResolvedValue({ nickname: '카카오닉' });
    vi.spyOn(api, 'kakaoComplete').mockResolvedValue(loginResponse('TEACHER'));
    renderForm();

    await screen.findByTestId('kakao-signup-display-name');
    fireEvent.click(screen.getByTestId('kakao-signup-role-teacher'));
    fireEvent.click(screen.getByTestId('kakao-signup-agree-terms'));
    fireEvent.click(screen.getByTestId('kakao-signup-agree-privacy'));
    fireEvent.click(screen.getByTestId('kakao-signup-submit'));

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/teacher'));
    expect(api.kakaoComplete).toHaveBeenCalledWith({
      displayName: '카카오닉',
      role: 'TEACHER',
      agreements: { terms: true, privacy: true },
    });
  });

  it('requires both agreements before submitting', async () => {
    vi.spyOn(api, 'kakaoPending').mockResolvedValue({ nickname: '카카오닉' });
    const complete = vi.spyOn(api, 'kakaoComplete');
    renderForm();

    await screen.findByTestId('kakao-signup-display-name');
    fireEvent.click(screen.getByTestId('kakao-signup-submit'));

    expect(await screen.findByTestId('kakao-signup-error')).toHaveTextContent(
      '이용약관과 개인정보 처리방침에 동의해 주세요.',
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it('maps server throttling to the retry message', async () => {
    vi.spyOn(api, 'kakaoPending').mockResolvedValue({ nickname: '카카오닉' });
    vi.spyOn(api, 'kakaoComplete').mockRejectedValue(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'slow down'));
    renderForm();

    await screen.findByTestId('kakao-signup-display-name');
    fireEvent.click(screen.getByTestId('kakao-signup-agree-terms'));
    fireEvent.click(screen.getByTestId('kakao-signup-agree-privacy'));
    fireEvent.click(screen.getByTestId('kakao-signup-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('kakao-signup-error')).toHaveTextContent('잠시 후 다시 시도해 주세요.');
    });
  });
});
