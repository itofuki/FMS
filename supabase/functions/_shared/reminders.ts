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

/** 授業のLMSページ（出席IDがあれば出席ページ） */
export function classUrl(subjectId: number, attendanceId?: number | null): string {
  return attendanceId
    ? `${LMS_BASE}/mod/attendance/view.php?id=${attendanceId}`
    : `${LMS_BASE}/course/view.php?id=${subjectId}`;
}
