import { describe, it, expect } from 'vitest';
import { PERIODS } from './schedule';
import { PERIOD_TIMES, PERIOD_STARTS } from '../../supabase/functions/_shared/reminders';

// 時限の時刻は、画面（schedule.ts）とサーバー（reminders.ts: 授業前の通知・カレンダー購読）の 2 か所にある。
// 片方だけ直すと通知やカレンダーの時刻がずれるため、同じであることを確かめる。
describe('時限の時刻（画面とサーバー）', () => {
  it('開始・終了が一致する', () => {
    expect(PERIOD_TIMES).toEqual(
      PERIODS.map((p) => ({ period: p.period, start: [p.start.h, p.start.m], end: [p.end.h, p.end.m] })),
    );
  });
  it('通知用の開始時刻も同じ表から作られている', () => {
    expect(PERIOD_STARTS).toEqual(PERIODS.map((p) => ({ period: p.period, h: p.start.h, m: p.start.m })));
  });
});
