import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: '개인정보 처리 안내 — Study Monitor',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <AppShell
      title="개인정보 처리 안내"
      subtitle="Study Monitor가 무엇을 분석하고, 무엇을 저장하며, 어떤 한계를 가지는지 설명합니다."
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <Section title="1. 영상은 기기를 떠나지 않습니다">
          <p>
            카메라 영상은 <strong className="font-semibold text-slate-800">브라우저 안에서만</strong> 분석됩니다.
            영상, 캡처 이미지, 얼굴 이미지, 랜드마크, 객체 위치, 임베딩은 전송되거나 저장되지 않습니다.
          </p>
          <p>
            서버로 전송되는 것은 “상태가 바뀌었다”는 사실과 그 시각, 그리고 카메라·페이지가 켜져 있었는지에
            대한 최소한의 신호뿐입니다.
          </p>
        </Section>

        <Section title="2. 저장되는 정보">
          <ul className="list-disc space-y-1 pl-5">
            <li>로그인 계정 정보(이메일, 표시 이름, 역할)</li>
            <li>학습 세션의 시작·종료 시각</li>
            <li>상태 변화 시각과 상태 값(집중 추정 / 비집중 의심 / 자리비움 / 측정 불가 / 휴식)</li>
            <li>담당 교사와 학생의 연결 관계</li>
          </ul>
          <p>영상·이미지·얼굴 특징값은 어떤 형태로도 저장되지 않습니다.</p>
        </Section>

        <Section title="3. 자동 판단은 ‘추정’입니다">
          <p>
            화면의 모든 상태는 자동 분석에 따른 <strong className="font-semibold text-slate-800">추정</strong>이며
            사실 확정이 아닙니다. 특히 ‘비집중 의심’은 휴대폰으로 보이는 물체가 감지되었다는 뜻일 뿐,
            실제 사용을 확인한 것이 아닙니다.
          </p>
          <p>이 추정값은 징계나 불이익을 부과하는 근거로 사용되지 않습니다.</p>
        </Section>

        <Section title="4. 학생의 권리">
          <ul className="list-disc space-y-1 pl-5">
            <li>모니터링은 학생이 동의하고 ‘학습 시작’을 누를 때만 시작됩니다.</li>
            <li>언제든 ‘모니터링 중단’으로 카메라와 분석을 멈출 수 있습니다.</li>
            <li>‘학습 종료’로 세션을 끝낼 수 있으며, 이후에는 측정이 이루어지지 않습니다.</li>
          </ul>
        </Section>

        <Section title="5. 교사가 볼 수 있는 것">
          <p>
            담당 교사는 배정된 학생의 상태 타임라인, 상태별 누적 시간, 첫 착석 시각과 지각 여부, 마지막
            신호 시각을 볼 수 있습니다.
          </p>
          <p>교사도 영상, 이미지, 얼굴 특징값을 볼 수 없습니다.</p>
        </Section>

        <Section title="6. 문의">
          <p>개인정보 처리와 관련한 문의는 담당 교사 또는 학교 관리자에게 전달해 주세요.</p>
        </Section>

        <div className="pt-2 text-center">
          <Link
            href="/"
            className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            처음으로
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
