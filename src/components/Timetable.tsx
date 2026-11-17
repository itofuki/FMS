/* src/components/Timetable.tsx
 * 時間割。課題ページと同じ考え方で作る:
 *   - 今日の授業はタイムライン（左に時刻、右に1枚ずつのカード）。昼休みや空きコマも表示
 *   - カード右上に状態のバッジ（授業中・次の授業・終了）、終わった授業は薄く
 *   - カードから出席ページ・その科目の課題へ
 *   - 広い画面では右の列に「次の授業」と「今日締切の課題」
 *   - 今日／週の切り替えは文字のボタン
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { IconType } from 'react-icons';
import { FiArrowRight, FiExternalLink, FiFileText, FiClock, FiCoffee, FiCheckCircle } from 'react-icons/fi';
import ChapterFrame from './ChapterFrame';
import { useUnifiedAssignments } from '../hooks/useUnifiedAssignments';
import { useAttendance, type AttendanceMap } from '../hooks/useAttendance';
import { absenceAllowance, type AttendanceSummary } from '../lib/attendance';
import type { Subject as AssignmentSubject } from '../lib/assignments';
import {
  PERIODS, WEEKDAYS, WEEKDAY_LABELS, formatHm, formatMinutes, focusPeriod, minutesLeft,
  nowInJst, periodState, periodTime, weekdayOf,
} from '../lib/schedule';
import './Timetable.css';

export type Subject = {
  id: string;
  wday: string;
  period: number;
  name: string;
  classroom: string;
  teacher: string;
  categoryCode?: string;
  attendanceId?: number | null;
};
export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';

const LMS_BASE = 'https://lms-tokyo.iput.ac.jp';
/** 出席IDがあれば出席ページ、なければコースページ */
const courseUrl = (s: Subject) => `${LMS_BASE}/course/view.php?id=${s.id.split('-')[0]}`;
const attendanceUrl = (s: Subject) =>
  s.attendanceId ? `${LMS_BASE}/mod/attendance/view.php?id=${s.attendanceId}` : courseUrl(s);

/** 出席を取る時間（開始10分前〜授業中）。この間だけ右の列の出席ボタンを目立たせる */
const ATTENDANCE_LEAD_MIN = 10;

