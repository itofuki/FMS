/* src/components/AssignmentCalendar.tsx
 * 課題の締切を月のカレンダーで見る（Open LMS のアプリのカレンダーと同じ使い方）。
 * 締切のある日に点（期限が近いほど強い色）を付け、日付を押すとその日を選ぶ（その日の課題は課題ページが下に並べる）。
 * 日付は日本時間で数える。
 */
import { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import type { UnifiedAssignment } from '../lib/assignments';
import { jstYmd } from '../lib/schedule';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const DAY_MS = 24 * 60 * 60 * 1000;


/** 点の色: 完了は緑、期限切れ・24時間以内は赤、3日以内は黄、それ以外はアクセント */
const dotClass = (a: UnifiedAssignment, now: number) => {
  if (a.done) return 'bg-up/60';
  const left = new Date(a.deadline).getTime() - now;
  if (left <= DAY_MS) return 'bg-down';
  if (left <= 3 * DAY_MS) return 'bg-warn';
  return 'bg-accent';
};

export default function AssignmentCalendar({ items, selected, onSelect }: {
  items: UnifiedAssignment[];
  /** 選んでいる日（YYYY-MM-DD） */
  selected: string;
  onSelect: (ymd: string) => void;
}) {
  const today = jstYmd(new Date());
  const [month, setMonth] = useState(() => {
    const [y, m] = selected.split('-').map(Number);
    return { y, m };
  });

  // 日付 → その日の締切
  const byDay = useMemo(() => {
    const map = new Map<string, UnifiedAssignment[]>();
    for (const a of items) {
      const key = jstYmd(a.deadline);
      map.set(key, [...(map.get(key) ?? []), a]);
    }
    return map;
  }, [items]);

  // 表示する月のマス（前後の月の日で 6 週分を埋める。日曜始まり）
  const cells = useMemo(() => {
    const first = new Date(month.y, month.m - 1, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { ymd, day: d.getDate(), dow: d.getDay(), inMonth: d.getMonth() === month.m - 1 };
    });
  }, [month]);
  // 最後の週がまるごと次の月なら出さない（5 週の月を 5 行に）
  const rows = cells.slice(35).every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;

  const move = (diff: number) => setMonth(({ y, m }) => {
    const d = new Date(y, m - 1 + diff, 1);
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  const goToday = () => {
    const [y, m] = today.split('-').map(Number);
    setMonth({ y, m });
    onSelect(today);
  };
  const now = Date.now();

  return (
    <div className="px-2 sm:px-4 pt-3 pb-4 border-b border-line">
      {/* 月の切り替え */}
      <div className="flex items-center justify-between px-2 mb-2">
        <button type="button" onClick={() => move(-1)} aria-label="前の月" className="w-9 h-9 rounded-full flex items-center justify-center text-fg hover:bg-surface-3 transition-colors">
          <FiChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <p className="text-[17px] font-bold text-fg tabular-nums">{month.y}年 {month.m}月</p>
          {/* 今日: ほかの月・日を見ているときに今日へ戻る。今日を見ているときは押しても変わらないので薄くする（場所は動かさない） */}
          {(() => {
            const onToday = selected === today && month.y === Number(today.slice(0, 4)) && month.m === Number(today.slice(5, 7));
            return (
              <button
                type="button"
                onClick={goToday}
                disabled={onToday}
                aria-label={onToday ? '今日を表示中' : '今日に戻る'}
                className="h-7 px-3 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
              >
                <span className="text-xs font-bold">今日</span>
              </button>
            );
          })()}
        </div>
        <button type="button" onClick={() => move(1)} aria-label="次の月" className="w-9 h-9 rounded-full flex items-center justify-center text-fg hover:bg-surface-3 transition-colors">
          <FiChevronRight size={20} />
        </button>
      </div>

      <div role="grid" aria-label={`${month.y}年${month.m}月の締切`} className="grid grid-cols-7">
        {WEEK.map((w, i) => (
          <div key={w} role="columnheader" className={`py-1.5 text-center text-xs font-semibold ${i === 0 ? 'text-down' : i === 6 ? 'text-link' : 'text-fg-muted'}`}>{w}</div>
        ))}
        {rows.map((c) => {
          const list = byDay.get(c.ymd) ?? [];
          const isSelected = c.ymd === selected;
          const isToday = c.ymd === today;
          return (
            <button
              key={c.ymd}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={`${Number(c.ymd.slice(5, 7))}月${c.day}日${list.length ? `、締切 ${list.length}件` : ''}`}
              onClick={() => onSelect(c.ymd)}
              className="flex flex-col items-center gap-1 py-1.5 rounded-xl hover:bg-surface-2 transition-colors"
            >
              <span
                className={`w-8 h-8 rounded-full flex items-center justify-center text-[15px] tabular-nums ${
                  isSelected ? 'bg-accent-solid text-on-accent font-bold'
                  : isToday ? 'ring-2 ring-accent text-accent font-bold'
                  : !c.inMonth ? 'text-fg-subtle'
                  : c.dow === 0 ? 'text-down' : c.dow === 6 ? 'text-link' : 'text-fg'
                }`}
              >
                {c.day}
              </span>
              {/* 締切の点（3 件まで。それ以上は「+」） */}
              <span className="flex items-center gap-0.5 h-1.5" aria-hidden="true">
                {list.slice(0, 3).map((a) => <span key={`${a.isLms ? "lms" : "db"}-${a.id}`} className={`w-1.5 h-1.5 rounded-full ${dotClass(a, now)}`} />)}
                {list.length > 3 && <span className="text-[9px] leading-none text-fg-muted">+</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
