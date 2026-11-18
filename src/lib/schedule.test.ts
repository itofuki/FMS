import { describe, it, expect } from 'vitest';
import { periodState, minutesLeft, focusPeriod, formatMinutes, mondayOf, toYmd, weekdayOf, currentPeriodLabel, parseDebugTime, jstYmd } from './schedule';

// 2026-11-17 は火曜日
const at = (h: number, m: number, day = 17) => new Date(2026, 10, day, h, m);

describe('periodState / minutesLeft', () => {
  it('1限(9:15-10:55)の前・最中・後', () => {
    expect(periodState(1, at(9, 0))).toBe('before');
    expect(minutesLeft(1, at(9, 0))).toBe(15);
    expect(periodState(1, at(9, 15))).toBe('current');
    expect(minutesLeft(1, at(10, 20))).toBe(35);
    expect(periodState(1, at(10, 55))).toBe('after');
    expect(minutesLeft(1, at(11, 0))).toBe(0);
  });
});

describe('focusPeriod', () => {
  it('授業中のものを優先し、なければ次に始まるもの', () => {
    expect(focusPeriod([1, 3], at(9, 30))).toEqual({ period: 1, state: 'current' });
    expect(focusPeriod([1, 3], at(12, 0))).toEqual({ period: 3, state: 'before' });
    expect(focusPeriod([3, 1], at(8, 0))).toEqual({ period: 1, state: 'before' });
  });
  it('全部終わっていれば null', () => {
    expect(focusPeriod([1, 2], at(13, 0))).toBeNull();
    expect(focusPeriod([], at(13, 0))).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('60分未満は分、それ以上は時間と分', () => {
    expect(formatMinutes(35)).toBe('35分');
    expect(formatMinutes(60)).toBe('1時間');
    expect(formatMinutes(80)).toBe('1時間20分');
  });
});

describe('mondayOf / weekdayOf', () => {
  it('平日はその週の月曜、土日は次の週の月曜', () => {
    expect(toYmd(mondayOf(at(10, 0, 17)))).toBe('2026-11-16'); // 火
    expect(toYmd(mondayOf(at(10, 0, 16)))).toBe('2026-11-16'); // 月
    expect(toYmd(mondayOf(at(10, 0, 21)))).toBe('2026-11-23'); // 土
    expect(toYmd(mondayOf(at(10, 0, 22)))).toBe('2026-11-23'); // 日
  });
  it('土日は null', () => {
    expect(weekdayOf(at(10, 0, 17))).toBe('Tue');
    expect(weekdayOf(at(10, 0, 21))).toBeNull();
  });
});

describe('currentPeriodLabel', () => {
  it('1〜6限の授業時間中だけ何限かを返す', () => {
    expect(currentPeriodLabel(at(9, 15))).toBe('1限');
    expect(currentPeriodLabel(at(10, 55))).toBe('2限');
    expect(currentPeriodLabel(at(19, 49))).toBe('6限');
  });
  it('授業時間外（1限前・休み時間・昼休み・6限後・土日）は null', () => {
    expect(currentPeriodLabel(at(8, 0))).toBeNull();
    expect(currentPeriodLabel(at(12, 40))).toBeNull();
    expect(currentPeriodLabel(at(14, 55))).toBeNull();
    expect(currentPeriodLabel(at(19, 50))).toBeNull();
    expect(currentPeriodLabel(at(10, 0, 21))).toBeNull();
  });
});

describe('parseDebugTime', () => {
  it('「13:30」は基準日のその時刻', () => {
    expect(parseDebugTime('13:30', at(9, 0))).toEqual(at(13, 30));
  });
  it('日付つきも読める', () => {
    expect(parseDebugTime('2026-11-24T09:20', at(9, 0))).toEqual(new Date(2026, 10, 24, 9, 20));
  });
  it('読めない形は null', () => {
    expect(parseDebugTime('1330', at(9, 0))).toBeNull();
  });
});

describe('jstYmd', () => {
  it('日本時間の日付で数える（UTC の 15 時以降は翌日）', () => {
    expect(jstYmd('2026-11-19T14:59:00Z')).toBe('2026-11-19');
    expect(jstYmd('2026-11-19T15:00:00Z')).toBe('2026-11-20');
  });
});