/** 1分ごとに更新される日本時間の「今」 */
function useNow() {
  const [now, setNow] = useState(nowInJst);
  useEffect(() => {
    const t = window.setInterval(() => setNow(nowInJst()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

// ------------------------------------------------------------------
// 今日のタイムライン
// ------------------------------------------------------------------

type TimelineItem =
  | { kind: 'class'; subject: Subject }
  | { kind: 'gap'; label: string; from: string; to: string };

/** 授業の間に「昼休み」「空きコマ」を挟んだ並びを作る（時限を順に進め、3限に入る直前に昼休みを入れる） */
function buildTimeline(subjects: Subject[]): TimelineItem[] {
  const sorted = [...subjects].sort((a, b) => a.period - b.period);
  const items: TimelineItem[] = [];
  sorted.forEach((s, i) => {
    const prev = sorted[i - 1];
    if (prev) {
      for (let p = prev.period + 1; p <= s.period; p++) {
        if (p === 3) items.push({ kind: 'gap', label: '昼休み', from: '12:25', to: '13:20' });
        if (p < s.period) {
          const t = periodTime(p);
          if (t) items.push({ kind: 'gap', label: `空きコマ（${p}限）`, from: formatHm(t.start), to: formatHm(t.end) });
        }
      }
    }
    items.push({ kind: 'class', subject: s });
  });
  return items;
}

function StateBadge({ state, minutes }: { state: 'current' | 'next' | 'after' | 'before'; minutes: number }) {
  const map = {
    current: { label: `授業中・あと${formatMinutes(minutes)}`, cls: 'bg-accent-soft text-accent border-accent/40', dot: 'bg-accent' },
    next: { label: `次の授業・あと${formatMinutes(minutes)}`, cls: 'bg-warn-soft text-warn border-warn/40', dot: 'bg-warn' },
    before: { label: 'これから', cls: 'bg-surface text-fg-muted border-line-strong', dot: 'bg-fg-subtle' },
    after: { label: '終了', cls: 'bg-surface text-fg-subtle border-line', dot: 'bg-fg-subtle' },
  }[state];
  return (
    <span data-state-badge className={`absolute -top-2.5 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold whitespace-nowrap ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} aria-hidden="true" />
      {map.label}
    </span>
  );
}

function TodayTimeline({ subjects, now, assignmentCount, attendance }: { subjects: Subject[]; now: Date; assignmentCount: (name: string) => number; attendance: AttendanceMap }) {
  const focus = focusPeriod(subjects.map(s => s.period), now);
  const items = buildTimeline(subjects);

  if (subjects.length === 0) {
    return (
      <div className="text-center py-12 px-4 bg-surface border border-line rounded-lg">
        <FiCoffee size={28} className="mx-auto text-fg-subtle mb-2" />
        <p className="text-fg-muted text-sm">{weekdayOf(now) ? '今日の授業はありません' : '今日は授業がありません（週の表示で一週間分を確認できます）'}</p>
      </div>
    );
  }

  return (
    <ol className="relative">
      {items.map((item, i) => {
        if (item.kind === 'gap') {
          return (
            <li key={`gap-${i}`} className="flex gap-3 sm:gap-4">
              <div className="w-12 sm:w-14 flex-shrink-0" />
              <div className="relative flex-1 pl-5 sm:pl-6 py-2.5">
                <span className="absolute left-0 top-0 bottom-0 border-l-2 border-dashed border-line" aria-hidden="true" />
                <p className="text-sm text-fg-subtle">{item.label}<span className="ml-3">{item.from}〜{item.to}</span></p>
              </div>
            </li>
          );
        }
        const s = item.subject;
        const t = periodTime(s.period)!;
        const state = periodState(s.period, now);
        const isFocus = focus?.period === s.period;
        const badgeState = state === 'current' ? 'current' : state === 'after' ? 'after' : isFocus ? 'next' : 'before';
        const count = assignmentCount(s.name);
        return (
          <li key={s.id} className="flex gap-3 sm:gap-4">
            {/* 左: 時刻 */}
            <div className={`w-12 sm:w-14 flex-shrink-0 pt-4 text-right ${state === 'after' ? 'text-fg-subtle' : 'text-fg'}`}>
              <p className="text-base sm:text-lg font-bold leading-none">{formatHm(t.start)}</p>
              <p className="mt-1 text-xs text-fg-muted">{formatHm(t.end)}</p>
            </div>
            {/* 中: 線と点 */}
            <div className="relative flex-1 pl-5 sm:pl-6 pb-5">
              <span className="absolute left-0 top-0 bottom-0 border-l-2 border-line" aria-hidden="true" />
              <span
                className={`absolute -left-[7px] top-5 w-3 h-3 rounded-full border-2 ${
                  state === 'current' ? 'bg-accent border-accent ring-4 ring-accent/20' : state === 'after' ? 'bg-surface border-line-strong' : 'bg-surface border-accent'
                }`}
                aria-hidden="true"
              />
              {/* 右: カード */}
              <div className={`relative rounded-xl px-4 sm:px-5 py-4 transition-opacity ${
                // 課題カードと同じ色（ライトは白、ダークは元の配色の slate-700/80）
                state === 'current' ? 'shadow-sm bg-surface dark:bg-slate-700/80 ring-2 ring-accent'
                // 終わった授業: ライトは背景より一段濃い灰色の地と枠（背景に溶け込まないよう地は不透明）にし、中身だけ薄くする。
                // 右上の状態バッジはカードの縁にまたがるので薄くしない（透けて枠線が見えるため）。
                // ダークは課題の完了と同じ slate-800/60
                : state === 'after' ? 'bg-[#d5dce5] border border-[#bcc6d3] [&>*:not([data-state-badge])]:opacity-55 dark:border-0 dark:bg-slate-800/60 dark:[&>*:not([data-state-badge])]:opacity-100 dark:opacity-60 dark:shadow-sm'
                : 'shadow-sm bg-surface dark:bg-slate-700/80'
              }`}>
                <StateBadge state={badgeState} minutes={minutesLeft(s.period, now)} />
                <p className="text-sm text-fg-muted">
                  <span className="font-semibold text-accent">{s.period}限</span>
                  <span className="mx-1.5 text-fg-subtle">·</span>
                  {s.classroom || '教室未定'}
                  <span className="mx-1.5 text-fg-subtle">·</span>
                  {s.teacher}
                </p>
                {/* 授業名を押すと出席ページ（なければコースページ）が開く。課題カードと同じく右に ↗ だけ付ける */}
                <a
                  href={attendanceUrl(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.attendanceId ? '出席ページを開く' : 'コースページを開く'}
                  className="mt-1.5 inline-flex items-start gap-1.5 text-[17px] sm:text-lg font-bold text-fg leading-snug break-words hover:text-link hover:underline"
                >
                  <span>{s.name}</span>
                  <FiExternalLink size={15} className="mt-1.5 flex-shrink-0 text-fg-subtle" aria-hidden="true" />
                </a>
                {(count > 0 || (s.attendanceId && attendance[s.attendanceId])) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {s.attendanceId && attendance[s.attendanceId] && <AttendanceChip summary={attendance[s.attendanceId]} periodsPerDay={periodsPerDay(subjects, s)} />}
                    {count > 0 && (
                    <Link to="?tab=assignments" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line-strong text-fg hover:bg-surface-2 transition-colors">
                      <FiFileText size={13} className="text-warn" />
                      <span className="text-xs font-bold">課題 {count}件</span>
                    </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------------
// 週の表
// ------------------------------------------------------------------

function WeekGrid({ weeklySubjects, now }: { weeklySubjects: Record<Day, Subject[]>; now: Date }) {
  const today = weekdayOf(now);
  return (
    <div className="bg-bg dark:bg-surface border border-line rounded-lg p-2 sm:p-4">
      {/* ライトは灰色の地に白いマス（課題ページと同じ見え方）、ダークは元の地の色 */}
      {/* スマホでも5日分が1画面に収まるよう、最小幅は付けない。科目名は2行まで出し、超える分は「…」で省く（全文はマスの title で見られる） */}
      <div className="grid gap-1 sm:gap-2" style={{ gridTemplateColumns: 'auto repeat(5, minmax(0, 1fr))' }}>
        <div />
        {WEEKDAYS.map(d => (
          <div key={d} className="flex justify-center pb-1">
            <span className={`px-2 sm:px-2.5 py-0.5 rounded-full text-sm font-bold ${d === today ? 'bg-accent-solid text-on-accent' : 'text-fg-muted'}`}>
              {WEEKDAY_LABELS[d]}
            </span>
          </div>
        ))}
        {PERIODS.map(p => (
          <React.Fragment key={p.period}>
            <div className="pr-0.5 sm:pr-2 flex flex-col items-end justify-center">
              <span className="text-xs sm:text-sm font-bold text-accent">{p.period}<span className="hidden sm:inline">限</span></span>
              <span className="hidden sm:block text-[10px] text-fg-subtle">{formatHm(p.start)}</span>
            </div>
            {WEEKDAYS.map(d => {
              const s = weeklySubjects[d]?.find(x => x.period === p.period);
              const isNow = d === today && periodState(p.period, now) === 'current';
              if (!s) return <div key={d} className="min-h-16 rounded-md sm:rounded-lg border border-dashed border-line" />;
              return (
                <a
                  key={d}
                  href={attendanceUrl(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${s.name}（${s.classroom} / ${s.teacher}）`}
                  className={`min-h-16 rounded-md sm:rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 flex flex-col justify-center gap-0.5 shadow-sm transition-colors ${
                    // 授業のマスも課題カードと同じ色
                    isNow ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface dark:bg-slate-700/80 hover:bg-surface-2 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className="text-[11px] sm:text-[13px] font-bold text-fg leading-tight line-clamp-2 break-all sm:break-normal text-center">{s.name}</span>
                  {/* 教室と先生を左右半分ずつ（それぞれ中央揃え）。収まらない分は「…」で省く（全文はマスの title で見られる） */}
                  <span className="grid grid-cols-2 gap-1 text-[10px] sm:text-[11px] text-fg-muted leading-tight">
                    <span className="truncate text-center">{s.classroom}</span>
                    <span className="truncate text-center">{s.teacher}</span>
                  </span>
                </a>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// 出席率（LMS の出欠）
// ------------------------------------------------------------------

/** 「出席率 100%（記録 1 / 全 15 回）」。まだ記録がなければ「出席の記録はまだありません（全 15 回）」 */
function attendanceLabel(a: AttendanceSummary) {
  return a.percent === null
    ? `出席の記録はまだありません（全 ${a.total} 回）`
    : `出席率 ${Math.round(a.percent)}%（記録 ${a.completed} / 全 ${a.total} 回）`;
}

/** その授業が 1 日に何コマあるか（同じコースが同じ曜日に並んでいる数）。休める回数の上限の計算に使う */
function periodsPerDay(daySubjects: Subject[], s: Subject) {
  const courseId = s.id.split('-')[0];
  return Math.max(1, daySubjects.filter(x => x.id.split('-')[0] === courseId && x.wday === s.wday).length);
}

/** 「あと 2 回休める」。上限が近ければ注意の色、超えていれば赤 */
function AbsencesLeft({ summary, periodsPerDay, prefix = '' }: { summary: AttendanceSummary; periodsPerDay: number; prefix?: string }) {
  const a = absenceAllowance(summary, periodsPerDay);
  if (!a) return null;
  const tone = a.absencesLeft < 0 ? 'text-down' : a.absencesLeft <= 1 ? 'text-warn' : 'text-fg';
  return (
    <span className={`font-bold ${tone}`} title={`減点 ${a.lost} 点 / 上限 ${a.limit} 点（欠席 −3 点・遅刻 −1 点）`}>
      {prefix}{a.absencesLeft < 0 ? '休める上限を超えています' : `あと${a.absencesLeft}回休める`}
    </span>
  );
}

/** 授業カードの下段に出す出席率と休める回数（押せない表示だけのもの） */
function AttendanceChip({ summary, periodsPerDay }: { summary: AttendanceSummary; periodsPerDay: number }) {
  return (
    <span
      title={`${attendanceLabel(summary)}${summary.points ? `・得点 ${summary.points}` : ''}（LMS の出欠より・1日1回更新）`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-2 dark:bg-slate-800/60 text-fg-muted"
    >
      <FiCheckCircle size={13} className="text-up" aria-hidden="true" />
      <span className="text-xs font-bold">
        {summary.percent === null ? '出席 記録なし' : <>出席率 <span className="text-fg">{Math.round(summary.percent)}%</span></>}
        <span className="font-normal ml-1">（{summary.completed}/{summary.total}回）</span>
        <AbsencesLeft summary={summary} periodsPerDay={periodsPerDay} prefix=" · " />
      </span>
    </span>
  );
}

// ------------------------------------------------------------------
// 右の列: 授業中・次の授業
// ------------------------------------------------------------------

function NextClassCard({ subjects, now, attendance }: { subjects: Subject[]; now: Date; attendance: AttendanceMap }) {
  const focus = focusPeriod(subjects.map(s => s.period), now);
  const s = focus ? subjects.find(x => x.period === focus.period) : undefined;
  const t = s ? periodTime(s.period) : undefined;
  return (
    <div className="px-4 sm:px-5 py-4">
      <p className="text-sm font-bold text-fg-muted flex items-center gap-1.5"><FiClock size={14} />{focus?.state === 'current' ? '授業中' : '次の授業'}</p>
      {s && t ? (
        <>
          <p className="mt-2 text-sm text-fg-muted"><span className="font-semibold text-accent mr-2">{s.period}限</span>{s.classroom} · {s.teacher}</p>
          <p className="mt-1 text-lg font-bold text-fg leading-snug">{s.name}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {focus!.state === 'current'
              ? <>{formatHm(t.end)} まで（あと<span className="font-bold text-accent">{formatMinutes(minutesLeft(s.period, now))}</span>）</>
              : <>{formatHm(t.start)} 開始（あと<span className="font-bold text-warn">{formatMinutes(minutesLeft(s.period, now))}</span>）</>}
          </p>
          {s.attendanceId && attendance[s.attendanceId] && (
            <p className="mt-1 text-sm text-fg-muted">{attendanceLabel(attendance[s.attendanceId])}<AbsencesLeft summary={attendance[s.attendanceId]} periodsPerDay={periodsPerDay(subjects, s)} prefix="・" /></p>
          )}
          {/* 出席する: 出席を取る時間（開始10分前〜授業中）で、出席ページがある科目のときだけ出す。
              それ以外は情報だけ（コースページ・出席ページは授業カードの授業名からも開ける） */}
          {s.attendanceId && (focus!.state === 'current' || minutesLeft(s.period, now) <= ATTENDANCE_LEAD_MIN) && (
            <a
              href={attendanceUrl(s)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent shadow-sm transition-colors"
            >
              <FiCheckCircle size={15} aria-hidden="true" />
              <span className="text-sm font-bold">出席する</span>
              <FiExternalLink size={13} className="opacity-70" aria-hidden="true" />
            </a>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">{weekdayOf(now) ? (subjects.length ? '今日の授業は終わりました' : '今日の授業はありません') : '今日は授業がありません'}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// メイン
// ------------------------------------------------------------------

interface TimetableContainerProps {
  isWeeklyView: boolean;
  onChangeView: (weekly: boolean) => void;
  courseStyle: { icon: IconType; label: string; color: string } | null;
  isProfileSet: boolean;
  weeklySubjects: Record<Day, Subject[]>;
  /** 課題数を出すための科目一覧（課題ページと同じもの） */
  subjects: AssignmentSubject[];
}

export const TimetableContainer: React.FC<TimetableContainerProps> = ({
  isWeeklyView, onChangeView, courseStyle, isProfileSet, weeklySubjects, subjects,
}) => {
  const now = useNow();
  const today = weekdayOf(now);
  const todaySubjects = useMemo(() => (today ? weeklySubjects[today] ?? [] : []), [today, weeklySubjects]);
  const { items } = useUnifiedAssignments(subjects);
  // 出席率（LMS の出欠）。1 日 1 回取得し、端末にキャッシュする
  const attendance = useAttendance(useMemo(() => Object.values(weeklySubjects).flat(), [weeklySubjects]));
  const assignmentCount = (name: string) => items.filter(a => !a.done && a.subject_name === name).length;

  const wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  const meta = (
    <span className="flex items-center gap-2 flex-wrap">
      <span className="font-semibold text-fg">{now.getMonth() + 1}/{now.getDate()}（{wd}） {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span>
      {courseStyle && courseStyle.label !== '未選択' && (
        <span className={`inline-flex items-center gap-1 font-semibold ${courseStyle.color}`}><courseStyle.icon size={14} />{courseStyle.label} コース</span>
      )}
    </span>
  );

  const viewSwitch = (
    <div role="tablist" aria-label="表示" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {[{ v: false, label: '今日' }, { v: true, label: '週' }].map(o => (
        <button
          key={o.label}
          type="button"
          role="tab"
          aria-selected={isWeeklyView === o.v}
          onClick={() => onChangeView(o.v)}
          className={`px-3.5 h-8 rounded-md transition-colors ${isWeeklyView === o.v ? 'bg-accent-solid text-on-accent' : 'text-fg-muted hover:text-fg'}`}
        >
          <span className="text-sm font-bold">{o.label}</span>
        </button>
      ))}
    </div>
  );

  if (!isProfileSet) {
    return (
      <ChapterFrame title="時間割" meta={meta}>
        <div className="text-center py-10 px-4">
          <h2 className="text-xl font-semibold text-fg mb-2">時間割を表示するには設定が必要です</h2>
          <p className="text-fg-muted mb-6">所属コースと英語クラスを選択してください。</p>
          <Link to="?tab=setting" className="inline-flex items-center gap-2 bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-bold py-3 px-6 rounded-lg transition-colors">
            <span>設定を開く</span>
            <FiArrowRight />
          </Link>
        </div>
      </ChapterFrame>
    );
  }

  return (
    <ChapterFrame title="時間割" bare>
      {/* 今日・週のどちらでも右の列を出し、切り替えボタンの位置が動かないようにする */}
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8 xl:items-start">
        <aside className="mb-6 xl:mb-0 xl:order-2 xl:sticky xl:top-4 bg-surface border border-line">
          <NextClassCard subjects={todaySubjects} now={now} attendance={attendance} />
        </aside>
        <div className="xl:order-1 min-w-0 xl:px-6">
          {/* 見出し行: 左に日付、右に今日・週の切り替え（課題の「追加」と同じく真ん中の列の右上） */}
          <div className="flex items-center justify-between gap-3 mb-4 px-1 xl:px-0">
            <div className="flex items-center gap-2 min-w-0 text-sm text-fg-muted">{meta}</div>
            <div className="flex-shrink-0">{viewSwitch}</div>
          </div>
          {isWeeklyView ? (
            <WeekGrid weeklySubjects={weeklySubjects} now={now} />
          ) : (
            <div className="pt-3">
              <TodayTimeline subjects={todaySubjects} now={now} assignmentCount={assignmentCount} attendance={attendance} />
            </div>
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};
