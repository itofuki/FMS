// supabase/functions/_shared/reminders.ts
// 通知タイミングの判定ロジック（純粋関数のみ。Deno / Vitest の両方から読み込める）

export const LMS_BASE = "https://lms-tokyo.iput.ac.jp";

// 時限ごとの開始・終了時刻（JST）。サーバー側（通知・カレンダー購読）はここだけを見る。
// 画面側の src/lib/schedule.ts の PERIODS と同じであること（src/lib/periods.test.ts で確かめている）
export const PERIOD_TIMES: { period: number; start: [number, number]; end: [number, number] }[] = [
  { period: 1, start: [9, 15], end: [10, 55] },
  { period: 2, start: [10, 55], end: [12, 25] },
  { period: 3, start: [13, 20], end: [14, 50] },
  { period: 4, start: [15, 0], end: [16, 30] },
  { period: 5, start: [16, 40], end: [18, 10] },
  { period: 6, start: [18, 20], end: [19, 50] },
];

export const PERIOD_STARTS: { period: number; h: number; m: number }[] =
  PERIOD_TIMES.map((p) => ({ period: p.period, h: p.start[0], m: p.start[1] }));

export const CLASS_LEAD_MINUTES = 5;

const HOUR_MS = 60 * 60 * 1000;
const WDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** 締切まで残り hours 時間以内（かつ締切前）なら通知対象 */
export function isDeadlineReminderDue(deadlineMs: number, nowMs: number, hours: number): boolean {
  const remaining = deadlineMs - nowMs;
  return remaining > 0 && remaining <= hours * HOUR_MS;
}

/** 残り時間を「約◯日 / 約◯時間 / 約◯分」で表す */
export function formatRemaining(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) return `約${minutes}分`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `約${hours}時間`;
  return `約${Math.round(hours / 24)}日`;
}

/** UTC の時刻を JST の日付・曜日・0時からの分に変換する */
export function toJst(now: Date): { date: string; wday: (typeof WDAYS)[number]; minutes: number } {
  const jst = new Date(now.getTime() + 9 * HOUR_MS);
  const date = jst.toISOString().slice(0, 10);
  return { date, wday: WDAYS[jst.getUTCDay()], minutes: jst.getUTCHours() * 60 + jst.getUTCMinutes() };
}

/**
 * 「開始 CLASS_LEAD_MINUTES 分前 〜 開始時刻」の間にある時限を返す（平日のみ）。
 * cron は毎分動くため、この幅の中で一度でも実行されれば通知できる（重複は notification_log で防ぐ）。
 */
export function upcomingPeriod(now: Date): { period: number; date: string; wday: string; startLabel: string } | null {
  const { date, wday, minutes } = toJst(now);
  if (wday === "Sat" || wday === "Sun") return null;
  for (const p of PERIOD_STARTS) {
    const start = p.h * 60 + p.m;
    if (minutes >= start - CLASS_LEAD_MINUTES && minutes < start) {
      return { period: p.period, date, wday, startLabel: `${p.h}:${String(p.m).padStart(2, "0")}` };
    }
  }
  return null;
}

/** 'HH:MM' を 0 時からの分に（読めなければ null） */
export function hmToMinutes(v: string | null | undefined): number | null {
  const m = v ? /^(\d{1,2}):(\d{2})/.exec(v) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 授業の開始・終了（0 時からの分）。管理者が調整した時刻があればそれ、なければ時限の本来の時刻 */
export function classMinutes(row: { period: number; start_time?: string | null; end_time?: string | null }): { start: number; end: number } | null {
  const p = PERIOD_TIMES.find((x) => x.period === row.period);
  if (!p) return null;
  return {
    start: hmToMinutes(row.start_time) ?? p.start[0] * 60 + p.start[1],
    end: hmToMinutes(row.end_time) ?? p.end[0] * 60 + p.end[1],
  };
}

const minutesLabel = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;

/**
 * 今日の授業のうち、「開始 CLASS_LEAD_MINUTES 分前 〜 開始時刻」の間にあるものを返す（平日のみ）。
 * 開始時刻は授業ごと（管理者が調整した時刻があればそれ）。
 * 続けて行う授業でも、時限ごとに出席を入力するので、どの時限の前も対象にする。
 */
export function dueClasses<T extends { id: number; wday: string; period: number; start_time?: string | null; end_time?: string | null }>(
  now: Date, rows: T[],
): { row: T; date: string; startLabel: string }[] {
  const { date, wday, minutes } = toJst(now);
  if (wday === "Sat" || wday === "Sun") return [];
  const today = rows.filter((r) => r.wday === wday);
  const result: { row: T; date: string; startLabel: string }[] = [];
  for (const r of today) {
    const t = classMinutes(r);
    if (!t) continue;
    if (minutes >= t.start - CLASS_LEAD_MINUTES && minutes < t.start) result.push({ row: r, date, startLabel: minutesLabel(t.start) });
  }
  return result;
}

/**
 * 今が、どれかの授業の開始 CLASS_LEAD_MINUTES 分前〜開始時刻の間か（平日のみ）。
 * 本来の時限の開始と、管理者が調整した開始時刻（extraStarts: 'HH:MM'）の両方を見る。
 * 当てはまらないときは、全員の時間割を読まずに済ませるために使う。
 */
export function isNearAnyClassStart(now: Date, extraStarts: (string | null | undefined)[]): boolean {
  const { wday, minutes } = toJst(now);
  if (wday === "Sat" || wday === "Sun") return false;
  const starts = [
    ...PERIOD_STARTS.map((p) => p.h * 60 + p.m),
    ...extraStarts.map(hmToMinutes).filter((v): v is number => v !== null),
  ];
  return starts.some((st) => minutes >= st - CLASS_LEAD_MINUTES && minutes < st);
}

/** 授業のLMSページ（出席IDがあれば出席ページ） */
export function classUrl(subjectId: number, attendanceId?: number | null): string {
  return attendanceId
    ? `${LMS_BASE}/mod/attendance/view.php?id=${attendanceId}`
    : `${LMS_BASE}/course/view.php?id=${subjectId}`;
}
