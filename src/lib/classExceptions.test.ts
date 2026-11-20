import { describe, it, expect } from 'vitest';
import { applyClassExceptions, type ClassException } from './classExceptions';
import type { Subject } from '../components/Timetable';

const subj = (course: number, period: number, extra: Partial<Subject> = {}): Subject => ({
  id: `${course}-Wed-${period}`, wday: 'Wed', period, name: `授業${course}`, classroom: '361', teacher: '先生', ...extra,
});
const ex = (e: Partial<ClassException>): ClassException => ({
  id: 1, course_id: 1, name: '授業1', date: '2026-11-25', kind: 'change', period: null,
  start_time: null, end_time: null, classroom: null, note: null, attendance_id: null, ...e,
});
const day = [subj(1, 1), subj(1, 2), subj(2, 3)];

describe('画面の時間割へのイレギュラーな授業回の当てはめ', () => {
  it('休講は消さずに「休講」にする（メモも付ける）', () => {
    const list = applyClassExceptions(day, [ex({ kind: 'cancel', period: 2, note: '学会のため' })], '2026-11-25', 'Wed', day);
    expect(list.map((s) => s.status ?? '-')).toEqual(['-', 'cancel', '-']);
    expect(list[1].note).toBe('学会のため');
  });

  it('別の日の登録は当てはめない', () => {
    const list = applyClassExceptions(day, [ex({ kind: 'cancel', date: '2026-12-02' })], '2026-11-25', 'Wed', day);
    expect(list.every((s) => !s.status)).toBe(true);
  });

  it('時刻・教室の変更', () => {
    const list = applyClassExceptions(day, [ex({ period: 1, start_time: '10:00', classroom: '401' })], '2026-11-25', 'Wed', day);
    expect(list[0]).toMatchObject({ status: 'change', startTime: '10:00', classroom: '401' });
    expect(list[1].status).toBeUndefined();
  });

  it('補講は、その時限に授業を足す（教室はいつもの教室）', () => {
    const week = [...day, subj(3, 1, { id: '3-Thu-1', wday: 'Thu', classroom: '342' })];
    const list = applyClassExceptions(day, [ex({ kind: 'extra', course_id: 3, name: '授業3', period: 4 })], '2026-11-25', 'Wed', week);
    expect(list.map((s) => s.period)).toEqual([1, 2, 3, 4]);
    expect(list[3]).toMatchObject({ status: 'extra', classroom: '342', wday: 'Wed' });
    expect(list[3].id.split('-')[0]).toBe('3');
  });
});
