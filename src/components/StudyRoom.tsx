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
import ChapterFrame from './ChapterFrame';
import Loading from './Loading';
import { supabase } from '../lib/supabaseClient';
import {
  PERIODS, WEEKDAYS, WEEKDAY_LABELS, formatHm, formatMinutes, minutesLeft, mondayOf, nowInJst,
  periodState, toYmd, weekdayOf, type Weekday,
} from '../lib/schedule';

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
    ? PERIODS.map(p => p.period).filter(p => isOpen(todayRooms.study[p - 1]) || isOpen(todayRooms.talk[p - 1]))
    : [];
  const current = openPeriods.find(p => periodState(p, now) === 'current');
  const next = openPeriods.find(p => periodState(p, now) === 'before');
  const focus = current ?? next;

  const wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  const fmtDate = (ymd: string) => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}`; };

  const daySwitch = (
    <div role="tablist" aria-label="曜日" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {WEEKDAYS.map(d => {
        const active = selected === d;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setSelected(d)}
            className={`relative w-9 sm:w-10 h-8 rounded-md transition-colors ${active ? 'bg-accent-solid text-on-accent' : 'text-fg-muted hover:text-fg'}`}
          >
            <span className="text-sm font-bold">{WEEKDAY_LABELS[d]}</span>
            {d === todayKey && !active && <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent" aria-label="今日" />}
          </button>
        );
      })}
    </div>
  );

  return (
    <ChapterFrame
      title="自習室"
      meta={<span className="font-semibold text-fg">{now.getMonth() + 1}/{now.getDate()}（{wd}） {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span>}
      actions={daySwitch}
      bare
    >
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8 xl:items-start">
        {/* 右の列: 今使える部屋・掲載期間と PDF */}
        <aside className="mb-6 xl:mb-0 xl:order-2 xl:sticky xl:top-4 bg-surface border border-line">
          <div className="px-4 sm:px-5 py-4 border-b border-line">
            <p className="text-sm font-bold text-fg-muted flex items-center gap-1.5"><FiMapPin size={14} />{current ? '今使える部屋' : '次に開く部屋'}</p>
            {isLoading ? (
              <Loading size="sm" label="" />
            ) : todayRooms && focus ? (
              <>
                <p className="mt-2 text-sm text-fg-muted">
                  <span className="font-semibold text-accent mr-2">{focus}限</span>
                  {current
                    ? <>{formatHm(PERIODS[focus - 1].end)} まで（あと{formatMinutes(minutesLeft(focus, now))}）</>
                    : <>{formatHm(PERIODS[focus - 1].start)} から（あと{formatMinutes(minutesLeft(focus, now))}）</>}
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
            <p className="text-sm font-bold text-fg-muted flex items-center gap-1.5"><FiCalendar size={14} />掲載期間</p>
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
        <div className="xl:order-1 min-w-0 xl:px-6">
          <div className="flex items-baseline gap-2 mb-3 px-1">
            <h3 className="text-base font-bold text-fg">{fmtDate(toYmd(dateOf(selected)))}（{WEEKDAY_LABELS[selected]}）</h3>
            {isTodaySelected && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-accent-soft text-accent">今日</span>}
          </div>
          <div className="bg-surface border border-line rounded-lg overflow-hidden">
            {isLoading ? (
              <Loading />
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
                  {PERIODS.map(p => {
                    const state = isTodaySelected ? periodState(p.period, now) : 'before';
                    const study = rooms.study[p.period - 1];
                    const talk = rooms.talk[p.period - 1];
                    return (
                      <tr
                        key={p.period}
                        aria-current={state === 'current' ? 'time' : undefined}
                        className={`${state === 'current' ? 'bg-accent-soft' : ''} ${state === 'after' ? 'opacity-50' : ''}`}
                      >
                        <th scope="row" className={`relative px-4 sm:px-5 py-3 font-normal ${state === 'current' ? 'before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-accent' : ''}`}>
                          <span className="block text-[15px] font-bold text-fg">{p.period}限</span>
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
            <p className="mt-2 px-1 text-xs text-fg-subtle">今の時限は色付き、終わった時限は薄く表示しています。</p>
          )}
        </div>
      </div>
    </ChapterFrame>
  );
};

export default StudyRoom;
