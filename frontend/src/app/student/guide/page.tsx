'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ActivityInterval, ActivityState } from '@/lib/api';
import { AppShell } from '@/components/AppShell';
import { RequireRole } from '@/components/RequireRole';
import { STATE_META, STUDENT_STATE_LABEL, StateBadge } from '@/components/StateBadge';
import { Timeline } from '@/components/Timeline';

/** Numbered marker tying a spot in a screen illustration to its explanation. */
function Marker({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white ring-4 ring-white"
    >
      {n}
    </span>
  );
}

/** A drawn "screen" frame so the illustration reads as the real page, not a live control. */
function ScreenFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="overflow-hidden rounded-3xl bg-slate-50 ring-1 ring-slate-200">
      <div className="flex items-center gap-1.5 border-b border-slate-200 px-4 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        <span className="ml-3 text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div className="px-5 py-8 sm:px-10" inert>
        {children}
      </div>
    </figure>
  );
}

function Section({
  id,
  step,
  title,
  lead,
  children,
}: {
  id: string;
  step: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24 border-t-2 border-slate-900 pt-8">
      <p className="text-sm font-bold text-emerald-700">{step}</p>
      <h2 id={id} className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
        {title}
      </h2>
      {lead ? <p className="mt-2 max-w-2xl text-base text-slate-600">{lead}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Legend({ items }: { items: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="mt-8 grid gap-x-10 gap-y-5 sm:grid-cols-2">
      {items.map((item, index) => (
        <li key={item.title} className="flex gap-3">
          <Marker n={index + 1} />
          <div>
            <p className="font-bold text-slate-900">{item.title}</p>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ───────────────────────── 1. The study screen at a glance ───────────────────────── */

function StudyScreenIllustration() {
  const tile = (state: ActivityState, label: string, value: string) => (
    <div className="rounded-2xl bg-white px-3 py-3 text-center">
      <p className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${STATE_META[state].dot}`} />
        {label}
      </p>
      <p className="mt-1 font-bold text-slate-900 tabular-nums">{value}</p>
    </div>
  );

  return (
    <ScreenFrame label="학습 화면">
      <div className="mx-auto max-w-md text-center">
        <div className="flex items-center justify-center gap-2">
          <Marker n={1} />
          <StateBadge state="FOCUS_ESTIMATED" label={STUDENT_STATE_LABEL.FOCUS_ESTIMATED} size="md" />
        </div>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Marker n={2} />
          <p className="text-sm font-semibold text-slate-500">오늘 공부한 시간</p>
        </div>
        <p className="mt-1 text-6xl font-extrabold tracking-[-0.06em] text-slate-900 tabular-nums sm:text-7xl">
          1:24:37
        </p>
        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Marker n={3} />
          지금 연속 <b className="text-slate-900">32분</b> · 최고 연속 <b className="text-slate-900">48분</b>
        </div>
        <div className="mt-6 flex items-start gap-2">
          <Marker n={4} />
          <div className="grid flex-1 grid-cols-3 gap-2">
            {tile('AWAY', '자리 비움', '3분')}
            {tile('DISTRACTION_SUSPECTED', '집중 흐트러짐', '1분')}
            {tile('BREAK', '휴식', '10분')}
          </div>
        </div>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Marker n={5} />
          <span className="inline-flex h-12 items-center rounded-full bg-slate-200 px-6 font-bold text-slate-900">
            잠깐 쉬기
          </span>
          <span className="px-3 font-bold text-slate-500">끝내기</span>
        </div>
        <div className="mt-6 flex items-center gap-2">
          <Marker n={6} />
          <div className="flex h-4 flex-1 overflow-hidden" aria-hidden="true">
            <span className="w-[42%] bg-emerald-500" />
            <span className="w-[4%] bg-amber-400" />
            <span className="w-[24%] bg-emerald-500" />
            <span className="w-[10%] bg-blue-400" />
            <span className="state-striped w-[8%] bg-slate-200" />
            <span className="w-[12%] bg-emerald-500" />
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2 border-t border-slate-200 pt-4 text-sm">
          <Marker n={7} />
          <span className="inline-flex items-center gap-2 font-semibold text-slate-900">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-rose-500" />
            카메라 작동 중
          </span>
          <span className="ml-auto text-slate-600">미리보기 확인</span>
        </div>
      </div>
    </ScreenFrame>
  );
}

/* ───────────────────────── 2. Getting started ───────────────────────── */

const START_STEPS: Array<{ title: string; body: string; picture: ReactNode }> = [
  {
    title: '공부 시작 누르기',
    body: '학습 화면 가운데의 버튼을 누르면 카메라가 켜지고 기록이 시작돼요. 누르기 전에는 카메라가 절대 켜지지 않아요.',
    picture: (
      <span className="inline-flex h-12 items-center rounded-full bg-slate-900 px-8 font-bold text-white">
        공부 시작
      </span>
    ),
  },
  {
    title: '카메라 허용하기',
    body: '브라우저가 카메라 사용을 물어보면 "허용"을 눌러 주세요. 처음 한 번만 물어봐요.',
    picture: (
      <span className="inline-flex flex-col items-start gap-2 rounded-2xl bg-white p-4 text-left text-sm shadow-sm ring-1 ring-slate-200">
        <span className="font-semibold text-slate-900">localhost에서 카메라를 사용하려고 합니다</span>
        <span className="flex gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">차단</span>
          <span className="rounded-full bg-slate-900 px-3 py-1 font-semibold text-white">허용</span>
        </span>
      </span>
    ),
  },
  {
    title: '자세 확인하기',
    body: '처음 한 번 미리보기가 열려요. 얼굴과 어깨가 화면 안에 들어오면 ✓ 표시가 떠요. "확인했어요"를 누르면 닫혀요.',
    picture: (
      <span className="inline-flex flex-col gap-1 rounded-2xl bg-white p-4 text-left text-sm ring-1 ring-slate-200">
        <span className="font-semibold text-emerald-700">✓ 얼굴 확인됨</span>
        <span className="font-semibold text-emerald-700">✓ 어깨 확인됨</span>
        <span className="mt-2 rounded-full bg-slate-900 px-4 py-1.5 text-center font-semibold text-white">
          확인했어요
        </span>
      </span>
    ),
  },
  {
    title: '그대로 공부하기',
    body: '자리에 앉고 3초가 지나면 "집중하는 중"으로 바뀌고, 오늘 공부한 시간이 올라가기 시작해요.',
    picture: <StateBadge state="FOCUS_ESTIMATED" label={STUDENT_STATE_LABEL.FOCUS_ESTIMATED} size="md" />,
  },
];

/* ───────────────────────── 3. States ───────────────────────── */

const STATES: Array<{ state: ActivityState; when: string; counts: string }> = [
  {
    state: 'FOCUS_ESTIMATED',
    when: '자리에 앉아 있고 집중을 방해하는 신호가 없을 때예요. 앉은 뒤 3초면 바뀌어요.',
    counts: '오늘 공부한 시간에 더해져요',
  },
  {
    state: 'DISTRACTION_SUSPECTED',
    when: '휴대폰이 20초 넘게 보이거나, 정면을 본 채 눈을 15초 넘게 감고 있을 때예요. 15초 동안 다시 집중하면 돌아와요.',
    counts: '공부 시간에서 빠져요',
  },
  {
    state: 'AWAY',
    when: '30초 넘게 카메라에 사람이 보이지 않을 때예요. 돌아와 앉으면 다시 집중으로 바뀌어요.',
    counts: '공부 시간에서 빠져요',
  },
  {
    state: 'BREAK',
    when: '"잠깐 쉬기"를 눌렀을 때예요. 쉬는 동안에는 카메라가 꺼져요.',
    counts: '휴식 시간으로 따로 모여요',
  },
  {
    state: 'UNKNOWN',
    when: '공부를 시작하기 전, 카메라가 꺼져 있거나 막혔을 때, 영상 분석이 중단됐을 때, 기록이 없는 시간이에요.',
    counts: '공부 시간에서 빠져요',
  },
];

/* ───────────────────────── 4. Buttons ───────────────────────── */

const BUTTONS: Array<{ name: ReactNode; where: string; does: string }> = [
  {
    name: (
      <span className="inline-flex h-9 items-center rounded-full bg-slate-900 px-4 text-sm font-bold text-white">
        공부 시작
      </span>
    ),
    where: '공부 전',
    does: '카메라를 켜고 오늘 기록을 시작해요.',
  },
  {
    name: (
      <span className="inline-flex h-9 items-center rounded-full bg-slate-100 px-4 text-sm font-bold text-slate-900">
        잠깐 쉬기
      </span>
    ),
    where: '공부 중',
    does: '휴식으로 기록하고 카메라를 꺼요.',
  },
  {
    name: (
      <span className="inline-flex h-9 items-center rounded-full bg-slate-900 px-4 text-sm font-bold text-white">
        다시 공부하기
      </span>
    ),
    where: '쉬는 중',
    does: '카메라를 다시 켜고 공부 기록을 이어가요.',
  },
  {
    name: <span className="inline-flex h-9 items-center px-2 text-sm font-bold text-slate-500">끝내기</span>,
    where: '공부 중',
    does: '한 번 더 물어본 뒤 오늘 공부를 마치고 카메라를 꺼요.',
  },
  {
    name: (
      <span className="inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
        미리보기 확인
      </span>
    ),
    where: '화면 아래',
    does: '내 모습을 거울처럼 보여줘요. 보기만 할 뿐 기록에는 영향이 없어요.',
  },
  {
    name: (
      <span className="inline-flex h-9 items-center rounded-full px-3 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
        카메라 잠시 끄기
      </span>
    ),
    where: '화면 아래, 공부 중',
    does: '카메라만 잠깐 꺼요. 꺼진 동안은 미측정으로 남아요. "카메라 다시 켜기"로 돌아와요.',
  },
];

/* ───────────────────────── 5. Timeline sample ───────────────────────── */

function at(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 10, 4, h! - 9, m!)).toISOString();
}

function sample(
  id: string,
  state: ActivityState,
  reason: ActivityInterval['reason'],
  from: string,
  to: string,
): ActivityInterval {
  const startedAt = at(from);
  const endedAt = at(to);
  return {
    id,
    sessionId: 'guide',
    state,
    reason,
    startedAt,
    endedAt,
    durationSeconds: (Date.parse(endedAt) - Date.parse(startedAt)) / 1000,
    open: false,
  };
}

const SAMPLE_DAY: ActivityInterval[] = [
  sample('g1', 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED', '09:00', '09:50'),
  sample('g2', 'DISTRACTION_SUSPECTED', 'PHONE_SUSPECTED', '09:50', '09:54'),
  sample('g3', 'FOCUS_ESTIMATED', 'FOCUS_RESUMED', '09:54', '10:30'),
  sample('g4', 'BREAK', 'BREAK_STARTED', '10:30', '10:45'),
  sample('g5', 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED', '10:45', '11:20'),
  sample('g6', 'AWAY', 'PRESENCE_LOST', '11:20', '11:28'),
  // 11:28–11:45: no session (shown as not measured)
  sample('g7', 'FOCUS_ESTIMATED', 'SEATED_CONFIRMED', '11:45', '12:30'),
];

/* ───────────────────────── Page ───────────────────────── */

export default function StudentGuidePage() {
  return (
    <RequireRole role="STUDENT">
      <AppShell>
        <div className="mx-auto w-full max-w-4xl space-y-20">
          <header>
            <p className="text-sm font-bold text-emerald-700">사용 가이드</p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              켜두고 공부만 하세요.
              <br />
              시간은 MonEdu가 셀게요.
            </h1>
            <p className="mt-4 max-w-2xl text-base text-slate-600">
              카메라로 자리에 앉아 있는지, 집중이 흐트러졌는지를 AI가 판단해서 오늘 공부한 시간을 자동으로 기록해요.
              모든 판단은 AI의 추정이에요.
            </p>
            <nav aria-label="가이드 목차" className="mt-8 flex flex-wrap gap-2">
              {[
                ['#guide-screen', '화면 보는 법'],
                ['#guide-start', '시작하기'],
                ['#guide-states', '상태 5가지'],
                ['#guide-buttons', '버튼'],
                ['#guide-timeline', '시간 바'],
                ['#guide-settings', '설정'],
                ['#guide-tips', '잘 기록되는 팁'],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  {label}
                </a>
              ))}
            </nav>
          </header>

          <Section
            id="guide-screen"
            step="01"
            title="학습 화면 한눈에 보기"
            lead="번호를 따라가면 화면의 모든 정보를 읽을 수 있어요."
          >
            <StudyScreenIllustration />
            <Legend
              items={[
                { title: '지금 상태', body: '지금 어떻게 기록되고 있는지 보여줘요. 색과 글자로 함께 표시돼요.' },
                {
                  title: '오늘 공부한 시간',
                  body: '오늘 "집중하는 중"으로 기록된 시간을 모두 더한 값이에요. 매초 올라가요.',
                },
                { title: '연속 기록', body: '지금 끊기지 않고 공부한 시간과, 오늘 가장 길게 이어간 기록이에요.' },
                { title: '방해된 시간', body: '자리 비움, 집중 흐트러짐, 휴식으로 기록된 시간을 따로 모아 보여줘요.' },
                {
                  title: '버튼',
                  body: '지금 할 수 있는 일만 보여줘요. 공부 전엔 "공부 시작", 공부 중엔 "잠깐 쉬기"와 "끝내기"예요.',
                },
                {
                  title: '오늘 공부 시간 바',
                  body: '하루를 시간 순서대로 색칠한 막대예요. 마우스를 올리면 얼마나 이어졌는지 보여요.',
                },
                { title: '카메라 상태', body: '카메라가 켜져 있는지 보여줘요. 미리보기로 내 자세를 확인할 수 있어요.' },
              ]}
            />
          </Section>

          <Section
            id="guide-start"
            step="02"
            title="시작하기"
            lead="처음 한 번만 따라 하면 그다음부터는 버튼 하나로 끝나요."
          >
            <ol className="grid gap-4 sm:grid-cols-2">
              {START_STEPS.map((step, index) => (
                <li key={step.title} className="flex flex-col rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
                  <div className="flex items-center gap-2">
                    <Marker n={index + 1} />
                    <p className="text-lg font-bold text-slate-900">{step.title}</p>
                  </div>
                  <div className="my-6 flex min-h-24 items-center justify-center" aria-hidden="true">
                    {step.picture}
                  </div>
                  <p className="text-sm leading-relaxed text-slate-600">{step.body}</p>
                </li>
              ))}
            </ol>
          </Section>

          <Section
            id="guide-states"
            step="03"
            title="상태 5가지"
            lead="상태는 AI가 카메라로 판단해 자동으로 바뀌어요. 정확하지 않을 때도 있어요."
          >
            <ul className="divide-y divide-slate-200 border-y border-slate-200">
              {STATES.map(({ state, when, counts }) => (
                <li key={state} className="grid gap-3 py-5 sm:grid-cols-[11rem_1fr_auto] sm:items-center sm:gap-6">
                  <div>
                    <StateBadge state={state} label={STUDENT_STATE_LABEL[state]} size="md" />
                  </div>
                  <p className="text-sm leading-relaxed text-slate-700">{when}</p>
                  <p
                    className={`text-sm font-semibold ${state === 'FOCUS_ESTIMATED' ? 'text-emerald-700' : 'text-slate-500'}`}
                  >
                    {counts}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          <Section id="guide-buttons" step="04" title="버튼과 하는 일" lead="화면에는 지금 누를 수 있는 버튼만 나와요.">
            <ul className="grid gap-3 sm:grid-cols-2">
              {BUTTONS.map((button) => (
                <li
                  key={button.does}
                  className="flex items-center gap-4 rounded-3xl bg-slate-50 p-5 ring-1 ring-slate-200"
                >
                  <div className="w-36 shrink-0" aria-hidden="true">
                    {button.name}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500">{button.where}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-slate-800">{button.does}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            id="guide-timeline"
            step="05"
            title="오늘 공부 시간 바 읽기"
            lead="아래 예시 막대에 마우스를 올려 보세요. 각 구간이 몇 분 이어졌는지 보여요."
          >
            <div className="rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200 sm:p-8">
              <Timeline intervals={SAMPLE_DAY} computedAt={at('12:30')} labels={STUDENT_STATE_LABEL} fillGaps />
            </div>
            <ul className="mt-6 space-y-2 text-sm leading-relaxed text-slate-600">
              <li>· 왼쪽이 오늘 처음 시작한 시각, 오른쪽이 지금이에요.</li>
              <li>· 초록이 길게 이어질수록 오래 집중한 거예요.</li>
              <li>
                · 빗금은 기록이 없거나 측정하지 못한 시간이에요. 예시의 11:28–11:45처럼 공부를 쉬고 있던 시간도 빗금으로
                보여요.
              </li>
            </ul>
          </Section>

          <Section id="guide-settings" step="06" title="설정에서 할 수 있는 일">
            <ul className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  title: '선생님 연결',
                  body: '선생님께 받은 8자리 초대 코드를 넣으면 선생님이 내 공부 상태와 오늘 기록을 볼 수 있어요. 연결하지 않아도 공부는 할 수 있어요.',
                },
                {
                  title: '화면 테마',
                  body: '라이트, 다크, 시스템 설정 따라가기 중에서 고를 수 있어요. 위쪽 달·해 아이콘으로도 바로 바꿀 수 있어요.',
                },
                { title: '계정', body: '내 이름과 이메일(카카오로 가입했다면 "카카오 계정")을 확인할 수 있어요.' },
              ].map((item) => (
                <li key={item.title} className="rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
                  <p className="font-bold text-slate-900">{item.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
                </li>
              ))}
            </ul>
            <Link
              href="/student/settings"
              className="mt-6 inline-flex h-11 items-center rounded-full bg-slate-900 px-6 text-sm font-bold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              설정으로 가기
            </Link>
          </Section>

          <Section id="guide-tips" step="07" title="잘 기록되는 팁">
            <ul className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  title: '얼굴·어깨·책상이 보이게',
                  body: '카메라가 얼굴과 어깨, 책상 위 손까지 보이게 두면 자리와 휴대폰을 더 잘 알아봐요.',
                },
                { title: '밝은 곳에서', body: '너무 어둡거나 역광이면 판단이 어려워 미측정이 늘어날 수 있어요.' },
                {
                  title: '안정적인 측정을 위해',
                  body: '다른 탭이나 앱을 사용하는 동안에도 측정될 수 있어요. 다만 브라우저의 절전 기능이나 화면 잠금으로 분석이 중단되면 미측정으로 기록됩니다. 안정적인 측정을 위해 학습 창을 화면에 띄워 두세요.',
                },
                {
                  title: '쉴 땐 꼭 "잠깐 쉬기"',
                  body: '그냥 자리를 뜨면 30초 뒤 자리 비움으로 기록돼요. 휴식은 버튼으로 남겨 두는 게 좋아요.',
                },
              ].map((tip) => (
                <li key={tip.title} className="rounded-3xl bg-slate-50 p-6 ring-1 ring-slate-200">
                  <p className="font-bold text-slate-900">{tip.title}</p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{tip.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-10 text-sm text-slate-500">
              영상은 브라우저 안에서만 분석되며 서버로 전송되거나 저장되지 않아요.{' '}
              <Link href="/privacy" className="font-semibold underline underline-offset-2 hover:text-slate-900">
                개인정보 처리 안내
              </Link>
            </p>
          </Section>
        </div>
      </AppShell>
    </RequireRole>
  );
}
