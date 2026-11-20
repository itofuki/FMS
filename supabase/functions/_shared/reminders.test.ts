import { describe, it, expect } from 'vitest';
import { isDeadlineReminderDue, formatRemaining, toJst, upcomingPeriod, classUrl, dueClasses, isNearAnyClassStart, classMinutes } from './reminders';

const H = 3600_000;
// JST の日時から Date を作る
const jst = (iso: string) => new Date(`${iso}+09:00`);

describe('isDeadlineReminderDue', () => {
  const now = Date.UTC(2026, 10, 16, 3, 0);
  it('残り時間が設定時間以内なら対象', () => {
    expect(isDeadlineReminderDue(now + 23 * H, now, 24)).toBe(true);
    expect(isDeadlineReminderDue(now + 24 * H, now, 24)).toBe(true);
  });
  it('設定時間より前は対象外', () => {
    expect(isDeadlineReminderDue(now + 25 * H, now, 24)).toBe(false);
  });
  it('締切を過ぎたものは対象外', () => {
    expect(isDeadlineReminderDue(now - 1, now, 24)).toBe(false);
    expect(isDeadlineReminderDue(now, now, 24)).toBe(false);
  });
});

describe('formatRemaining', () => {
  it('分・時間・日で丸める', () => {
    expect(formatRemaining(10 * 1000)).toBe('約1分');
    expect(formatRemaining(30 * 60 * 1000)).toBe('約30分');
    expect(formatRemaining(59.6 * 60 * 1000)).toBe('約1時間');
    expect(formatRemaining(23.7 * H)).toBe('約24時間');
    expect(formatRemaining(72 * H)).toBe('約3日');
  });
});

describe('toJst', () => {
  it('UTC 15:30 は JST の翌日 0:30', () => {
    expect(toJst(new Date(Date.UTC(2026, 10, 16, 15, 30)))).toEqual({ date: '2026-11-17', wday: 'Tue', minutes: 30 });
  });
});

describe('upcomingPeriod', () => {
  it('1限開始(9:15)の5分前〜開始直前は1限', () => {
    expect(upcomingPeriod(jst('2026-11-16T09:10:00'))).toEqual({ period: 1, date: '2026-11-16', wday: 'Mon', startLabel: '9:15' });
    expect(upcomingPeriod(jst('2026-11-16T09:14:59'))?.period).toBe(1);
  });
  it('5分より前・開始時刻以降は対象外', () => {
    expect(upcomingPeriod(jst('2026-11-16T09:09:59'))).toBeNull();
    expect(upcomingPeriod(jst('2026-11-16T09:15:00'))).toBeNull();
  });
  it('4限(15:00)は 14:55 から', () => {
    expect(upcomingPeriod(jst('2026-11-16T14:55:00'))).toMatchObject({ period: 4, startLabel: '15:00' });
  });
  it('土日は通知しない', () => {
    expect(upcomingPeriod(jst('2026-11-21T09:10:00'))).toBeNull(); // 土
    expect(upcomingPeriod(jst('2026-11-22T09:10:00'))).toBeNull(); // 日
  });
});

describe('classUrl', () => {
  it('出席IDがあれば出席ページ、なければコースページ', () => {
    expect(classUrl(10, 99)).toBe('https://lms-tokyo.iput.ac.jp/mod/attendance/view.php?id=99');
    expect(classUrl(10, null)).toBe('https://lms-tokyo.iput.ac.jp/course/view.php?id=10');
  });
});

describe('授業ごとの時刻（管理者が調整した時刻）', () => {
  const row = (id: number, period: number, extra: { start_time?: string | null; end_time?: string | null } = {}) =>
    ({ id, wday: 'Mon', period, ...extra });

  it('調整がなければ時限の本来の時刻、あればその時刻', () => {
    expect(classMinutes(row(1, 1))).toEqual({ start: 9 * 60 + 15, end: 10 * 60 + 55 });
    expect(classMinutes(row(1, 1, { start_time: '09:30', end_time: '11:00' }))).toEqual({ start: 9 * 60 + 30, end: 11 * 60 });
  });

  it('本来の時限の授業は、開始 5 分前から通知の対象', () => {
    const due = dueClasses(jst('2026-11-16T09:10:00'), [row(1, 1), row(2, 3)]);
    expect(due.map((d) => d.row.id)).toEqual([1]);
    expect(due[0].startLabel).toBe('9:15');
  });

  it('開始が 9:30 にずれた授業は、9:25 から対象（9:10 では対象外）', () => {
    const shifted = [row(1, 1, { start_time: '09:30' })];
    expect(dueClasses(jst('2026-11-16T09:10:00'), shifted)).toEqual([]);
    const due = dueClasses(jst('2026-11-16T09:25:00'), shifted);
    expect(due).toHaveLength(1);
    expect(due[0].startLabel).toBe('9:30');
  });

  it('続けて行う授業でも、時限ごとに通知する（出席を毎時限入力するため）', () => {
    // 1・2限続きの授業（id 5）。2限の開始 10:55 の前にも通知する
    const due = dueClasses(jst('2026-11-16T10:52:00'), [row(5, 1), row(5, 2)]);
    expect(due.map((d) => d.row.period)).toEqual([2]);
  });

  it('ほかの曜日・土日の授業は対象外', () => {
    expect(dueClasses(jst('2026-11-17T09:10:00'), [row(1, 1)])).toEqual([]); // 火曜
    expect(dueClasses(jst('2026-11-21T09:10:00'), [{ ...row(1, 1), wday: 'Sat' }])).toEqual([]);
  });

  it('授業の開始前かどうか（全員の時間割を読むかの判断）', () => {
    expect(isNearAnyClassStart(jst('2026-11-16T09:12:00'), [])).toBe(true);
    expect(isNearAnyClassStart(jst('2026-11-16T09:27:00'), [])).toBe(false);
    expect(isNearAnyClassStart(jst('2026-11-16T09:27:00'), ['09:30'])).toBe(true);
    expect(isNearAnyClassStart(jst('2026-11-21T09:12:00'), [])).toBe(false); // 土曜
  });
});
