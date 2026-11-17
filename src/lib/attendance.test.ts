import { describe, it, expect } from 'vitest';
import { parseAttendanceValues, toAttendanceSummary } from './attendance';

// LMS のアプリ用画面（mod_attendance の mobile_view_activity）を、実際の形に近づけて縮めたもの
const row = (key: string, value: string) => `
  <ion-item>
    <ion-label>{{ 'plugin.mod_attendance.${key}' | translate }}</ion-label>
    <ion-label class="ion-text-end">
        ${value}
    </ion-label>
  </ion-item>`;

const SAMPLE = [
  row('sessionscompleted', '1'),
  row('pointssessionscompleted', '3 / 3'),
  row('percentagesessionscompleted', '100.0%'),
  row('sessionstotal', '1'),
  row('pointsallsessions', '100.0%'),
  row('percentageallsessions', '100.0%'),
  row('maxpossiblepoints', '3 / 3'),
  row('maxpossiblepercentage', '100.0%'),
].join('\n');

describe('parseAttendanceValues', () => {
  it('内部の名前の直後の値を拾う', () => {
    const v = parseAttendanceValues(SAMPLE);
    expect(v.sessionscompleted).toBe('1');
    expect(v.pointssessionscompleted).toBe('3 / 3');
    expect(v.percentagesessionscompleted).toBe('100.0%');
    expect(v.sessionstotal).toBe('1');
  });
  it('目印がなければ空', () => {
    expect(parseAttendanceValues('<p>エラー</p>')).toEqual({});
  });
});

describe('toAttendanceSummary', () => {
  it('出席率・回数・得点にまとめる', () => {
    expect(toAttendanceSummary(parseAttendanceValues(SAMPLE))).toEqual({
      completed: 1, total: 1, percent: 100, points: '3 / 3',
    });
  });
  it('まだ記録がない回は出席率を null にする', () => {
    const v = parseAttendanceValues(row('sessionscompleted', '0') + row('sessionstotal', '15') + row('percentagesessionscompleted', '0.0%'));
    expect(toAttendanceSummary(v)).toEqual({ completed: 0, total: 15, percent: null, points: null });
  });
  it('回数が読めなければ null', () => {
    expect(toAttendanceSummary({ percentagesessionscompleted: '80.0%' })).toBeNull();
  });
});
