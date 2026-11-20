import { describe, it, expect } from 'vitest';
import { applyExceptionsForDate, wdayOfDate, type ClassException } from './exceptions';

const rows = [
  { id: 1, name: 'ソリューション開発', wday: 'Wed', period: 1, classroom: '361', start_time: '09:30', end_time: '11:00' },
  { id: 1, name: 'ソリューション開発', wday: 'Wed', period: 2, classroom: '361' },
  { id: 2, name: 'AI概論', wday: 'Wed', period: 3, classroom: '311' },
  { id: 3, name: '線形代数', wday: 'Thu', period: 1, classroom: '342' },
];
const ex = (e: Partial<ClassException>): ClassException => ({
  id: 1, course_id: 1, name: 'ソリューション開発', date: '2026-11-25', kind: 'change', periods: null,
  period_times: null, classroom: null, note: null, attendance_id: null, ...e,
});
const key = (r: { id: number; period: number }) => `${r.id}-${r.period}`;

describe('イレギュラーな授業回の当てはめ（1 授業・1 日につき 1 件）', () => {
  it('曜日', () => {
    expect(wdayOfDate('2026-11-25')).toBe('Wed');
  });

  it('何もなければ、その曜日のいつもの授業', () => {
    expect(applyExceptionsForDate(rows, [], '2026-11-25').map(key)).toEqual(['1-1', '1-2', '2-3']);
  });

  it('休講（時限の指定なし）は、そのコースのその日の全時限をなくす', () => {
    expect(applyExceptionsForDate(rows, [ex({ kind: 'cancel' })], '2026-11-25').map(key)).toEqual(['2-3']);
  });

  it('休講（時限の指定あり）は、その時限だけ', () => {
    expect(applyExceptionsForDate(rows, [ex({ kind: 'cancel', periods: [2] })], '2026-11-25').map(key)).toEqual(['1-1', '2-3']);
  });

  it('別の日の登録は当てはめない', () => {
    expect(applyExceptionsForDate(rows, [ex({ kind: 'cancel', date: '2026-12-02' })], '2026-11-25')).toHaveLength(3);
  });

  it('1 件の変更で、2 つの時限の時刻と教室を変える（指定のない時限はいつもの時刻）', () => {
    const day = applyExceptionsForDate(rows, [ex({ periods: [1, 2], period_times: { '2': { start: '11:00', end: '12:30' } }, classroom: '401' })], '2026-11-25');
    expect(day.map(key)).toEqual(['1-1', '1-2', '2-3']);
    expect(day[0]).toMatchObject({ start_time: '09:30', end_time: '11:00', classroom: '401', exception: 'change' });
    expect(day[1]).toMatchObject({ start_time: '11:00', end_time: '12:30', classroom: '401' });
  });

  it('1 件の変更で、時限を動かす（1・2 限 → 3・4 限。3 限のほかの授業は置き換える）', () => {
    const day = applyExceptionsForDate(rows, [ex({ periods: [3, 4], period_times: { '4': { end: '16:00' } } })], '2026-11-25');
    expect(day.map(key)).toEqual(['1-3', '1-4']);
    expect(day[1]).toMatchObject({ end_time: '16:00', classroom: '361' });
    expect(day[0].start_time).toBeNull();
  });

  it('教室だけの変更（時限の指定なし）は、いつもの時限のまま', () => {
    const day = applyExceptionsForDate(rows, [ex({ classroom: '401' })], '2026-11-25');
    expect(day.map(key)).toEqual(['1-1', '1-2', '2-3']);
    expect(day[0]).toMatchObject({ classroom: '401', start_time: '09:30' });
  });

  it('補講は、いつもはない日・時限に授業を足す（教室はいつもの教室）', () => {
    const day = applyExceptionsForDate(rows, [ex({ kind: 'extra', course_id: 3, name: '線形代数', periods: [4, 5] })], '2026-11-25');
    expect(day.map(key)).toEqual(['1-1', '1-2', '2-3', '3-4', '3-5']);
    expect(day[3]).toMatchObject({ wday: 'Wed', classroom: '342', exception: 'extra' });
  });
});
