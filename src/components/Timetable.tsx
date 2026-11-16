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
import { FiArrowRight, FiExternalLink, FiFileText, FiClock, FiCoffee } from 'react-icons/fi';
import ChapterFrame from './ChapterFrame';
import { useUnifiedAssignments } from '../hooks/useUnifiedAssignments';
import type { Subject as AssignmentSubject } from '../lib/assignments';
import {
  PERIODS, WEEKDAYS, WEEKDAY_LABELS, formatHm, formatMinutes, focusPeriod, minutesLeft,
  nowInJst, periodState, periodTime, weekdayOf, toYmd,
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
const attendanceUrl = (s: Subject) =>
  s.attendanceId ? `${LMS_BASE}/mod/attendance/view.php?id=${s.attendanceId}` : `${LMS_BASE}/course/view.php?id=${s.id.split('-')[0]}`;

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
    <span className={`absolute -top-2.5 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-bold whitespace-nowrap ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} aria-hidden="true" />
      {map.label}
    </span>
  );
}

function TodayTimeline({ subjects, now, assignmentCount }: { subjects: Subject[]; now: Date; assignmentCount: (name: string) => number }) {
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
              <div className={`relative rounded-xl shadow-sm px-4 sm:px-5 py-4 transition-opacity ${
                // 課題カードと同じ色（ライトは白、ダークは元の配色の slate-700/80、終わった授業は課題の完了と同じ slate-800/60）
                state === 'current' ? 'bg-surface dark:bg-slate-700/80 ring-2 ring-accent'
                : state === 'after' ? 'bg-surface dark:bg-slate-800/60'
                : 'bg-surface dark:bg-slate-700/80'
              } ${state === 'after' ? 'opacity-60' : ''}`}>
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
                  <FiExternalLink size={15} className="mt-1.5 flex-shrink-0 text-fg-subtle" aria-label={s.attendanceId ? '出席ページを開く' : 'コースページを開く'} />
                </a>
                {count > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link to="?tab=assignments" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line-strong text-fg hover:bg-surface-2 transition-colors">
                      <FiFileText size={13} className="text-warn" />
                      <span className="text-xs font-bold">課題 {count}件</span>
                    </Link>
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
      {/* スマホでも5日分が1画面に収まるよう、最小幅は付けない */}
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
              if (!s) return <div key={d} className="h-16 rounded-md sm:rounded-lg border border-dashed border-line" />;
              return (
                <a
                  key={d}
                  href={attendanceUrl(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${s.name}（${s.classroom} / ${s.teacher}）`}
                  className={`h-16 rounded-md sm:rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 flex flex-col justify-center gap-0.5 shadow-sm transition-colors ${
                    // 授業のマスも課題カードと同じ色
                    isNow ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface dark:bg-slate-700/80 hover:bg-surface-2 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className="text-[11px] sm:text-[13px] font-bold text-fg leading-tight line-clamp-2 break-all sm:break-normal">{s.name}</span>
                  <span className="text-[10px] sm:text-[11px] text-fg-muted truncate">{s.classroom}</span>
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
// 右の列: 次の授業・今日締切の課題
// ------------------------------------------------------------------

function NextClassCard({ subjects, now }: { subjects: Subject[]; now: Date }) {
  const focus = focusPeriod(subjects.map(s => s.period), now);
  const s = focus ? subjects.find(x => x.period === focus.period) : undefined;
  const t = s ? periodTime(s.period) : undefined;
  return (
    <div className="px-4 sm:px-5 py-4 border-b border-line">
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
          <a
            href={attendanceUrl(s)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 h-9 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors"
          >
            <FiExternalLink size={14} />
            <span className="text-sm font-bold">{s.attendanceId ? '出席ページを開く' : 'コースページを開く'}</span>
          </a>
        </>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">{weekdayOf(now) ? (subjects.length ? '今日の授業は終わりました' : '今日の授業はありません') : '今日は授業がありません'}</p>
      )}
    </div>
  );
}

function DueTodayCard({ subjects, now }: { subjects: AssignmentSubject[]; now: Date }) {
  const { items } = useUnifiedAssignments(subjects);
  const today = toYmd(now);
  const due = items.filter(a => !a.done && toYmd(new Date(new Date(a.deadline).toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))) === today);
  return (
    <div className="px-4 sm:px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-fg-muted flex items-center gap-1.5"><FiFileText size={14} />今日締切の課題</p>
        <span className={`text-sm font-bold ${due.length ? 'text-down' : 'text-fg-subtle'}`}>{due.length}件</span>
      </div>
      {due.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {due.slice(0, 3).map(a => (
            <li key={a.id} className="text-sm text-fg truncate">・{a.name.replace(/[「」]|の提出期限/g, '')}</li>
          ))}
          {due.length > 3 && <li className="text-xs text-fg-muted">ほか {due.length - 3}件</li>}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">今日が締切の課題はありません</p>
      )}
      <Link to="?tab=assignments" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
        課題を見る <FiArrowRight size={14} />
      </Link>
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
    <ChapterFrame title="時間割" meta={meta} actions={viewSwitch} bare>
      {isWeeklyView ? (
        <WeekGrid weeklySubjects={weeklySubjects} now={now} />
      ) : (
        <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8 xl:items-start">
          <aside className="mb-6 xl:mb-0 xl:order-2 xl:sticky xl:top-4 bg-surface border border-line">
            <NextClassCard subjects={todaySubjects} now={now} />
            <DueTodayCard subjects={subjects} now={now} />
          </aside>
          <div className="xl:order-1 min-w-0 xl:px-6 pt-3">
            <TodayTimeline subjects={todaySubjects} now={now} assignmentCount={assignmentCount} />
          </div>
        </div>
      )}
    </ChapterFrame>
  );
};
