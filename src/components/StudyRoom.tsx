/* src/components/StudyRoom.tsx
 * 自習室・談話室。課題ページと同じ考え方で作る:
 *   - 1日分（1〜6限 × 自習室・談話室）の一覧表。今の時限を強調し、終わった時限は薄く
 *   - 曜日のボタン（月〜土）でほかの日も見られる（日曜は次の週を表示）
 *   - 右の列（広い画面）に「今使える部屋」（時間外は次に開く部屋）と、元の時間割 PDF へのリンク
 *   - PDF の大きな埋め込み表示はやめ、リンクにする
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FiExternalLink, FiMapPin } from 'react-icons/fi';
import ChapterFrame, { CENTER_PANEL, PAGE_GRID, SIDE_TITLE, SIDE_WIDGET } from './ChapterFrame';
import { SkeletonBar, TableSkeleton } from './Skeleton';
import { supabase } from '../lib/supabaseClient';
import {
  PERIODS, WEEKDAYS, WEEKDAY_LABELS, formatHm, formatMinutes, mondayOf, nowInJst,
  toYmd, type PeriodState,
} from '../lib/schedule';

// 自習室は土曜も開くので、授業の曜日（月〜金）に土曜を足す
const DAYS = [...WEEKDAYS, 'Sat'] as const;
type Day = (typeof DAYS)[number];
const DAY_LABELS: Record<Day, string> = { ...WEEKDAY_LABELS, Sat: '土' };
/** 今日の曜日（月〜土）。日曜は null */
const dayOf = (d: Date): Day | null => (d.getDay() === 0 ? null : DAYS[d.getDay() - 1]);
/** 表示する週の月曜。土曜はその週（今日を見られるように）、日曜は次の週 */
const weekMondayOf = (d: Date): Date => {
  if (d.getDay() !== 6) return mondayOf(d);
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - 5);
  return x;
};

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
  const todayKey = dayOf(now);
  const monday = useMemo(() => weekMondayOf(now), [now]);
  const dateOf = (d: Day) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + DAYS.indexOf(d));
    return x;
  };
  const [selected, setSelected] = useState<Day>(todayKey ?? 'Mon');
  const isTodaySelected = selected === todayKey;

  // その週（月〜土）の部屋の割り当て
  const weekStart = toYmd(monday);
  const weekEnd = toYmd(dateOf('Sat'));
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

  const rooms = week?.[toYmd(dateOf(selected))];
  const todayRooms = todayKey ? week?.[toYmd(dateOf(todayKey))] : undefined;

  // 今使える部屋（授業中の時限、なければ次に開く時限）
  const openPeriods = todayRooms
    ? ROOM_SLOTS.map(p => p.period).filter(p => isOpen(todayRooms.study[p - 1]) || isOpen(todayRooms.talk[p - 1]))
    : [];
  const current = openPeriods.find(p => slotState(p, now) === 'current');
  const next = openPeriods.find(p => slotState(p, now) === 'before');
  const focus = current ?? next;

  // 元の時間割 PDF（今日が掲載期間に入っているもの）。リンクだけ出す
  const { data: pdfUrl } = useQuery({
    queryKey: ['studyRoomPdf', toYmd(now)],
    queryFn: async () => {
      const today = toYmd(now);
      const { data, error } = await supabase
        .from('schedule_metadata')
        .select('filename')
        .lte('start_date', today)
        .gte('end_date', today)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error || !data) return null;
      return supabase.storage.from('images').getPublicUrl(`studyroom/${data.filename}`).data.publicUrl;
    },
    staleTime: 1000 * 60 * 55,
  });

  // 見出しの「何限」も自習室の枠で数える（19:50〜21:30 は「6限～」）
  const periodLabel = todayKey ? ROOM_SLOTS.find(p => slotState(p.period, now) === 'current')?.label ?? null : null;
  const fmtDate = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}`; };

  // 列の見出しの下線タブ: 曜日（今日の曜日には小さな点）
  const dayTabs = DAYS.map(d => ({
    key: d,
    label: <span className="relative">{DAY_LABELS[d]}{d === todayKey && <span className="absolute -right-2 top-0 w-1.5 h-1.5 rounded-full bg-accent" aria-label="今日" />}</span>,
    active: selected === d,
    onSelect: () => setSelected(d),
  }));
  // 列の見出しの補足: 表示中の日付（今日なら時刻と何限かも）
  const headerMeta = (
    <span className="text-[15px] font-bold text-fg tabular-nums whitespace-nowrap">
      {fmtDate(toYmd(dateOf(selected)))}（{DAY_LABELS[selected]}）
      {isTodaySelected && <span className="ml-2 text-fg-muted">{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span>}
      {isTodaySelected && periodLabel && <span className="ml-2 text-accent">{periodLabel}</span>}
    </span>
  );

  return (
    <ChapterFrame title="自習室" meta={headerMeta} tabs={dayTabs} bare>
      <div className={PAGE_GRID}>
        {/* 右の列（スマホでは表の上）: 今使える部屋（時間外は次に開く部屋）。今日の曜日を開いているときだけ
            （ほかの曜日では関係がなく、表を出す場所が減るため） */}
        {isTodaySelected && (
        <aside className={SIDE_WIDGET}>
          <div className="px-4 sm:px-5 py-4">
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
                  <dd className={`text-xl font-bold ${isOpen(todayRooms.study[focus - 1]) ? 'text-fg' : 'text-fg-subtle'}`}>{isOpen(todayRooms.study[focus - 1]) ? todayRooms.study[focus - 1] : <span aria-label="閉室">-</span>}</dd>
                  <dt className="text-sm text-fg-muted">談話室</dt>
                  <dd className={`text-xl font-bold ${isOpen(todayRooms.talk[focus - 1]) ? 'text-fg' : 'text-fg-subtle'}`}>{isOpen(todayRooms.talk[focus - 1]) ? todayRooms.talk[focus - 1] : <span aria-label="閉室">-</span>}</dd>
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm text-fg-muted">
                {!todayKey ? '今日は開放がありません（平日のみ）' : todayRooms ? '本日の開放は終了しました' : '今日の情報はまだありません'}
              </p>
            )}
          </div>
        </aside>
        )}

        {/* 左: 1日分の一覧表 */}
        {/* 真ん中の列: 白い 1 枚の面に、選んだ曜日の表 */}
        <div className={CENTER_PANEL}>
          <div>
            {isLoading ? (
              <TableSkeleton />
            ) : !rooms ? (
              <p className="text-center py-12 px-4 text-sm text-fg-muted">この日の情報はありません</p>
            ) : (
              // 列の幅は固定（中身の長さで決めると、曜日ごとに自習室と談話室の列の位置がずれるため）。
              // 時限の列は一定、自習室と談話室は残りを半分ずつ
              <table className="w-full text-left table-fixed">
                <colgroup>
                  <col className="w-[7.5rem] sm:w-32" />
                  <col />
                  <col />
                </colgroup>
                <thead className="bg-surface-2 text-sm text-fg-muted">
                  <tr>
                    <th scope="col" className="px-4 sm:px-5 py-2.5 font-semibold">時限</th>
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
                          <span className="block text-xs text-fg-muted whitespace-nowrap">{formatHm(p.start)}〜{formatHm(p.end)}</span>
                        </th>
                        <td className="px-3 sm:px-5 py-3">
                          {isOpen(study) ? <span className="text-[15px] sm:text-base font-semibold text-fg break-words">{study}</span> : <span className="text-fg-subtle" aria-label="閉室">-</span>}
                        </td>
                        <td className="px-3 sm:px-5 py-3">
                          {isOpen(talk) ? <span className="text-[15px] sm:text-base font-semibold text-fg break-words">{talk}</span> : <span className="text-fg-subtle" aria-label="閉室">-</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          {/* 表の下: 見方の説明（今日のとき）と、元の時間割 PDF（どの曜日でも） */}
          {((isTodaySelected && rooms) || pdfUrl) && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 sm:px-5 py-3 border-t border-line">
              {isTodaySelected && rooms
                ? <p className="text-xs text-fg-subtle">今の時限は色付き、終わった時限は薄く表示しています。</p>
                : <span />}
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
                  元の時間割 PDF を開く <FiExternalLink size={13} aria-hidden="true" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};

export default StudyRoom;
