/* src/components/Timetable.tsx
 * 時間割。課題ページと同じ考え方で作る:
 *   - 今日の授業はタイムライン（左に時刻、右に1枚ずつのカード）。昼休みや空きコマも表示
 *   - カード右上に状態のバッジ（授業中・次の授業・終了）、終わった授業は薄く
 *   - カードから出席ページ・その科目の課題へ
 *   - 広い画面では右の列に「次の授業」と「今日締切の課題」
 *   - 今日／週の切り替えは文字のボタン
 */
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Link, useSearchParams } from 'react-router-dom';
import { FiArrowRight, FiExternalLink, FiFileText, FiClock, FiCoffee, FiCheckCircle, FiAlertTriangle, FiMapPin, FiUser, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import ChapterFrame, { CENTER_PANEL, LIST_GROUP, LIST_GROUP_HEADING, PAGE_GRID, SIDE_TITLE, SIDE_WIDGET } from './ChapterFrame';
import { supabase } from '../lib/supabaseClient';
import CourseDetail from './CourseDetail';
import type { UnifiedAssignment as UnifiedAssignmentItem } from '../lib/assignments';
import { BsQrCodeScan } from 'react-icons/bs';
import { TbClockEdit } from 'react-icons/tb';

// QR の読み取り（カメラと jsQR）は、押したときだけ読み込む
const QrScanner = lazy(() => import('./QrScanner'));
import AttendPrompt from './AttendPrompt';
import { AttendForm } from './AttendDialog';
import type { AttendTarget } from '../hooks/useOpenAttendance';
import { isDebugAttend } from '../lib/debugAttend';
import { readAttendPrompt, type AttendPromptInfo } from '../lib/attendPrompt';
import { applyClassExceptions, fetchClassExceptions, type ClassException } from '../lib/classExceptions';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useUnifiedAssignments } from '../hooks/useUnifiedAssignments';
import { useAttendance, type AttendanceMap } from '../hooks/useAttendance';
import { type AttendanceSummary } from '../lib/attendance';
import { useLmsIssue, type LmsIssue } from '../lib/lmsStatus';
import type { Subject as AssignmentSubject } from '../lib/assignments';
import {
  PERIODS, WEEKDAYS, WEEKDAY_LABELS, formatHm, focusSubject, minutesLeft,
  nowInJst, periodState, subjectTime, weekdayOf, currentPeriodLabel, mondayOf, toYmd,
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
  /** イレギュラーな授業回で教室が変わったか */
  roomChanged?: boolean;
  /** イレギュラーな授業回でその日だけ時刻が変わったか（既定値でいつもずれている時刻とは分けて見せる） */
  timeChanged?: boolean;
  /** イレギュラーな授業回で、いつもはない時限に動かしたか */
  periodMoved?: boolean;
};
export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri';

const LMS_BASE = 'https://lms-tokyo.iput.ac.jp';
/** コースのトップページ（授業名・週の表のマスを押したとき） */
const courseUrl = (s: Subject) => `${LMS_BASE}/course/view.php?id=${s.id.split('-')[0]}`;
/** 臨時授業（臨時授業など。LMS のコースではないので id が「x」で始まる） */
const isPersonal = (s: Subject) => s.id.startsWith('x');
/** 出席ページ（なければコースページ）。「出席する」ボタン用。臨時授業は LMS にないので空 */
const attendanceUrl = (s: Subject) =>
  isPersonal(s) ? '' : s.attendanceId ? `${LMS_BASE}/mod/attendance/view.php?id=${s.attendanceId}` : courseUrl(s);
/** 「出席する」で FMS の中から出席を入れるときの対象 */
const attendTargetOf = (s: Subject): AttendTarget => ({
  name: s.name,
  cmid: s.attendanceId!,
  courseId: Number(s.id.split('-')[0]),
  url: attendanceUrl(s),
  subtitle: `${s.period}限${s.classroom ? ` · ${s.classroom}` : ''}`,
});
/** 授業名を押したときに開くページ（コースのトップ）。臨時授業は LMS にないので空 */
const subjectUrl = (s: Subject) => (isPersonal(s) ? '' : courseUrl(s));

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

/** 授業の間に、空き時間（空いた時限・昼休み・休み）を挟んだ並びを作る（実際の時刻で求める） */
function buildTimeline(subjects: Subject[]): TimelineItem[] {
  // 空き時間は、前後の授業の実際の時刻（管理者が調整した時刻・その日の変更を含む）から求める。
  // そのため、まれに 1 限と 2 限の間に昼休みが入るような日でも、その時間が空きとして出る。
  // 授業の間の通常の休み（10 分）より長いときだけ出す
  const toMin = (t: { h: number; m: number }) => t.h * 60 + t.m;
  const hm = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  const LUNCH = { from: 12 * 60 + 25, to: 13 * 60 + 20 };
  const sorted = [...subjects]
    .map((s) => ({ s, t: subjectTime(s) }))
    .filter((x): x is { s: Subject; t: NonNullable<ReturnType<typeof subjectTime>> } => !!x.t)
    .sort((a, b) => toMin(a.t.start) - toMin(b.t.start) || a.s.period - b.s.period);
  const items: TimelineItem[] = [];
  sorted.forEach(({ s, t }, i) => {
    const prev = sorted[i - 1];
    if (prev) {
      const from = toMin(prev.t.end);
      const to = toMin(t.start);
      if (to - from > 10) {
        // 空き時間に丸ごと入る本来の時限と、本来の昼休みと 30 分以上重なるか
        const periods = PERIODS.filter((p) => toMin(p.start) >= from && toMin(p.end) <= to).map((p) => `${p.period}限`);
        const lunch = Math.min(to, LUNCH.to) - Math.max(from, LUNCH.from) >= 30 ? ['昼休み'] : [];
        const label = [...periods, ...lunch].join('・') || '休み';
        items.push({ kind: 'gap', label, from: hm(from), to: hm(to) });
      }
    }
    items.push({ kind: 'class', subject: s });
  });
  return items;
}



