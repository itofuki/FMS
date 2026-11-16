import { describe, it, expect } from 'vitest';
import { isDeadlineReminderDue, formatRemaining, toJst, upcomingPeriod, classUrl } from './reminders';

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
