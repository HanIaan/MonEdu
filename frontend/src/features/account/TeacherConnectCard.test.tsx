import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError, api } from '@/lib/api';
import { TeacherConnectCard } from './TeacherConnectCard';

const LINK = { teacher: { id: 't-1', displayName: '박선생' }, linkedAt: '2026-11-04T00:00:00Z' };

function renderCard() {
  return render(<TeacherConnectCard />);
}

describe('TeacherConnectCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'listMyTeachers').mockResolvedValue([]);
  });

  it('shows a prominent link prompt when no teacher is linked', async () => {
    renderCard();
    expect(
      await screen.findByText('아직 연결된 선생님이 없습니다. 선생님의 초대 코드를 입력하면 학습 현황이 연결됩니다.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('my-teacher')).toBeNull();
  });

  it('lists already-linked teachers', async () => {
    vi.spyOn(api, 'listMyTeachers').mockResolvedValue([LINK]);
    renderCard();

    const item = await screen.findByTestId('my-teacher');
    expect(item).toHaveAttribute('data-teacher-id', 't-1');
    expect(item).toHaveTextContent('박선생');
  });

  it('up-cases the input and strips spaces/dashes for the request', async () => {
    const join = vi.spyOn(api, 'joinTeacher').mockResolvedValue(LINK);
    renderCard();

    const input = await screen.findByTestId('teacher-join-input');
    fireEvent.change(input, { target: { value: 'abcd-2345' } });
    expect(input).toHaveValue('ABCD-2345');

    fireEvent.click(screen.getByTestId('teacher-join-submit'));
    await waitFor(() => expect(join).toHaveBeenCalledWith('ABCD2345'));
  });

  it('maps INVITE_CODE_INVALID and throttling to Korean copy', async () => {
    const join = vi.spyOn(api, 'joinTeacher').mockRejectedValue(new ApiError(404, 'INVITE_CODE_INVALID', 'bad code'));
    renderCard();

    const input = await screen.findByTestId('teacher-join-input');
    fireEvent.change(input, { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByTestId('teacher-join-submit'));

    expect(await screen.findByTestId('teacher-join-error')).toHaveTextContent('유효하지 않은 초대 코드입니다.');

    join.mockRejectedValue(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'slow down'));
    fireEvent.click(screen.getByTestId('teacher-join-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('teacher-join-error')).toHaveTextContent(
        '시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      );
    });
  });

  it('shows the Retry-After wait hint for throttled joins', async () => {
    vi.spyOn(api, 'joinTeacher').mockRejectedValue(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'slow down', null, 90));
    renderCard();

    const input = await screen.findByTestId('teacher-join-input');
    fireEvent.change(input, { target: { value: 'ABCD2345' } });
    fireEvent.click(screen.getByTestId('teacher-join-submit'));

    expect(await screen.findByTestId('teacher-join-error')).toHaveTextContent(
      '시도가 너무 많습니다. 2분 후 다시 시도해 주세요.',
    );
  });

  it('adds the teacher to the list after a successful join', async () => {
    vi.spyOn(api, 'joinTeacher').mockResolvedValue({
      teacher: { id: 't-2', displayName: '이선생' },
      linkedAt: '2026-11-04T02:00:00Z',
    });
    renderCard();

    const input = await screen.findByTestId('teacher-join-input');
    fireEvent.change(input, { target: { value: 'wxyz6789' } });
    fireEvent.click(screen.getByTestId('teacher-join-submit'));

    const item = await screen.findByTestId('my-teacher');
    expect(item).toHaveAttribute('data-teacher-id', 't-2');
    expect(screen.getByText('이선생 선생님과 연결되었습니다.')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });
});