/** イレギュラーな授業回のしるし（休講・変更・補講） */
function ExceptionBadge({ status, compact = false, personal = false }: { status: Subject['status']; compact?: boolean; personal?: boolean }) {
  if (!status) return null;
  const map = {
    cancel: { label: '休講', cls: 'bg-down-soft text-down border-down/40' },
    change: { label: '変更', cls: 'bg-warn-soft text-warn border-warn/40' },
    // 休講は赤、補講は青（大学のポータルなどでよく使われる色）
    extra: { label: '補講', cls: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/40' },
  }[status];
  return (
    <span className={`flex-shrink-0 inline-flex items-center rounded-full border font-bold whitespace-nowrap ${compact ? 'h-4 px-1.5 text-[10px]' : 'h-5 px-2 text-xs'} ${map.cls}`}>
      {/* 臨時授業は「臨時」 */}
      <span className="pill-text">{personal && status === 'extra' ? '臨時' : map.label}</span>
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
  // スマホでは右の列（授業中・次の授業）を出さないので、出席の操作はその授業の行に出す。QR は ?scan=1 で読み取りを始める
  const [, setSearchParams] = useSearchParams();
  const startScan = () => setSearchParams((p) => { const n = new URLSearchParams(p); n.set('scan', '1'); return n; });

  if (subjects.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <FiCoffee size={28} className="mx-auto text-fg-subtle mb-2" />
        <p className="text-fg-muted text-sm">{weekdayOf(now) ? '今日の授業はありません' : '今日は授業がありません（週の表示で一週間分を確認できます）'}</p>
      </div>
    );
  }

  // 続く空きコマ・昼休みは 1 行にまとめる（帯を何本も並べない）
  const rows: ({ kind: 'gaps'; gaps: Extract<TimelineItem, { kind: 'gap' }>[] } | Extract<TimelineItem, { kind: 'class' }>)[] = [];
  for (const item of items) {
    const last = rows[rows.length - 1];
    if (item.kind === 'gap') {
      if (last?.kind === 'gaps') last.gaps.push(item);
      else rows.push({ kind: 'gaps', gaps: [item] });
    } else rows.push(item);
  }

  return (
    <ol className="divide-y divide-line">
      {rows.map((row, i) => {
        if (row.kind === 'gaps') {
          // 続く空き時間は 1 つにまとめ、授業と同じ並び（左に時刻）で「空き ○時間○分」と大きめに出す
          const from = row.gaps[0].from;
          const to = row.gaps[row.gaps.length - 1].to;
          const mins = (() => {
            const [fh, fm] = from.split(':').map(Number);
            const [th, tm] = to.split(':').map(Number);
            return th * 60 + tm - (fh * 60 + fm);
          })();
          const length = mins >= 60 ? `${Math.floor(mins / 60)}時間${mins % 60 ? `${mins % 60}分` : ''}` : `${mins}分`;
          return (
            <li key={`gap-${i}`} className="flex gap-4 px-4 sm:px-5 py-2.5">
              <div className="w-12 flex-shrink-0 text-right tabular-nums text-fg-subtle">
                <p className="text-xs leading-none">{from}</p>
                <p className="mt-1 text-xs">{to}</p>
              </div>
              <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-fg-muted">
                <FiCoffee size={14} className="flex-shrink-0 text-fg-subtle" aria-hidden="true" />
                <span className="text-sm font-semibold">空き {length}</span>
                <span className="text-xs text-fg-subtle">{row.gaps.map((g) => g.label).join('・')}</span>
              </div>
            </li>
          );
        }
        const s = row.subject;
        // 時刻は授業ごと（管理者が調整していればその時刻）
        const t = subjectTime(s)!;
        const cancelled = s.status === 'cancel';
        // 休講は「終了」と同じく薄くする
        const state = cancelled ? 'after' : periodState(t, now);
        const isFocus = focus?.subject.id === s.id;
        const left = minutesLeft(t, now);
        const count = assignmentCount(s.name);
        const summary = s.attendanceId ? attendance[s.attendanceId] : undefined;
        // 時刻の色（週の表と同じ 2 色）: その日だけ変わった → オレンジ、そもそも本来の時限と違う → アクセント
        const dayChanged = !!(s.timeChanged || s.periodMoved);
        const timeColor = dayChanged ? 'text-warn' : (s.startTime || s.endTime) ? 'text-accent' : '';
        // 出欠を打てる時間（開始 10 分前〜授業中）
        // 出席の見た目を試しているときは、時刻に関係なく次の授業（授業中の授業）に出す
        const canAttend = isFocus && (state === 'current' || left <= ATTENDANCE_LEAD_MIN || isDebugAttend());
        return (
          <li
            key={s.id}
            // 授業前の通知から来たとき、この行までスクロールする目印
            data-class-period={s.period}
            aria-current={state === 'current' ? 'time' : undefined}
            className={`relative flex gap-4 px-4 sm:px-5 py-3.5 transition-colors ${
              state === 'current'
                ? 'bg-accent-soft/60 before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-accent'
                : cancelled ? 'bg-down-soft/40' : 'hover:bg-surface-2'
            } ${state === 'after' && !cancelled ? 'opacity-55' : ''}`}
          >
            {/* 左: 時刻 */}
            <div className="w-12 flex-shrink-0 text-right tabular-nums pt-0.5">
              <p className={`text-base font-bold leading-none ${timeColor || 'text-fg'}`}>{formatHm(t.start)}</p>
              <p className={`mt-1 text-xs ${timeColor || 'text-fg-muted'}`}>{formatHm(t.end)}</p>
            </div>
            {/* 右: 授業 */}
            <div className="flex-1 min-w-0">
              {/* 1 行目: 授業名（押すとコースのトップ）と、いま注目する授業の残り時間・休講・補講 */}
              <div className="flex items-start justify-between gap-2">
                {subjectUrl(s) ? (
                  <a
                    href={subjectUrl(s)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="コースページを開く"
                    className={`min-w-0 text-base font-bold leading-snug break-words hover:text-link hover:underline ${cancelled ? 'line-through text-fg-subtle' : 'text-fg'}`}
                  >
                    {s.name}
                  </a>
                ) : (
                  // 臨時授業（LMS にないのでリンクなし）
                  <span className="min-w-0 text-base font-bold leading-snug break-words text-fg">{s.name}</span>
                )}
                <span className="flex-shrink-0 flex items-center gap-1.5 pt-0.5">
                  {(s.status === 'cancel' || s.status === 'extra') && <ExceptionBadge status={s.status} personal={isPersonal(s)} />}
                  {!cancelled && state === 'current' && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-accent whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent motion-safe:animate-pulse" aria-hidden="true" />授業中
                    </span>
                  )}
                </span>
              </div>
              {/* 2 行目: 時限・教室・先生・課題（1 行に控えめに） */}
              {/* 2 行目: 情報の種類ごとに色とアイコンを分ける（時限＝アクセントの小さな札、教室＝濃い文字、先生＝灰色、課題＝オレンジ） */}
              <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] ${cancelled ? 'opacity-50' : ''}`}>
                <span className="inline-flex items-center h-5 px-1.5 rounded bg-accent-soft text-accent text-xs font-bold"><span className="pill-text">{s.period}限</span></span>
                <span className={`inline-flex items-center gap-1 ${s.roomChanged ? 'text-warn font-semibold' : 'text-fg font-medium'}`}>
                  <FiMapPin size={12} className={s.roomChanged ? '' : 'text-fg-subtle'} aria-hidden="true" />{s.classroom || '教室未定'}
                </span>
                {s.teacher && (
                  <span className="inline-flex items-center gap-1 text-fg-muted">
                    <FiUser size={12} className="text-fg-subtle" aria-hidden="true" />{s.teacher}
                  </span>
                )}
                {count > 0 && (
                  <Link to="?tab=assignments" className="inline-flex items-center gap-1 font-semibold text-warn hover:underline">
                    <FiFileText size={12} aria-hidden="true" />課題 {count}件
                  </Link>
                )}
              </div>
              {/* イレギュラーな授業回のメモ（例: 第5回の振替） */}
              {s.note && <p className="mt-0.5 text-[13px] text-fg-muted">{s.note}</p>}
              {/* スマホ: 出席の操作（広い画面では右の列にある） */}
              {/* 出席の受け付けが始まると、パスワードの入力バー（QR もその中）がここに出る（1 分ごとに確かめる）。
                  出欠ページのない授業は QR の読み取りだけ */}
              {canAttend && s.attendanceId && <div className="lg:hidden"><AttendForm target={attendTargetOf(s)} inline onScan={startScan} /></div>}
              {canAttend && !s.attendanceId && (
                <div className="mt-2 flex flex-wrap gap-2 lg:hidden">
                  <button type="button" onClick={startScan} className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors">
                    <BsQrCodeScan size={14} aria-hidden="true" />
                    <span className="pill-text text-[13px] font-bold">QR を読み取る</span>
                  </button>
                </div>
              )}
              {/* 出席率（LMS の出欠）。出席の操作（パスワードの入力）があるときは、その下に出す */}
              {summary && (
                <p className="mt-1 inline-flex flex-wrap items-center gap-1 text-xs text-fg-muted" title="LMS の出欠より">
                  <FiCheckCircle size={12} className="text-up" aria-hidden="true" />
                  {summary.percent === null ? '出席の記録なし' : `出席率 ${Math.round(summary.percent)}%（${summary.completed}/${summary.total}回）`}
                </p>
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

/**
 * 週の表のマスを長押ししたときの「ピーク」（iPhone の長押しプレビューと同じ形）。
 * まわりをぼかし、押したマスの位置から授業のカードが大きくなって画面の中ほどに出る。下に操作のメニューを出す。
 * スマホではマスが狭く、名前や教室が「…」で省かれるので、ここで省かずに見せる。外側を押すと、マスに戻るように閉じる
 */
function ClassPeek({ subject: s, date, from, onClose }: { subject: Subject; date: string; from: DOMRect; onClose: () => void }) {
  // 長押しで開いた直後、指を離したときの「押した」が背景に当たって閉じてしまわないよう、開いてすぐの押下は無視する
  const [openedAt] = useState(() => Date.now());
  const onBackdrop = () => { if (Date.now() - openedAt > 500) onClose(); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const t = subjectTime(s);
  const url = subjectUrl(s);
  const dayChanged = !!(s.timeChanged || s.periodMoved);
  const [y, m, d] = date.split('-').map(Number);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];

  // カードの最後の位置（画面の中ほど）と、押したマスの位置からの差（そこから大きくなって出てくる）
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const W = Math.min(340, vw - 32);
  const left = (vw - W) / 2;
  const top = Math.max(24, Math.round(vh * 0.16));
  const estH = 190;
  const fromState = {
    x: from.left + from.width / 2 - (left + W / 2),
    y: from.top + from.height / 2 - (top + estH / 2),
    scale: Math.max(0.2, from.width / W),
    opacity: 0.6,
  };

  return createPortal(
    <div className="fixed inset-0 z-[70]" onClick={onBackdrop}>
      {/* まわりをぼかして暗くする */}
      <motion.div
        className="absolute inset-0 bg-black/25 backdrop-blur-md"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-peek-title"
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'fixed', left, top, width: W }}
        initial={fromState}
        animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
        exit={{ ...fromState, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      >
        {/* 授業のカード */}
        <div className="rounded-2xl bg-surface shadow-2xl px-5 py-4">
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <span className="font-semibold text-fg tabular-nums">{m}/{d}（{wd}）</span>
            <span className="inline-flex items-center h-5 px-1.5 rounded bg-accent-soft text-accent text-xs font-bold"><span className="pill-text">{s.period}限</span></span>
            {(s.status === 'cancel' || s.status === 'extra') && <ExceptionBadge status={s.status} personal={isPersonal(s)} />}
          </p>
          <h2 id="class-peek-title" className={`mt-2 text-lg font-extrabold leading-snug ${s.status === 'cancel' ? 'line-through text-fg-subtle' : 'text-fg'}`}>{s.name}</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-fg-muted">時刻</dt>
            <dd className={`tabular-nums font-semibold ${dayChanged ? 'text-warn' : (s.startTime || s.endTime) ? 'text-accent' : 'text-fg'}`}>
              {t ? `${formatHm(t.start)}〜${formatHm(t.end)}` : '—'}
              {dayChanged && <span className="ml-2 text-xs font-normal">この日だけ変更</span>}
            </dd>
            <dt className="text-fg-muted">教室</dt>
            <dd className={s.roomChanged ? 'text-warn font-semibold' : 'text-fg'}>{s.classroom || '未定'}{s.roomChanged && <span className="ml-2 text-xs font-normal">この日だけ変更</span>}</dd>
            {s.teacher && (<><dt className="text-fg-muted">先生</dt><dd className="text-fg">{s.teacher}</dd></>)}
            {s.note && (<><dt className="text-fg-muted">メモ</dt><dd className="text-fg">{s.note}</dd></>)}
          </dl>
        </div>
        {/* 操作のメニュー（iPhone の長押しメニューと同じく、カードの下に） */}
        {url && (
          <motion.div
            className="mt-2 ml-auto w-60 max-w-full overflow-hidden rounded-xl bg-surface/90 backdrop-blur-xl shadow-xl"
            initial={{ opacity: 0, y: -6, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: 0.06, duration: 0.18 }}
          >
            <a href={url} target="_blank" rel="noopener noreferrer" onClick={onClose} className="flex items-center justify-between gap-3 px-4 py-3 text-fg hover:bg-surface-3 transition-colors">
              <span className="text-[15px]">コースページを開く</span>
              <FiExternalLink size={16} className="text-fg-muted" aria-hidden="true" />
            </a>
            {s.attendanceId && (
              <a href={attendanceUrl(s)} target="_blank" rel="noopener noreferrer" onClick={onClose} className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line text-fg hover:bg-surface-3 transition-colors">
                <span className="text-[15px]">出席ページを開く</span>
                <FiCheckCircle size={16} className="text-fg-muted" aria-hidden="true" />
              </a>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}

/** 長押しとみなす時間（ミリ秒） */
const LONG_PRESS_MS = 450;

function WeekGrid({ weeklySubjects, now, dates, isCurrentWeek = true }: { weeklySubjects: Record<Day, Subject[]>; now: Date; dates: Record<Day, string>; isCurrentWeek?: boolean }) {
  // 今日の強調と「授業中」は、今週を見ているときだけ
  const today = isCurrentWeek ? weekdayOf(now) : null;
  // 長押しで開いた授業（押したマスの位置から大きくなって出る）
  const [detail, setDetail] = useState<{ subject: Subject; date: string; from: DOMRect } | null>(null);
  // 押している間のマス（iPhone と同じく、押し続けると少し縮む）
  const [pressing, setPressing] = useState<string | null>(null);
  // 長押し: 押し続けたら詳しい内容を出し、そのあとの「押した」（LMS を開く）は止める。指が動いたら（スクロール）やめる
  const pressRef = React.useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const pressHandlers = (s: Subject, date: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      setPressing(s.id);
      const timer = window.setTimeout(() => {
        if (pressRef.current) pressRef.current.fired = true;
        setPressing(null);
        // Android では短く震わせる（iPhone のブラウザでは震わせられない）
        navigator.vibrate?.(10);
        setDetail({ subject: s, date, from: el.getBoundingClientRect() });
      }, LONG_PRESS_MS);
      pressRef.current = { timer, x: e.clientX, y: e.clientY, fired: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const p = pressRef.current;
      if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { clearTimeout(p.timer); pressRef.current = null; setPressing(null); }
    },
    onPointerUp: () => { if (pressRef.current && !pressRef.current.fired) clearTimeout(pressRef.current.timer); setPressing(null); },
    onPointerCancel: () => { if (pressRef.current) clearTimeout(pressRef.current.timer); pressRef.current = null; setPressing(null); },
    onClick: (e: React.MouseEvent) => {
      // 長押しのあとの「押した」は、LMS を開かない
      if (pressRef.current?.fired) { e.preventDefault(); pressRef.current = null; }
    },
    // スマホのリンクの長押しメニュー（プレビュー）を出さない
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
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
              // 授業の変更（時限・時刻・教室）はしるしを付けず、変わったところだけをオレンジで出す
              const changed = s?.status === 'change';
              const badge = s?.status === 'change' ? undefined : s?.status;
              // その日だけ時刻が変わった・時限を動かしたときは、時刻をオレンジで出す（時限を動かしただけでも、変わったと分かるように）
              const timeDiff = !!s && (!!s.timeChanged || !!s.periodMoved);
              if (!s) return <div key={d} className="min-h-16 rounded-md sm:rounded-lg border border-dashed border-line" />;
              return (
                <a
                  key={d}
                  {...pressHandlers(s, dates[d])}
                  // 臨時授業は LMS にないのでリンクにしない
                  href={subjectUrl(s) || undefined}
                  target={subjectUrl(s) ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  title={`${s.name}（${s.classroom} / ${s.teacher}）${changed ? `・この日は変更あり${s.note ? `（${s.note}）` : ''}` : ''}`}
                  // 長押しで詳しい内容を出すので、文字の選択と iPhone のリンクの長押しメニューを止める
                  style={{ WebkitTouchCallout: 'none', transform: pressing === s.id ? 'scale(0.94)' : undefined, transition: 'transform 0.35s ease-out, background-color 0.15s' }}
                  className={`select-none min-h-16 rounded-md sm:rounded-lg px-1 sm:px-2 py-1 sm:py-1.5 flex flex-col justify-center items-stretch gap-0.5 shadow-sm transition-colors ${
                    // 授業のマスも課題カードと同じ色。休講は薄く
                    isNow ? 'bg-accent-soft ring-2 ring-accent' : 'bg-surface-2 dark:bg-slate-700/80 hover:bg-surface-3 dark:hover:bg-slate-700'
                  } ${cancelled ? 'opacity-55' : ''}`}
                >
                  {/* いちばん上: 休講・補講のしるしと、本来の時限とずれている授業の時刻（同じ行に並べて段を増やさない）。
                      時刻はスマホでは開始だけ、広い画面では開始〜終了 */}
                  {(badge || ((shifted || timeDiff) && st)) && (
                    <span className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
                      {badge && <ExceptionBadge status={badge} compact personal={isPersonal(s)} />}
                      {(shifted || timeDiff) && st && (
                        // 2 色で塗り分ける: そもそも本来の時限と時刻が違う授業（既定値）はアクセントの色＋時計、
                        // その日だけ変更のあった授業はオレンジ＋「時計に鉛筆」（大学のポータルなどと同じく「変更＝注意」の色）
                        <span className={`inline-flex items-center gap-0.5 text-[10px] sm:text-[11px] font-semibold leading-tight tabular-nums ${timeDiff ? 'text-warn' : 'text-accent'}`}>
                          {timeDiff
                            ? <TbClockEdit size={12} aria-label="この日だけ時刻が変更" className="flex-shrink-0" />
                            : <FiClock size={10} aria-label="本来の時限と時刻が違う授業" className="flex-shrink-0" />}
                          {formatHm(st.start)}〜<span className="hidden sm:inline">{formatHm(st.end)}</span>
                        </span>
                      )}
                    </span>
                  )}
                  <span className={`text-[11px] sm:text-[13px] font-bold text-fg leading-tight line-clamp-2 break-all sm:break-normal text-center ${cancelled ? 'line-through' : ''}`}>{s.name}</span>
                  {/* 教室と先生を左右半分ずつ（それぞれ中央揃え）。収まらない分は「…」で省く（全文はマスの title で見られる） */}
                  <span className="grid grid-cols-2 gap-1 text-[10px] sm:text-[11px] text-fg-muted leading-tight">
                    <span className={`truncate text-center ${s.roomChanged ? 'text-warn font-semibold' : ''}`}>{s.classroom}</span>
                    <span className="truncate text-center">{s.teacher}</span>
                  </span>
                </a>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <p className="mt-2 text-xs text-fg-subtle text-center">授業を長押しすると、詳しい内容が見られます</p>
      <AnimatePresence>
        {detail && <ClassPeek key={detail.subject.id} subject={detail.subject} date={detail.date} from={detail.from} onClose={() => setDetail(null)} />}
      </AnimatePresence>
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

// ------------------------------------------------------------------
// 右の列: 授業中・次の授業
// ------------------------------------------------------------------

/** 通知から来たときに、その授業の行を少しのあいだ目立たせる枠 */
const ARRIVAL_HIGHLIGHT = ['ring-2', 'ring-inset', 'ring-accent'];

function NextClassCard({ subjects, now, attendance, onShowToday }: { subjects: Subject[]; now: Date; attendance: AttendanceMap; onShowToday: () => void }) {
  // 授業前の通知の「出席する」（設定で「QR コード」を選んだとき）は ?scan=1 で来るので、すぐ読み取りを始める
  const [searchParams, setSearchParams] = useSearchParams();
  const [scanning, setScanning] = useState(() => searchParams.get('scan') === '1');
  // 通知の本文を押して来たとき（?attend=1）: 時間割の「今日」で、その授業の行（パスワード欄のあるところ）まで
  // スクロールして少しのあいだ目立たせる。その授業が今日の時間割に見つからないときだけ、出席のしかたを選ぶ画面を出す
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
  const promptPeriod = attendPrompt ? Number(attendPrompt.period) : null;
  const promptFound = promptPeriod !== null && subjects.some((x) => x.period === promptPeriod);
  useEffect(() => {
    if (!attendPrompt || !promptFound) return;
    onShowToday();
    // 「今日」の表示が出てから、その行（広い画面では右の「授業中・次の授業」の欄）へ動かす
    const timer = window.setTimeout(() => {
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      const el = document.querySelector<HTMLElement>(wide ? '[data-attend-card]' : `[data-class-period="${promptPeriod}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add(...ARRIVAL_HIGHLIGHT);
        window.setTimeout(() => el.classList.remove(...ARRIVAL_HIGHLIGHT), 2500);
      }
      setAttendPrompt(null);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [attendPrompt, promptFound, promptPeriod, onShowToday]);
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
              ? <>{formatHm(t.end)} まで</>
              : <>{formatHm(t.start)} 開始</>}
          </p>
          {/* 出欠を打てる時間（開始10分前〜授業中）だけ、出席の操作を出す。
              出席の受け付けが始まると、パスワードの入力バー（QR もその中）がそのまま出る（1 分ごとに確かめる）。出欠ページのない授業は QR だけ */}
          {/* 区切りの線は出席の操作（パスワード欄）の上。出席率は線を付けず、その下に続ける */}
          {(focus!.state === 'current' || minutesLeft(t, now) <= ATTENDANCE_LEAD_MIN || isDebugAttend()) && s.attendanceId && (
            <div className="mt-3 pt-1 border-t border-line">
              <AttendForm target={attendTargetOf(s)} inline onScan={() => setScanning(true)} />
            </div>
          )}
          {(focus!.state === 'current' || minutesLeft(t, now) <= ATTENDANCE_LEAD_MIN) && !s.attendanceId && (
            <div className="mt-3 flex flex-wrap gap-2">
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
          {/* 出席率（パスワードの入力欄の下）。出席の操作がない時間は、ここに区切りの線を付ける */}
          {s.attendanceId && attendance[s.attendanceId] && (
            <div className={`text-sm ${focus!.state === 'current' || minutesLeft(t, now) <= ATTENDANCE_LEAD_MIN || isDebugAttend() ? 'mt-1.5' : 'mt-3 pt-2 border-t border-line'}`}>
              <p className="text-fg-muted">{attendanceLabel(attendance[s.attendanceId])}</p>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-fg-muted">{weekdayOf(now) ? (subjects.length ? '今日の授業は終わりました' : '今日の授業はありません') : '今日は授業がありません'}</p>
      )}
      {/* 通知の授業が今日の時間割に見つからないとき（時間割の読み込み後）だけ、出席のしかたを選ぶ画面を出す */}
      {attendPrompt && subjects.length > 0 && !promptFound && <AttendPrompt info={attendPrompt} onScan={() => setScanning(true)} onClose={closeAttendPrompt} />}
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

// ------------------------------------------------------------------
// コース（Open LMS のアプリの「マイコース」と同じく、今学期の自分のコースの一覧）
// ------------------------------------------------------------------

/** 「コース」タブ（マイコース）を出すか。作ってあるが、まだ出さない（使うときは true にする） */
const SHOW_COURSES_TAB = false;

type MyCourse = { course_id: number; name: string; fullname: string; attendance_id: number | null };

/**
 * 今学期の自分のコース（LMS から取り込んだもの）。時間割に出る授業は曜日・時限の順に、
 * それ以外（お知らせ用など授業ではないコース・時間割に出さないコース）は「その他のコース」にまとめる。
 * 押すと、FMS の中でコースの内容（課題・お知らせ・資料）を見る画面を開く
 */
function CourseList({ weeklySubjects, attendance, assignmentCount, assignments }: { weeklySubjects: Record<Day, Subject[]>; attendance: AttendanceMap; assignmentCount: (name: string) => number; assignments: UnifiedAssignmentItem[] }) {
  const user = useCurrentUser();
  // 開いているコース（FMS の中でコースの内容を見る）
  const [opened, setOpened] = useState<MyCourse | null>(null);
  const { data: courses, isLoading } = useQuery({
    queryKey: ['myCourses', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('user_lms_courses').select('course_id, name, fullname, attendance_id').eq('user_id', user!.id).order('name');
      if (error) throw error;
      return (data ?? []) as MyCourse[];
    },
  });

  // コースごとの曜日・時限（例: 月 1・2限 / 木 3限）と、並べる順（最初の曜日・時限）
  const slots = useMemo(() => {
    const map = new Map<number, { text: string[]; order: number }>();
    WEEKDAYS.forEach((d, di) => {
      const byCourse = new Map<number, number[]>();
      for (const s of weeklySubjects[d] ?? []) {
        const id = Number(s.id.split('-')[0]);
        byCourse.set(id, [...(byCourse.get(id) ?? []), s.period]);
      }
      for (const [id, periods] of byCourse) {
        const sorted = periods.sort((a, b) => a - b);
        const cur = map.get(id) ?? { text: [], order: di * 10 + sorted[0] };
        cur.text.push(`${WEEKDAY_LABELS[d]} ${sorted.join('・')}限`);
        map.set(id, cur);
      }
    });
    return map;
  }, [weeklySubjects]);

  if (isLoading || !courses) return <p className="px-5 py-10 text-center text-sm text-fg-muted">読み込み中...</p>;
  if (courses.length === 0) return <p className="px-5 py-10 text-center text-sm text-fg-muted">LMS のコースがまだ取り込まれていません。</p>;

  if (opened) {
    const slot = slots.get(opened.course_id);
    return (
      <CourseDetail
        course={{ course_id: opened.course_id, name: opened.name, slot: slot?.text.join(' / '), attendance: opened.attendance_id ? attendance[opened.attendance_id] : undefined }}
        assignments={assignments.filter((a) => a.subject_name === opened.name)}
        onBack={() => setOpened(null)}
      />
    );
  }

  const inTimetable = courses.filter((c) => slots.has(c.course_id)).sort((a, b) => slots.get(a.course_id)!.order - slots.get(b.course_id)!.order);
  const others = courses.filter((c) => !slots.has(c.course_id));

  const row = (c: MyCourse) => {
    const slot = slots.get(c.course_id);
    const summary = c.attendance_id ? attendance[c.attendance_id] : undefined;
    const count = assignmentCount(c.name);
    return (
      <li key={c.course_id}>
        <button
          type="button"
          onClick={() => { setOpened(c); document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0 }); }}
          className="w-full text-left flex items-start gap-3 px-4 sm:px-5 py-3.5 hover:bg-surface-2 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-fg leading-snug break-words">{c.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
              {slot && <span className="inline-flex items-center h-5 px-1.5 rounded bg-accent-soft text-accent text-xs font-bold"><span className="pill-text">{slot.text.join(' / ')}</span></span>}
              {summary && summary.percent !== null && (
                <span className="inline-flex items-center gap-1"><FiCheckCircle size={12} className="text-up" aria-hidden="true" />出席率 {Math.round(summary.percent)}%</span>
              )}
              {count > 0 && <span className="inline-flex items-center gap-1 font-semibold text-warn"><FiFileText size={12} aria-hidden="true" />課題 {count}件</span>}
            </div>
          </div>
          <FiChevronRight size={18} className="mt-1 flex-shrink-0 text-fg-subtle" aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <div>
      {inTimetable.length > 0 && (
        <section className={LIST_GROUP}>
          <h3 className={LIST_GROUP_HEADING}>時間割の授業<span className="text-sm font-normal text-fg-muted">{inTimetable.length}件</span></h3>
          <ul className="divide-y divide-line">{inTimetable.map(row)}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section className={LIST_GROUP}>
          <h3 className={LIST_GROUP_HEADING}>その他のコース<span className="text-sm font-normal text-fg-muted">{others.length}件</span></h3>
          <ul className="divide-y divide-line">{others.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

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

  // 「コース」タブを開いているか
  const [showCourses, setShowCourses] = useState(false);
  // 通知から来たときに「今日」を出す
  const showToday = useCallback(() => { setShowCourses(false); onChangeView(false); }, [onChangeView]);
  // 週の表で見ている週（0 = 今週、1 = 次の週…）。今日・次の授業はいつも今週
  const [weekOffset, setWeekOffset] = useState(0);
  const shownDates = useMemo(() => {
    if (weekOffset === 0) return weekDates;
    const monday = mondayOf(new Date(`${todayYmd}T12:00:00`));
    monday.setDate(monday.getDate() + weekOffset * 7);
    return Object.fromEntries(WEEKDAYS.map((d, i) => {
      const x = new Date(monday); x.setDate(monday.getDate() + i);
      return [d, toYmd(x)];
    })) as Record<Day, string>;
  }, [weekOffset, weekDates, todayYmd]);
  // 今週以外の週の授業の変更・臨時授業は、その週を開いたときに読む
  const user = useCurrentUser();
  const otherWeek = useQuery({
    queryKey: ['classExceptions', shownDates.Mon, shownDates.Fri],
    queryFn: () => fetchClassExceptions(user!.id, shownDates.Mon, shownDates.Fri),
    enabled: weekOffset !== 0 && !!user,
    staleTime: 5 * 60 * 1000,
  });
  const shownWeek = useMemo(() => {
    if (weekOffset === 0) return weeklySubjects;
    const all = Object.values(regularWeek).flat();
    const ex = otherWeek.data ?? NO_EXCEPTIONS;
    return Object.fromEntries(WEEKDAYS.map((d) => [d, applyClassExceptions(regularWeek[d] ?? [], ex, shownDates[d], d, all)])) as Record<Day, Subject[]>;
  }, [weekOffset, weeklySubjects, regularWeek, otherWeek.data, shownDates]);
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
  // 列の見出しの下線タブ: 今日 / 週 / コース（Open LMS のアプリの「マイコース」にあたる、今学期のコースの一覧）
  const tabs = [
    { key: 'today', label: '今日', active: !isWeeklyView && !showCourses, onSelect: () => { setShowCourses(false); onChangeView(false); } },
    { key: 'week', label: '週', active: isWeeklyView && !showCourses, onSelect: () => { setShowCourses(false); onChangeView(true); } },
    ...(SHOW_COURSES_TAB ? [{ key: 'courses', label: 'コース', active: showCourses, onSelect: () => setShowCourses(true) }] : []),
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
        <aside data-attend-card className={`${SIDE_WIDGET} ${isWeeklyView || showCourses ? '!hidden' : 'hidden lg:block'}`}>
          <NextClassCard subjects={todaySubjects.filter(x => x.status !== 'cancel')} now={now} attendance={attendance} onShowToday={showToday} />
        </aside>
        {/* 真ん中の列: 白い 1 枚の面に、今日の授業（区切り線）または週の表 */}
        <div className={CENTER_PANEL}>
          {lmsIssue && <div className="px-3 pt-3"><LmsIssueNotice issue={lmsIssue} /></div>}
          {showCourses ? (
            <CourseList weeklySubjects={regularWeek} attendance={attendance} assignmentCount={assignmentCount} assignments={items} />
          ) : isWeeklyView ? (
            <>
              {/* 週の切り替え（前の週・次の週・今週） */}
              <div className="flex items-center justify-between gap-2 px-2 sm:px-4 pt-2 sm:pt-3">
                {/* 今週より前には戻らない（課題のカレンダーと同じ） */}
                <button type="button" onClick={() => setWeekOffset((w) => Math.max(0, w - 1))} disabled={weekOffset <= 0} aria-label="前の週" className="w-9 h-9 rounded-full flex items-center justify-center text-fg hover:bg-surface-3 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default"><FiChevronLeft size={20} /></button>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-bold text-fg tabular-nums">
                    {Number(shownDates.Mon.slice(5, 7))}/{Number(shownDates.Mon.slice(8, 10))}〜{Number(shownDates.Fri.slice(5, 7))}/{Number(shownDates.Fri.slice(8, 10))}
                  </p>
                  <button
                    type="button"
                    onClick={() => setWeekOffset(0)}
                    disabled={weekOffset === 0}
                    aria-label={weekOffset === 0 ? '今週を表示中' : '今週に戻る'}
                    className="inline-flex items-center h-7 px-3 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
                  >
                    <span className="pill-text text-xs font-bold">今週</span>
                  </button>
                </div>
                <button type="button" onClick={() => setWeekOffset((w) => w + 1)} aria-label="次の週" className="w-9 h-9 rounded-full flex items-center justify-center text-fg hover:bg-surface-3 transition-colors"><FiChevronRight size={20} /></button>
              </div>
              <WeekGrid weeklySubjects={shownWeek} now={now} dates={shownDates} isCurrentWeek={weekOffset === 0} />
            </>
          ) : (
            <TodayTimeline subjects={todaySubjects} now={now} assignmentCount={assignmentCount} attendance={attendance} />
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};
