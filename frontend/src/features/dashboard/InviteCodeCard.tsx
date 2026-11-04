'use client';
import { memo, useState } from 'react';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Skeleton } from '@/components/Skeleton';
import { copyText } from './clipboard';
import { useInviteCode } from './useInviteCode';

const CONFIRM_TEXT =
  '새 코드를 발급하면 기존 코드는 즉시 사용할 수 없게 됩니다. 이미 연결된 학생은 그대로 유지됩니다.';

/**
 * Teacher dashboard card: the active invite code, copy button and a two-step rotate.
 * E2E hooks: invite-code (data-code), invite-code-copy, invite-code-rotate, invite-code-rotate-confirm.
 */
export const InviteCodeCard = memo(function InviteCodeCard() {
  const { code, loading, error, rotating, reload, rotate } = useInviteCode();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleCopy() {
    if (!code) return;
    const copied = await copyText(code.code);
    setStatus(copied ? '복사되었습니다.' : '복사하지 못했습니다. 코드를 직접 선택해 복사해 주세요.');
  }

  async function handleRotate() {
    const next = await rotate();
    setConfirming(false);
    setStatus(next ? '새 코드가 발급되었습니다.' : null);
  }

  return (
    <section
      aria-labelledby="invite-code-title"
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="invite-code-title" className="text-base font-semibold text-slate-900">
            선생님 연결 코드
          </h2>
          <p className="mt-1 text-sm text-slate-600">학생이 가입 후 이 코드를 입력하면 연결됩니다.</p>
        </div>
        <button
          type="button"
          data-testid="invite-code-rotate"
          onClick={() => {
            setStatus(null);
            setConfirming(true);
          }}
          disabled={!code || rotating}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          재발급
        </button>
      </div>

      {error && !code ? (
        <div className="mt-4">
          <ErrorBanner
            title="초대 코드를 불러오지 못했습니다"
            message={
              error.code === 'NETWORK_ERROR'
                ? '서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.'
                : error.message
            }
            onRetry={reload}
          />
        </div>
      ) : null}

      {loading && !code ? (
        <div className="mt-4" role="status" aria-label="초대 코드를 불러오는 중">
          <Skeleton className="h-14 w-56" />
        </div>
      ) : null}

      {code ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <code
            data-testid="invite-code"
            data-code={code.code}
            className="select-all rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 font-mono text-2xl font-semibold tracking-[0.18em] text-slate-900 sm:text-3xl"
          >
            {code.code}
          </code>
          <button
            type="button"
            data-testid="invite-code-copy"
            onClick={() => {
              void handleCopy();
            }}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            복사
          </button>
        </div>
      ) : null}

      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-emerald-700">
        {status}
      </p>

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby="invite-code-confirm-title"
          className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p id="invite-code-confirm-title" className="font-medium">
            코드를 재발급할까요?
          </p>
          <p className="mt-1 text-amber-800">{CONFIRM_TEXT}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="invite-code-rotate-confirm"
              onClick={() => {
                void handleRotate();
              }}
              disabled={rotating}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {rotating ? '발급 중…' : '재발급 확정'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={rotating}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              취소
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
});
