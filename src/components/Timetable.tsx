/* src/components/Timetable.tsx
 * 時間割。課題ページと同じ考え方で作る:
 *   - 今日の授業はタイムライン（左に時刻、右に1枚ずつのカード）。昼休みや空きコマも表示
 *   - カード右上に状態のバッジ（授業中・次の授業・終了）、終わった授業は薄く
 *   - カードから出席ページ・その科目の課題へ
 *   - 広い画面では右の列に「次の授業」と「今日締切の課題」
 *   - 今日／週の切り替えは文字のボタン
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiExternalLink, FiFileText, FiClock, FiCoffee, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import ChapterFrame, { CENTER_PANEL, PAGE_GRID, SIDE_TITLE, SIDE_WIDGET } from './ChapterFrame';
import { BsQrCodeScan } from 'react-icons/bs';

// QR の読み取り（カメラと jsQR）は、押したときだけ読み込む
const QrScanner = lazy(() => import('./QrScanner'));
import AttendPrompt from './AttendPrompt';
import { readAttendPrompt, type AttendPromptInfo } from '../lib/attendPrompt';
import { applyClassExceptions, type ClassException } from '../lib/classExceptions';
import { useUnifiedAssignments } from '../hooks/useUnifiedAssignments';
import { useAttendance, type AttendanceMap } from '../hooks/useAttendance';
import { absenceAllowance, type AttendanceSummary } from '../lib/attendance';
import { useLmsIssue, type LmsIssue } from '../lib/lmsStatus';
import type { Subject as AssignmentSubject } from '../lib/assignments';
import {
  PERIODS, WEEKDAYS, WEEKDAY_LABELS, formatHm, formatMinutes, focusSubject, minutesLeft,
  nowInJst, periodState, periodTime, subjectTime, weekdayOf, currentPeriodLabel, mondayOf, toYmd,
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
  /** 管理者が調整した開始・終了の時刻（'HH:MM'）。null なら時限の本来の時刻 */
  startTime?: string | null;
  endTime?: string | null;
  /** イレギュラーな授業回: 'cancel' 休講 / 'change' 時刻・教室の変更 / 'extra' 補講（いつもの授業なら空） */
  status?: 'cancel' | 'change' | 'extra';
  /** イレギュラーな授業回のメモ */
  note?: string | null;
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
    <span className={`flex-shrink-0 inline-flex items-center gap-1 h-5 px-2 rounded-full border text-xs font-bold whitespace-nowrap ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} aria-hidden="true" />
      <span className="pill-text">{map.label}</span>
    </span>
  );
}

/** イレギュラーな授業回のしるし（休講・変更・補講） */
function ExceptionBadge({ status, compact = false }: { status: Subject['status']; compact?: boolean }) {
  if (!status) return null;
  const map = {
    cancel: { label: '休講', cls: 'bg-down-soft text-down border-down/40' },
    change: { label: '変更', cls: 'bg-warn-soft text-warn border-warn/40' },
    extra: { label: '補講', cls: 'bg-accent-soft text-accent border-accent/40' },
  }[status];
  return (
    <span className={`flex-shrink-0 inline-flex items-center rounded-full border font-bold whitespace-nowrap ${compact ? 'h-4 px-1.5 text-[10px]' : 'h-5 px-2 text-xs'} ${map.cls}`}>
      <span className="pill-text">{map.label}</span>
    </span>
  );
}

/**
 * 今日の授業を、X のタイムラインのように区切り線で並べる（箱で囲まない）。
 * 左に時刻、右に時限・教室・先生、授業名、出席率と課題。授業中の行は淡く色付けし、終わった授業は薄くする。
 */
function TodayTimeline({ subjects, now, assignmentCount, attendance }: { subjects: Subject[]; now: Date; assignmentCount: (name: string) => number; attendance: AttendanceMap }) {
  // 休講の授業は「授業中・次の授業」の対象にしない
  const focus = focusSubject(subjects.filter(x => x.status !== 'cancel'), now);
  const items = buildTimeline(subjects);

  if (subjects.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <FiCoffee size={28} className="mx-auto text-fg-subtle mb-2" />
        <p className="text-fg-muted text-sm">{weekdayOf(now) ? '今日の授業はありません' : '今日は授業がありません（週の表示で一週間分を確認できます）'}</p>
      </div>
    );
  }

  return (
    <ol className="divide-y divide-line">
      {items.map((item, i) => {
        if (item.kind === 'gap') {
          return (
            <li key={`gap-${i}`} className="px-4 sm:px-5 py-2 bg-bg/50 text-sm text-fg-subtle">
              {item.label}<span className="ml-3 tabular-nums">{item.from}〜{item.to}</span>
            </li>
          );
        }
        const s = item.subject;
        // 時刻は授業ごと（管理者が調整していればその時刻）
        const t = subjectTime(s)!;
        const cancelled = s.status === 'cancel';
        // 休講は「終了」と同じく薄くする
        const state = cancelled ? 'after' : periodState(t, now);
        const isFocus = focus?.subject.id === s.id;
        const badgeState = state === 'current' ? 'current' : state === 'after' ? 'after' : isFocus ? 'next' : 'before';
        const count = assignmentCount(s.name);
        return (
          <li
            key={s.id}
            aria-current={state === 'current' ? 'time' : undefined}
            className={`relative flex gap-4 px-4 sm:px-5 py-4 transition-colors ${
              state === 'current'
                ? 'bg-accent-soft/60 before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-accent'
                : 'hover:bg-surface-2'
            } ${state === 'after' ? 'opacity-55' : ''}`}
          >
            {/* 左: 時刻 */}
            <div className="w-12 flex-shrink-0 text-right tabular-nums">
              <p className="text-base sm:text-lg font-bold leading-none text-fg">{formatHm(t.start)}</p>
              <p className="mt-1 text-xs text-fg-muted">{formatHm(t.end)}</p>
            </div>
            {/* 右: 授業 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-fg-muted min-w-0">
                  <span className="font-semibold text-accent">{s.period}限</span>
                  <span className="mx-1.5 text-fg-subtle">·</span>
                  {s.classroom || '教室未定'}
                  <span className="mx-1.5 text-fg-subtle">·</span>
                  {s.teacher}
                </p>
                <span className="flex-shrink-0 flex items-center gap-1.5">
                  <ExceptionBadge status={s.status} />
                  {!cancelled && <StateBadge state={badgeState} minutes={minutesLeft(t, now)} />}
                </span>
              </div>
              {/* 授業名を押すと出席ページ（なければコースページ）が開く */}
              <a
                href={attendanceUrl(s)}
                target="_blank"
                rel="noopener noreferrer"
                title={s.attendanceId ? '出席ページを開く' : 'コースページを開く'}
                className="mt-1 inline-flex items-start gap-1.5 text-[17px] font-bold text-fg leading-snug break-words hover:text-link hover:underline"
              >
                <span className={cancelled ? 'line-through' : ''}>{s.name}</span>
                <FiExternalLink size={15} className="mt-1 flex-shrink-0 text-fg-subtle" aria-hidden="true" />
              </a>
              {/* イレギュラーな授業回のメモ（例: 第5回の振替） */}
              {s.note && <p className="mt-1 text-sm text-fg-muted">{s.note}</p>}
              {(count > 0 || (s.attendanceId && attendance[s.attendanceId])) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {s.attendanceId && attendance[s.attendanceId] && <AttendanceChip summary={attendance[s.attendanceId]} periodsPerDay={periodsPerDay(subjects, s)} />}
                  {count > 0 && (
                    <Link to="?tab=assignments" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors">
                      <FiFileText size={13} className="text-warn" />
                      <span className="pill-text text-xs font-bold">課題 {count}件</span>
                    </Link>
                  )}
                </div>
              )}
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

function WeekGrid({ weeklySubjects, now, dates }: { weeklySubjects: Record<Day, Subject[]>; now: Date; dates: Record<Day, string> }) {
  const today = weekdayOf(now);
  return (
    <div className="p-2 sm:p-4">
      {/* スマホでも5日分が1画面に収まるよう、最小幅は付けない。科目名は2行まで出し、超える分は「…」で省く（全文はマスの title で見られる） */}
      <div className="grid gap-1 sm:gap-2" style={{ gridTemplateColumns: 'auto repeat(5, minmax(0, 1fr))' }}>
        <div />
        {WEEKDAYS.map(d => (
          <div key={d} className="flex justify-center pb-1">
            <span className={`flex flex-col items-center px-2 sm:px-2.5 py-0.5 rounded-full ${d === today ? 'bg-accent-solid text-on-accent' : 'text-fg-muted'}`}>
              <span className="text-sm font-bold leading-tight">{WEEKDAY_LABELS[d]}</span>
              {/* 日付（休講・補講は日付ごとに変わるため） */}
              <span className="text-[10px] leading-tight tabular-nums opacity-80">{Number(dates[d].slice(5, 7))}/{Number(dates[d].slice(8, 10))}</span>
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
              const st = s ? subjectTime(s) : undefined;
              const cancelled = s?.status === 'cancel';
              const isNow = d === today && !cancelled && !!st && periodState(st, now) === 'current';
              // 本来の時限とずれている授業は、マスに時刻を出す
              const shifted = !!s && (!!s.startTime || !!s.endTime);
              if (!s) return <div key={d} className="min-h-16 rounded-md sm:rounded-lg border border-dashed border-line" />;
              return (
                <a
                  key={d}
                  href={attendanceUrl(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${s.name}（${s.classroom} / ${s.teacher}）`}
                  className={`min-h-16 rounded-md sm:rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 flex flex-col justify-center items-stretch gap-0.5 shadow-sm transition-colors ${
                    // 授業のマスも課題カードと同じ色。休講は薄く
                    isNow ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface-2 dark:bg-slate-700/80 hover:bg-surface-3 dark:hover:bg-slate-700'
                  } ${cancelled ? 'opacity-55' : ''}`}
                >
                  {s.status && <span className="flex justify-center"><ExceptionBadge status={s.status} compact /></span>}
                  <span className={`text-[11px] sm:text-[13px] font-bold text-fg leading-tight line-clamp-2 break-all sm:break-normal text-center ${cancelled ? 'line-through' : ''}`}>{s.name}</span>
                  {shifted && st && <span className="text-[10px] sm:text-[11px] font-semibold text-warn leading-tight text-center tabular-nums">{formatHm(st.start)}〜{formatHm(st.end)}</span>}
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

