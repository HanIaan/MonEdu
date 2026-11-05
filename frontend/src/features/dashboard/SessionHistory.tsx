import type { StudyDayReport } from '@/lib/api';
import { formatDuration, formatSeoulTime } from '@/lib/time';
import { StateBadge } from '@/components/StateBadge';
import { reasonText } from '@/components/Timeline';

/** Session boundaries and the very same activity intervals used by the day timeline. */
export function SessionHistory({ report }: { report: StudyDayReport }) {
  return (
    <div data-testid="session-history" className="overflow-x-auto">
      <p className="mb-4 text-sm text-slate-500">
        세션은 공부 시작부터 종료까지의 기록입니다. 휴식·자리비움·측정 불가도 같은 세션 안에 포함되며,
        아래 활동 내역은 위 시간대별 활동과 같은 기록입니다.
      </p>
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">세션별 활동 기록</caption>
        <thead>
          <tr className="text-xs font-semibold text-slate-500">
            {['시작', '종료', '활동 상태', '지속 시간', '사유'].map((label) => (
              <th key={label} scope="col" className="px-4 pb-3">{label}</th>
            ))}
          </tr>
        </thead>
        {[...report.sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)).map((session, index) => {
          const intervals = report.intervals.filter((interval) => interval.sessionId === session.id)
            .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
          return (
            <tbody key={session.id} data-session-id={session.id}>
              <tr className="border-t border-slate-200 bg-slate-50">
                <th colSpan={5} scope="rowgroup" className="px-4 py-4 font-medium text-slate-600">
                  <span className="font-bold text-slate-900">세션 {index + 1}</span>
                  {' · '}{formatSeoulTime(session.startedAt)} – {session.endedAt ? formatSeoulTime(session.endedAt) : '진행 중'}
                  {' · '}{session.status === 'ACTIVE' ? '진행 중' : '종료'}
                  {session.endReason ? ` · ${reasonText(session.endReason)}` : ''}
                </th>
              </tr>
              {intervals.map((interval) => (
                <tr key={interval.id} data-testid="session-activity" data-interval-id={interval.id}
                  className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 tabular-nums">{formatSeoulTime(interval.startedAt)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {interval.endedAt ? formatSeoulTime(interval.endedAt) : '진행 중'}
                  </td>
                  <td className="px-4 py-3"><StateBadge state={interval.state} /></td>
                  <td className="px-4 py-3 tabular-nums">{formatDuration(interval.durationSeconds)}</td>
                  <td className="px-4 py-3 text-slate-600">{reasonText(interval.reason)}</td>
                </tr>
              ))}
              {intervals.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-3 text-slate-500">기록된 활동 구간이 없습니다.</td></tr>
              ) : null}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
