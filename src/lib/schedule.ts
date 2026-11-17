/* src/lib/schedule.ts
 * 時限の時刻表と、「今は何限か」「次の授業まで何分か」などの計算（時間割・自習室で共通）。
 * 時刻はすべて日本時間で扱う（nowInJst() の値を渡す）。
 * サーバー側（supabase/functions/_shared/reminders.ts の PERIOD_TIMES）と同じであること。src/lib/periods.test.ts で確かめている。
 */

export type PeriodTime = { period: number; start: { h: number; m: number }; end: { h: number; m: number } };

export const PERIODS: PeriodTime[] = [
  { period: 1, start: { h: 9, m: 15 }, end: { h: 10, m: 55 } },
  { period: 2, start: { h: 10, m: 55 }, end: { h: 12, m: 25 } },
  { period: 3, start: { h: 13, m: 20 }, end: { h: 14, m: 50 } },
  { period: 4, start: { h: 15, m: 0 }, end: { h: 16, m: 30 } },
  { period: 5, start: { h: 16, m: 40 }, end: { h: 18, m: 10 } },
  { period: 6, start: { h: 18, m: 20 }, end: { h: 19, m: 50 } },
];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = { Mon: '月', Tue: '火', Wed: '水', Thu: '木', Fri: '金' };

/** 日本時間の「今」を、その時刻を表すローカルの Date として返す */
export const nowInJst = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));

export const formatHm = (t: { h: number; m: number }) => `${t.h}:${String(t.m).padStart(2, '0')}`;

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
const toMin = (t: { h: number; m: number }) => t.h * 60 + t.m;

export const periodTime = (period: number) => PERIODS.find((p) => p.period === period);

/** 平日なら曜日キー、土日は null */
export const weekdayOf = (d: Date): Weekday | null => {
  const i = d.getDay();
  return i >= 1 && i <= 5 ? WEEKDAYS[i - 1] : null;
};

export type PeriodState = 'before' | 'current' | 'after';

/** その時限が、今から見て「これから / 授業中 / 終了」のどれか */
export function periodState(period: number, now: Date): PeriodState {
  const p = periodTime(period);
  if (!p) return 'after';
  const n = minutesOf(now);
  if (n < toMin(p.start)) return 'before';
  if (n < toMin(p.end)) return 'current';
  return 'after';
}

/** 開始まで（before）または終了まで（current）の残り分。after は 0 */
export function minutesLeft(period: number, now: Date): number {
  const p = periodTime(period);
  if (!p) return 0;
  const n = minutesOf(now);
  const state = periodState(period, now);
  if (state === 'before') return toMin(p.start) - n;
  if (state === 'current') return toMin(p.end) - n;
  return 0;
}

/** 「あと 35 分」「あと 1 時間 20 分」 */
export function formatMinutes(min: number): string {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/**
 * 指定した時限のうち、今いちばん注目すべきもの（授業中のもの、なければ次に始まるもの）。
 * どれも終わっていれば null。
 */
export function focusPeriod(periods: number[], now: Date): { period: number; state: 'current' | 'before' } | null {
  const sorted = [...periods].sort((a, b) => a - b);
  const current = sorted.find((p) => periodState(p, now) === 'current');
  if (current) return { period: current, state: 'current' };
  const next = sorted.find((p) => periodState(p, now) === 'before');
  return next ? { period: next, state: 'before' } : null;
}

/** その週の月曜日（0:00）。土日は次の週の月曜日 */
export function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

export const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 今が何限か（見出し用）。1〜6限の授業時間中だけ「3限」を返し、それ以外（休み時間・昼休み・授業時間外・土日）は null */
export function currentPeriodLabel(now: Date): string | null {
  if (!weekdayOf(now)) return null;
  const n = minutesOf(now);
  const current = PERIODS.find((p) => n >= toMin(p.start) && n < toMin(p.end));
  return current ? `${current.period}限` : null;
}