/** LMS（出席率・コース）を更新できなかったときの控えめなお知らせ。時間割自体は前回の内容で表示を続ける */
function LmsIssueNotice({ issue }: { issue: LmsIssue }) {
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm">
      <p className="text-fg">
        <FiAlertTriangle size={14} className="inline -mt-0.5 mr-1.5 text-warn" aria-hidden="true" />
        {issue === 'expired'
          ? 'LMS のログインが切れたため、出席率とコースを更新できませんでした。'
          : 'LMS に接続できず、出席率とコースを更新できませんでした。'}
      </p>
      {issue === 'expired'
        ? <Link to="/login?relogin=1" className="font-bold text-link hover:underline whitespace-nowrap">再ログイン</Link>
        : <span className="text-fg-muted whitespace-nowrap">次に開いたときにもう一度試します</span>}
    </div>
  );
}

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
  // 授業前の通知の「出席する」（設定で「QR コード」を選んだとき）は ?scan=1 で来るので、すぐ読み取りを始める
  const [searchParams, setSearchParams] = useSearchParams();
  const [scanning, setScanning] = useState(() => searchParams.get('scan') === '1');
  // 通知の本文を押して来たとき（?attend=1）: 出席ページか QR かを選ぶ画面を出す（iPhone は通知にボタンがないため）
  const [attendPrompt, setAttendPrompt] = useState<AttendPromptInfo | null>(() => readAttendPrompt(searchParams));
  useEffect(() => {
    const scan = searchParams.get('scan') === '1';
    const prompt = readAttendPrompt(searchParams);
    if (!scan && !prompt) return;
    if (scan) setScanning(true);
    if (prompt) setAttendPrompt(prompt);
    // 読み取ったら URL から消す（再読み込みで何度も出ないように）
    const next = new URLSearchParams(searchParams);
    for (const k of ['scan', 'attend', 'name', 'period', 'start', 'room', 'link']) next.delete(k);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const closeAttendPrompt = useCallback(() => setAttendPrompt(null), []);
  const closeScanner = useCallback(() => setScanning(false), []);
  // 授業中・次の授業（授業ごとの時刻に従う）
  const focus = focusSubject(subjects, now);
  const s = focus?.subject;
  const t = s ? subjectTime(s) : undefined;
  return (
    <div className="px-4 sm:px-5 py-4">
      <p className={`${SIDE_TITLE} flex items-center gap-1.5`}><FiClock size={16} />{focus?.state === 'current' ? '授業中' : '次の授業'}</p>
      {s && t ? (
        <>
          <p className="mt-2 text-sm text-fg-muted"><span className="font-semibold text-accent mr-2">{s.period}限</span>{s.classroom} · {s.teacher}</p>
          <p className="mt-1 text-lg font-bold text-fg leading-snug">{s.name}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {focus!.state === 'current'
              ? <>{formatHm(t.end)} まで（あと<span className="font-bold text-accent">{formatMinutes(minutesLeft(t, now))}</span>）</>
              : <>{formatHm(t.start)} 開始（あと<span className="font-bold text-warn">{formatMinutes(minutesLeft(t, now))}</span>）</>}
          </p>
          {s.attendanceId && attendance[s.attendanceId] && (
            <div className="mt-2 pt-2 border-t border-line text-sm">
              {/* 出席率と休める回数は 2 行に分け、休める回数を目立たせる */}
              <p className="text-fg-muted">{attendanceLabel(attendance[s.attendanceId])}</p>
              <p className="mt-0.5"><AbsencesLeft summary={attendance[s.attendanceId]} periodsPerDay={periodsPerDay(subjects, s)} /></p>
            </div>
          )}
          {/* 出欠を打てる時間（開始10分前〜授業中）だけ、出席の操作を出す。
              「出席する」は出席ページがある科目のときだけ。「QR を読み取る」は出欠の QR コード用 */}
          {(focus!.state === 'current' || minutesLeft(t, now) <= ATTENDANCE_LEAD_MIN) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {s.attendanceId && (
                <a
                  href={attendanceUrl(s)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent shadow-sm transition-colors"
                >
                  <FiCheckCircle size={15} aria-hidden="true" />
                  <span className="text-sm font-bold">出席する</span>
                  <FiExternalLink size={13} className="opacity-70" aria-hidden="true" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setScanning(true)}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-line-strong text-fg hover:bg-surface-2 transition-colors"
              >
                <BsQrCodeScan size={15} aria-hidden="true" />
                <span className="text-sm font-bold">QR を読み取る</span>
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">{weekdayOf(now) ? (subjects.length ? '今日の授業は終わりました' : '今日の授業はありません') : '今日は授業がありません'}</p>
      )}
      {attendPrompt && <AttendPrompt info={attendPrompt} onScan={() => setScanning(true)} onClose={closeAttendPrompt} />}
      {/* 読み取りの画面（通知から来たときは、授業の表示に関係なく開く） */}
      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onClose={closeScanner} />
        </Suspense>
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
  isProfileSet: boolean;
  weeklySubjects: Record<Day, Subject[]>;
  /** 課題数を出すための科目一覧（課題ページと同じもの） */
  subjects: AssignmentSubject[];
  /** 今週のイレギュラーな授業回（休講・時刻や教室の変更・補講） */
  exceptions?: ClassException[];
}

const NO_EXCEPTIONS: ClassException[] = [];

export const TimetableContainer: React.FC<TimetableContainerProps> = ({
  isWeeklyView, onChangeView, isProfileSet, weeklySubjects: regularWeek, subjects, exceptions = NO_EXCEPTIONS,
}) => {
  const now = useNow();
  const today = weekdayOf(now);
  // 今週（土日は次の週）の各曜日の日付と、その日のイレギュラーな授業回（休講・変更・補講）を当てはめた時間割
  const todayYmd = toYmd(now);
  const weekDates = useMemo(() => {
    const monday = mondayOf(new Date(`${todayYmd}T12:00:00`));
    return Object.fromEntries(WEEKDAYS.map((d, i) => {
      const x = new Date(monday); x.setDate(monday.getDate() + i);
      return [d, toYmd(x)];
    })) as Record<Day, string>;
  }, [todayYmd]);
  const weeklySubjects = useMemo(() => {
    const all = Object.values(regularWeek).flat();
    return Object.fromEntries(WEEKDAYS.map((d) => [d, applyClassExceptions(regularWeek[d] ?? [], exceptions, weekDates[d], d, all)])) as Record<Day, Subject[]>;
  }, [regularWeek, exceptions, weekDates]);
  const todaySubjects = useMemo(() => (today ? weeklySubjects[today] ?? [] : []), [today, weeklySubjects]);
  const { items } = useUnifiedAssignments(subjects);
  const lmsIssue = useLmsIssue();
  // 出席率（LMS の出欠）。1 日 1 回取得し、端末にキャッシュする
  const attendance = useAttendance(useMemo(() => Object.values(weeklySubjects).flat(), [weeklySubjects]));
  const assignmentCount = (name: string) => items.filter(a => !a.done && a.subject_name === name).length;

  const wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  // 今が何限か（1〜6限の授業時間中だけ出す）
  const periodLabel = currentPeriodLabel(now);
  // 列の見出しの補足: 日付・時刻・何限か
  const meta = (
    <span className="text-[15px] font-bold text-fg tabular-nums">
      {now.getMonth() + 1}/{now.getDate()}（{wd}）
      <span className="ml-2 text-fg-muted">{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span>
      {periodLabel && <span className="ml-2 text-accent">{periodLabel}</span>}
    </span>
  );
  // 列の見出しの下線タブ: 今日 / 週
  const tabs = [
    { key: 'today', label: '今日', active: !isWeeklyView, onSelect: () => onChangeView(false) },
    { key: 'week', label: '週', active: isWeeklyView, onSelect: () => onChangeView(true) },
  ];

  if (!isProfileSet) {
    return (
      <ChapterFrame title="時間割" meta={meta}>
        <div className="text-center py-10 px-4">
          {/* LMS のコースから時間割を作れなかったとき（取り込み前・曜日や時限が読み取れないコースだけのときなど） */}
          <h2 className="text-xl font-semibold text-fg mb-2">時間割に出せる授業がありません</h2>
          <p className="text-fg-muted mb-6">設定の「時間割」で、LMS からの取り込みと、各授業の曜日・時限を確認してください。</p>
          <Link to="?tab=setting" className="inline-flex items-center gap-2 bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-bold py-3 px-6 rounded-lg transition-colors">
            <span>設定を開く</span>
            <FiArrowRight />
          </Link>
        </div>
      </ChapterFrame>
    );
  }

  return (
    <ChapterFrame title="時間割" meta={meta} tabs={tabs} bare>
      <div className={PAGE_GRID}>
        {/* 右の列（スマホでは見出しのすぐ下）: 授業中・次の授業。週の表のときは出さない（表を広く使う）。
            通知から来たときの出席の選択・QR の読み取りはこの中で扱うので、消さずに隠すだけにする */}
        <aside className={`${SIDE_WIDGET} ${isWeeklyView ? '!hidden' : ''}`}>
          <NextClassCard subjects={todaySubjects.filter(x => x.status !== 'cancel')} now={now} attendance={attendance} />
        </aside>
        {/* 真ん中の列: 白い 1 枚の面に、今日の授業（区切り線）または週の表 */}
        <div className={CENTER_PANEL}>
          {lmsIssue && <div className="px-3 pt-3"><LmsIssueNotice issue={lmsIssue} /></div>}
          {isWeeklyView ? (
            <WeekGrid weeklySubjects={weeklySubjects} now={now} dates={weekDates} />
          ) : (
            <TodayTimeline subjects={todaySubjects} now={now} assignmentCount={assignmentCount} attendance={attendance} />
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};
