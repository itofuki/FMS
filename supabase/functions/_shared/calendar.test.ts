import { describe, it, expect } from 'vitest';
import { buildCalendar, escapeText, foldLine } from './calendar';

// 2026-11-17（火）10:00 JST = 01:00 UTC
const NOW = new Date('2026-11-17T01:00:00Z');

describe('buildCalendar', () => {
  const ics = buildCalendar({
    now: NOW,
    classes: [{ id: 103, name: '英語コミュニケーション', wday: 'Tue', period: 3, classroom: '353', teacher: 'Smith', attendance_id: 9001 }],
    deadlines: [{ uid: 'assign_1', title: '中間レポート, 第1回', deadline: '2026-11-20T14:59:00Z', url: 'https://example.com/a' }],
    weeksBefore: 0,
    weeksAfter: 2,
  });
  const unfolded = ics.replace(/\r\n /g, '');

  it('授業を毎週分、JST の時刻を UTC にして入れる', () => {
    // 火曜 3 限 13:20〜14:50 JST = 04:20〜05:50 UTC
    expect(unfolded).toContain('DTSTART:20261117T042000Z');
    expect(unfolded).toContain('DTEND:20261117T055000Z');
    expect(unfolded).toContain('DTSTART:20261124T042000Z');
    expect(unfolded).not.toContain('DTSTART:20261201T042000Z');
    expect(unfolded).toContain('SUMMARY:3限 英語コミュニケーション');
    expect(unfolded).toContain('LOCATION:353');
    expect(unfolded).toContain('UID:class-103-20261117-3@fms-iput.app');
    expect(unfolded).toContain('URL:https://lms-tokyo.iput.ac.jp/mod/attendance/view.php?id=9001');
  });

  it('締切を時刻ちょうどの予定として入れ、カンマをエスケープする', () => {
    expect(unfolded).toContain('DTSTART:20261120T145900Z');
    expect(unfolded).toContain('SUMMARY:締切: 中間レポート\\, 第1回');
    expect(unfolded).toContain('UID:deadline-assign_1@fms-iput.app');
  });

  it('行末は CRLF で、カレンダーの始まりと終わりがある', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

describe('escapeText / foldLine', () => {
  it('特殊文字をエスケープする', () => {
    expect(escapeText('a;b,c\nd\\e')).toBe('a\\;b\\,c\\nd\\\\e');
  });
  it('75 オクテットを超える行を折り返す（日本語でも文字の途中で切らない）', () => {
    const line = 'SUMMARY:' + 'あ'.repeat(40);
    const folded = foldLine(line);
    const enc = new TextEncoder();
    for (const part of folded.split('\r\n')) expect(enc.encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });
});

describe('buildCalendar（管理者が調整した時刻）', () => {
  it('開始・終了の時刻がずれた授業は、その時刻で入れる', () => {
    const ics = buildCalendar({
      now: NOW,
      // 火曜 1 限だが 9:30〜11:00 JST = 00:30〜02:00 UTC
      classes: [{ id: 7, name: 'ゼミ', wday: 'Tue', period: 1, start_time: '09:30', end_time: '11:00' }],
      deadlines: [],
      weeksBefore: 0,
      weeksAfter: 1,
    }).replace(/\r\n /g, '');
    expect(ics).toContain('DTSTART:20261117T003000Z');
    expect(ics).toContain('DTEND:20261117T020000Z');
  });
});
