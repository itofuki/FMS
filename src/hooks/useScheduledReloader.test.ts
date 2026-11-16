import { describe, it, expect } from 'vitest';
import { getNextReloadTime } from './useScheduledReloader';

const at = (h: number, m: number, base = new Date(2026, 10, 16)) => {
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
};

describe('getNextReloadTime', () => {
  it('空配列なら null', () => {
    expect(getNextReloadTime([], at(9, 0))).toBeNull();
  });

  it('今日まだ来ていない時刻のうち最も早いものを返す（入力順に依存しない）', () => {
    const times = [{ hour: 18, minute: 0 }, { hour: 12, minute: 30 }, { hour: 5, minute: 0 }];
    expect(getNextReloadTime(times, at(9, 0))).toEqual(at(12, 30));
  });

  it('ちょうどその時刻は「過ぎた」とみなして次を返す', () => {
    const times = [{ hour: 9, minute: 0 }, { hour: 10, minute: 0 }];
    expect(getNextReloadTime(times, at(9, 0))).toEqual(at(10, 0));
  });

  it('今日の時刻がすべて過ぎていれば明日の最も早い時刻', () => {
    const times = [{ hour: 12, minute: 0 }, { hour: 5, minute: 0 }];
    expect(getNextReloadTime(times, at(23, 0))).toEqual(at(5, 0, new Date(2026, 10, 17)));
  });

  it('月末をまたいでも翌月1日になる', () => {
    const times = [{ hour: 5, minute: 0 }];
    expect(getNextReloadTime(times, at(23, 0, new Date(2026, 10, 30)))).toEqual(at(5, 0, new Date(2026, 11, 1)));
  });
});
