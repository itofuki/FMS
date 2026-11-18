/* src/components/StudyRoom.tsx
 * 自習室・談話室。課題ページと同じ考え方で作る:
 *   - 1日分（1〜6限 × 自習室・談話室）の一覧表。今の時限を強調し、終わった時限は薄く
 *   - 曜日のボタンでほかの日も見られる（土日は次の週を表示）
 *   - 右の列（広い画面）に「今使える部屋」（時間外は次に開く部屋）と、掲載期間・元の PDF へのリンク
 *   - PDF の大きな埋め込み表示はやめ、リンクにする
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FiExternalLink, FiCalendar, FiMapPin } from 'react-icons/fi';
import ChapterFrame, { CENTER_PANEL, PAGE_GRID, SIDE_TITLE, SIDE_WIDGET } from './ChapterFrame';
import { SkeletonBar, TableSkeleton } from './Skeleton';
import { supabase } from '../lib/supabaseClient';
import {
  PERIODS, WEEKDAYS, WEEKDAY_LABELS, formatHm, formatMinutes, mondayOf, nowInJst,
  toYmd, weekdayOf, type PeriodState, type Weekday,
} from '../lib/schedule';

// 自習室・談話室の時間枠。授業の時限と同じだが、6限の枠は閉館の 21:30 まで使える（表示も「6限～」）
const ROOM_SLOTS = PERIODS.map(p => (p.period === 6 ? { ...p, end: { h: 21, m: 30 }, label: '6限～' } : { ...p, label: `${p.period}限` }));
const slotOf = (period: number) => ROOM_SLOTS[period - 1];
const toMin = (t: { h: number; m: number }) => t.h * 60 + t.m;
const nowMin = (now: Date) => now.getHours() * 60 + now.getMinutes();
/** その枠が、今から見て「これから / 使用中 / 終了」のどれか（6限の枠は 21:30 まで） */
const slotState = (period: number, now: Date): PeriodState => {
  const s = slotOf(period);
  const n = nowMin(now);
  return n < toMin(s.start) ? 'before' : n < toMin(s.end) ? 'current' : 'after';
};
/** 開始まで（これから）または終了まで（使用中）の残り分 */
const slotMinutesLeft = (period: number, now: Date) => {
  const s = slotOf(period);
  const n = nowMin(now);
  return Math.max(0, slotState(period, now) === 'before' ? toMin(s.start) - n : toMin(s.end) - n);
};

type DayRooms = { study: string[]; talk: string[] };

const isOpen = (room: string | undefined) => !!room && room !== '-' && room !== 'ー' && room.trim() !== '';

