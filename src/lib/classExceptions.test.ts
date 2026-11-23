import { describe, it, expect } from 'vitest';
import { applyClassExceptions, type ClassException } from './classExceptions';
import type { Subject } from '../components/Timetable';

const subj = (course: number, period: number, extra: Partial<Subject> = {}): Subject => ({
  id: `${course}-Wed-${period}`, wday: 'Wed', period, name: `授業${course}`, classroom: '361', teacher: '先生', ...extra,
});
const ex = (e: Partial<ClassException>): ClassException => ({
  id: 1, course_id: 1, name: '授業1', date: '2026-11-25', kind: 'change', periods: null,
  period_times: null, classroom: null, note: null, attendance_id: null, ...e,
});
const day = [subj(1, 1, { startTime: '09:30' }), subj(1, 2), subj(2, 3)];

describe('画面の時間割へのイレギュラーな授業回の当てはめ（1 授業・1 日につき 1 件）', () => {
  it('休講は消さずに「休講」にする（メモも付ける）', () => {
    const list = applyClassExceptions(day, [ex({ kind: 'cancel', periods: [2], note: '学会のため' })], '2026-11-25', 'Wed', day);
    expect(list.map((s) => s.status ?? '-')).toEqual(['-', 'cancel', '-']);
    expect(list[1].note).toBe('学会のため');
  });

  it('別の日の登録は当てはめない', () => {
    const list = applyClassExceptions(day, [ex({ kind: 'cancel', date: '2026-12-02' })], '2026-11-25', 'Wed', day);
    expect(list.every((s) => !s.status)).toBe(true);
  });

  it('1 件で 2 つの時限の時刻と教室を変える（指定のない時限はいつもの時刻）', () => {
    const list = applyClassExceptions(day, [ex({ periods: [1, 2], period_times: { '2': { start: '11:00' } }, classroom: '401' })], '2026-11-25', 'Wed', day);
    expect(list[0]).toMatchObject({ status: 'change', startTime: '09:30', classroom: '401' });
    expect(list[1]).toMatchObject({ status: 'change', startTime: '11:00', classroom: '401' });
    expect(list[2].status).toBeUndefined();
  });

  it('1 件で時限を動かす（1・2 限 → 4 限）', () => {
    const list = applyClassExceptions(day, [ex({ periods: [4] })], '2026-11-25', 'Wed', day);
    expect(list.map((s) => `${s.id.split('-')[0]}-${s.period}`)).toEqual(['2-3', '1-4']);
    expect(list[1]).toMatchObject({ status: 'change', classroom: '361', name: '授業1' });
  });

  it('補講は、その時限に授業を足す（教室はいつもの教室）', () => {
    const week = [...day, subj(3, 1, { id: '3-Thu-1', wday: 'Thu', classroom: '342' })];
    const list = applyClassExceptions(day, [ex({ kind: 'extra', course_id: 3, name: '授業3', periods: [4] })], '2026-11-25', 'Wed', week);
    expect(list.map((s) => s.period)).toEqual([1, 2, 3, 4]);
    expect(list[3]).toMatchObject({ status: 'extra', classroom: '342', wday: 'Wed' });
    expect(list[3].id.split('-')[0]).toBe('3');
  });
});

describe('臨時授業', () => {
  it('id は「x」で始まり、LMS のコースとは結び付けない', () => {
    const list = applyClassExceptions([], [{ id: 7, course_id: -7, name: '臨時ゼミ', date: '2026-11-25', kind: 'extra', periods: [5], period_times: null, classroom: '401', note: null, attendance_id: null }], '2026-11-25', 'Wed', []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'x7-Wed-5-extra', name: '臨時ゼミ', classroom: '401', status: 'extra' });
  });
});
