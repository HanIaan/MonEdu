import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: '이용약관 — Study Monitor',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

const DRAFT_NOTICE = '초안 — 정식 운영 전 법률 검토가 필요합니다';

export default function TermsPage() {
  return (
    <AppShell title="이용약관" subtitle="Study Monitor 서비스 이용에 관한 기본 약속입니다.">
      <div className="mx-auto max-w-3xl space-y-4">
        <div
          role="note"
          data-testid="terms-draft-banner"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span aria-hidden="true" className="mt-0.5">⚠</span>
          <p className="font-medium">{DRAFT_NOTICE}</p>
        </div>

        <Section title="1. 목적">
          <p>
            본 약관은 Study Monitor(이하 “서비스”)의 이용 조건과 절차, 이용자와 서비스 제공자의 권리·의무를
            정하는 것을 목적으로 합니다.
          </p>
        </Section>

        <Section title="2. 계정과 역할">
          <ul className="list-disc space-y-1 pl-5">
            <li>이용자는 학생 또는 선생님 역할로 가입할 수 있습니다.</li>
            <li>이용자는 정확한 정보를 제공하고, 자신의 계정 정보를 안전하게 관리할 책임이 있습니다.</li>
            <li>학생은 선생님의 초대 코드를 입력해 선생님과 연결될 수 있습니다.</li>
          </ul>
        </Section>

        <Section title="3. 서비스의 내용">
          <p>
            서비스는 브라우저에서 카메라 영상을 분석해 학습 상태를 <strong className="font-semibold text-slate-800">추정</strong>하여
            보여 줍니다. 영상과 이미지는 기기를 떠나지 않으며, 서버에는 상태 변화의 시각과 값만 전송됩니다.
          </p>
          <p>모든 상태 표시는 자동 분석에 따른 추정이며 사실의 확정이 아닙니다.</p>
        </Section>

        <Section title="4. 이용자의 의무">
          <ul className="list-disc space-y-1 pl-5">
            <li>타인의 계정을 사용하거나 계정을 양도·대여하지 않습니다.</li>
            <li>서비스의 정상 운영을 방해하는 행위를 하지 않습니다.</li>
            <li>모니터링은 학생이 동의하고 시작한 경우에만 이루어집니다.</li>
          </ul>
        </Section>

        <Section title="5. 서비스의 변경과 중단">
          <p>
            서비스 제공자는 기능 개선이나 운영상 필요에 따라 서비스의 전부 또는 일부를 변경하거나 중단할 수
            있으며, 중요한 변경은 사전에 안내합니다.
          </p>
        </Section>

        <Section title="6. 책임의 한계">
          <p>
            추정 결과는 학습을 돕기 위한 참고 정보이며, 징계나 불이익의 근거로 사용되지 않습니다. 서비스
            제공자는 추정 결과의 정확성을 보증하지 않습니다.
          </p>
        </Section>

        <Section title="7. 문의">
          <p>약관과 관련한 문의는 담당 교사 또는 학교 관리자에게 전달해 주세요.</p>
        </Section>

        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Link
            href="/privacy"
            className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            개인정보 처리 안내
          </Link>
          <Link
            href="/login"
            className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            로그인으로
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