function useNow() {
  const [now, setNow] = useState(nowInJst);
  useEffect(() => {
    const t = window.setInterval(() => setNow(nowInJst()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const StudyRoom = () => {
  const now = useNow();
  const todayKey = weekdayOf(now);
  const monday = useMemo(() => mondayOf(now), [now]);
  const dateOf = (d: Weekday) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + WEEKDAYS.indexOf(d));
    return x;
  };
  const [selected, setSelected] = useState<Weekday>(todayKey ?? 'Mon');
  const isTodaySelected = selected === todayKey;

  // その週（月〜金）の部屋の割り当て
  const weekStart = toYmd(monday);
  const weekEnd = toYmd(dateOf('Fri'));
  const { data: week, isLoading } = useQuery({
    queryKey: ['roomSchedulesWeek', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('room_schedules')
        .select('target_date, study_rooms, talk_rooms')
        .gte('target_date', weekStart)
        .lte('target_date', weekEnd);
      if (error) throw error;
      const map: Record<string, DayRooms> = {};
      for (const row of data ?? []) {
        map[row.target_date] = { study: row.study_rooms ?? [], talk: row.talk_rooms ?? [] };
      }
      return map;
    },
    staleTime: 1000 * 60 * 60,
  });

  // 掲載期間と元の PDF
  const { data: meta } = useQuery({
    queryKey: ['studyRoomMeta', toYmd(now)],
    queryFn: async () => {
      const today = toYmd(now);
      const { data, error } = await supabase
        .from('schedule_metadata')
        .select('filename, start_date, end_date')
        .lte('start_date', today)
        .gte('end_date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      const { data: url } = supabase.storage.from('images').getPublicUrl(`studyroom/${data.filename}`);
      return { url: url.publicUrl, start: data.start_date as string, end: data.end_date as string };
    },
    staleTime: 1000 * 60 * 55,
  });

  const rooms = week?.[toYmd(dateOf(selected))];
  const todayRooms = todayKey ? week?.[toYmd(dateOf(todayKey))] : undefined;

  // 今使える部屋（授業中の時限、なければ次に開く時限）
  const openPeriods = todayRooms
    ? ROOM_SLOTS.map(p => p.period).filter(p => isOpen(todayRooms.study[p - 1]) || isOpen(todayRooms.talk[p - 1]))
    : [];
  const current = openPeriods.find(p => slotState(p, now) === 'current');
  const next = openPeriods.find(p => slotState(p, now) === 'before');
  const focus = current ?? next;

  // 見出しの「何限」も自習室の枠で数える（19:50〜21:30 は「6限～」）
  const periodLabel = weekdayOf(now) ? ROOM_SLOTS.find(p => slotState(p.period, now) === 'current')?.label ?? null : null;
  const fmtDate = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}`; };

  // 列の見出しの下線タブ: 曜日（今日の曜日には小さな点）
  const dayTabs = WEEKDAYS.map(d => ({
    key: d,
    label: <span className="relative">{WEEKDAY_LABELS[d]}{d === todayKey && <span className="absolute -right-2 top-0 w-1.5 h-1.5 rounded-full bg-accent" aria-label="今日" />}</span>,
    active: selected === d,
    onSelect: () => setSelected(d),
  }));
  // 列の見出しの補足: 表示中の日付（今日なら時刻と何限かも）
  const headerMeta = (
    <span className="text-[15px] font-bold text-fg tabular-nums whitespace-nowrap">
      {fmtDate(toYmd(dateOf(selected)))}（{WEEKDAY_LABELS[selected]}）
      {isTodaySelected && <span className="ml-2 text-fg-muted">{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span>}
      {isTodaySelected && periodLabel && <span className="ml-2 text-accent">{periodLabel}</span>}
    </span>
  );

  return (
    <ChapterFrame title="自習室" meta={headerMeta} tabs={dayTabs} bare>
      <div className={PAGE_GRID}>
        {/* 右の列: 今使える部屋・掲載期間と PDF */}
        <aside className={SIDE_WIDGET}>
          <div className="px-4 sm:px-5 py-4 border-b border-line">
            <p className={`${SIDE_TITLE} flex items-center gap-1.5`}><FiMapPin size={16} />{current ? '今使える部屋' : '次に開く部屋'}</p>
            {isLoading ? (
              <div className="mt-3 space-y-2" aria-label="読み込み中"><SkeletonBar className="h-3 w-24" /><SkeletonBar className="h-6 w-32" /><SkeletonBar className="h-6 w-32" /></div>
            ) : todayRooms && focus ? (
              <>
                <p className="mt-2 text-sm text-fg-muted">
                  <span className="font-semibold text-accent mr-2">{slotOf(focus).label}</span>
                  {current
                    ? <>{formatHm(slotOf(focus).end)} まで（あと{formatMinutes(slotMinutesLeft(focus, now))}）</>
                    : <>{formatHm(slotOf(focus).start)} から（あと{formatMinutes(slotMinutesLeft(focus, now))}）</>}
                </p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 items-baseline">
                  <dt className="text-sm text-fg-muted">自習室</dt>
                  <dd className={`text-xl font-bold ${isOpen(todayRooms.study[focus - 1]) ? 'text-fg' : 'text-fg-subtle'}`}>{isOpen(todayRooms.study[focus - 1]) ? todayRooms.study[focus - 1] : '閉室'}</dd>
                  <dt className="text-sm text-fg-muted">談話室</dt>
                  <dd className={`text-xl font-bold ${isOpen(todayRooms.talk[focus - 1]) ? 'text-fg' : 'text-fg-subtle'}`}>{isOpen(todayRooms.talk[focus - 1]) ? todayRooms.talk[focus - 1] : '閉室'}</dd>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm text-fg-muted">
                {!todayKey ? '今日は開放がありません（平日のみ）' : todayRooms ? '本日の開放は終了しました' : '今日の情報はまだありません'}
              </p>
            )}
          </div>
          <div className="px-4 sm:px-5 py-4">
            <p className={`${SIDE_TITLE} flex items-center gap-1.5`}><FiCalendar size={16} />掲載期間</p>
            {meta ? (
              <>
                <p className="mt-1.5 text-sm text-fg">{fmtDate(meta.start)} 〜 {fmtDate(meta.end)}</p>
                <a href={meta.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
                  元の時間割 PDF を開く <FiExternalLink size={13} />
                </a>
              </>
            ) : (
              <p className="mt-1.5 text-sm text-fg-muted">今週のスケジュールはまだありません</p>
            )}
          </div>
        </aside>

        {/* 左: 1日分の一覧表 */}
        {/* 真ん中の列: 白い 1 枚の面に、選んだ曜日の表 */}
        <div className={CENTER_PANEL}>
          <div>
            {isLoading ? (
              <TableSkeleton />
            ) : !rooms ? (
              <p className="text-center py-12 px-4 text-sm text-fg-muted">この日の情報はありません</p>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-surface-2 text-sm text-fg-muted">
                  <tr>
                    <th scope="col" className="px-4 sm:px-5 py-2.5 font-semibold w-24 sm:w-32">時限</th>
                    <th scope="col" className="px-3 sm:px-5 py-2.5 font-semibold">自習室</th>
                    <th scope="col" className="px-3 sm:px-5 py-2.5 font-semibold">談話室</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ROOM_SLOTS.map(p => {
                    const state = isTodaySelected ? slotState(p.period, now) : 'before';
                    const study = rooms.study[p.period - 1];
                    const talk = rooms.talk[p.period - 1];
                    return (
                      <tr
                        key={p.period}
                        aria-current={state === 'current' ? 'time' : undefined}
                        className={`${state === 'current' ? 'bg-accent-soft' : ''} ${state === 'after' ? 'opacity-50' : ''}`}
                      >
                        <th scope="row" className={`relative px-4 sm:px-5 py-3 font-normal ${state === 'current' ? 'before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-accent' : ''}`}>
                          <span className="block text-[15px] font-bold text-fg">{p.label}</span>
                          <span className="block text-xs text-fg-muted">{formatHm(p.start)}〜{formatHm(p.end)}</span>
                        </th>
                        <td className="px-3 sm:px-5 py-3">
                          {isOpen(study) ? <span className="text-[15px] sm:text-base font-semibold text-fg">{study}</span> : <span className="text-sm text-fg-subtle">閉室</span>}
                        </td>
                        <td className="px-3 sm:px-5 py-3">
                          {isOpen(talk) ? <span className="text-[15px] sm:text-base font-semibold text-fg">{talk}</span> : <span className="text-sm text-fg-subtle">閉室</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {isTodaySelected && rooms && (
            <p className="px-4 sm:px-5 py-3 text-xs text-fg-subtle border-t border-line">今の時限は色付き、終わった時限は薄く表示しています。</p>
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};

export default StudyRoom;
