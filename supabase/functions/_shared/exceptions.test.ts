import { describe, it, expect } from 'vitest';
import { applyExceptionsForDate, wdayOfDate, type ClassException } from './exceptions';

const rows = [
  { id: 1, name: 'ソリューション開発', wday: 'Wed', period: 1, classroom: '361' },
  { id: 1, name: 'ソリューション開発', wday: 'Wed', period: 2, classroom: '361' },
  { id: 2, name: 'AI概論', wday: 'Wed', period: 3, classroom: '311' },
  { id: 3, name: '線形代数', wday: 'Thu', period: 1, classroom: '342' },
];
const ex = (e: Partial<ClassException>): ClassException => ({
  id: 1, course_id: 1, name: 'ソリューション開発', date: '2026-11-25', kind: 'change', period: null,
  start_time: null, end_time: null, classroom: null, note: null, attendance_id: null, ...e,
});

describe('イレギュラーな授業回の当てはめ', () => {
  it('曜日', () => {
    expect(wdayOfDate('2026-11-25')).toBe('Wed');
  });

  it('何もなければ、その曜日のいつもの授業', () => {
    expect(applyExceptionsForDate(rows, [], '2026-11-25').map((r) => r.period)).toEqual([1, 2, 3]);
  });

  it('休講（時限の指定なし）は、そのコースのその日の全時限をなくす', () => {
    const day = applyExceptionsForDate(rows, [ex({ kind: 'cancel' })], '2026-11-25');
    expect(day.map((r) => r.id)).toEqual([2]);
  });

  it('休講（時限の指定あり）は、その時限だけ', () => {
    const day = applyExceptionsForDate(rows, [ex({ kind: 'cancel', period: 2 })], '2026-11-25');
    expect(day.map((r) => `${r.id}-${r.period}`)).toEqual(['1-1', '2-3']);
  });

  it('別の日の登録は当てはめない', () => {
    expect(applyExceptionsForDate(rows, [ex({ kind: 'cancel', date: '2026-12-02' })], '2026-11-25')).toHaveLength(3);
  });

  it('時刻・教室の変更（時限の指定あり）', () => {
    const day = applyExceptionsForDate(rows, [ex({ period: 2, start_time: '11:00', end_time: '12:30', classroom: '401' })], '2026-11-25');
    expect(day[1]).toMatchObject({ period: 2, start_time: '11:00', end_time: '12:30', classroom: '401' });
    expect(day[0]).toMatchObject({ period: 1, classroom: '361' });
  });

  it('時刻の変更（全時限）は、最初の時限の開始・最後の時限の終了に当てはめる', () => {
    const day = applyExceptionsForDate(rows, [ex({ start_time: '09:30', end_time: '12:00' })], '2026-11-25');
    expect(day[0]).toMatchObject({ period: 1, start_time: '09:30' });
    expect(day[0].end_time).toBeUndefined();
    expect(day[1]).toMatchObject({ period: 2, end_time: '12:00' });
  });

  it('補講は、いつもはない日・時限に授業を足す（教室はいつもの教室）', () => {
    const day = applyExceptionsForDate(rows, [ex({ kind: 'extra', course_id: 3, name: '線形代数', period: 4 })], '2026-11-25');
    expect(day.map((r) => `${r.id}-${r.period}`)).toEqual(['1-1', '1-2', '2-3', '3-4']);
    expect(day[3]).toMatchObject({ wday: 'Wed', classroom: '342' });
  });
});
