// supabase/functions/_shared/calendar.ts
// カレンダー購読（iCalendar / .ics）を組み立てる純粋関数。Deno / Vitest の両方から読み込める。
// 時刻はすべて UTC（末尾 Z）で書き出す。授業の時刻は JST で定義し、ここで UTC に直す。

import { LMS_BASE, PERIOD_TIMES } from "./reminders.ts";

export { PERIOD_TIMES };


const WDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_MS = 9 * 60 * 60 * 1000;

export type CalendarClass = {
  id: number | string;
  name: string;
  wday: string;
  period: number;
  classroom?: string | null;
  teacher?: string | null;
  attendance_id?: number | null;
  /** 管理者が調整した開始・終了の時刻（'HH:MM'）。null なら時限の本来の時刻 */
  start_time?: string | null;
  end_time?: string | null;
};

export type CalendarDeadline = { uid: string; title: string; deadline: string; url?: string | null };

/** iCalendar の TEXT 用のエスケープ */
export const escapeText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** 1 行 75 オクテットで折り返す（続きの行は空白 1 つで始める） */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    const limit = out.length === 0 ? 75 : 74;
    if (enc.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** UTC の Date を 20261117T041500Z の形に */
export const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** JST の「その日の 0 時」を表す UTC のミリ秒（日付は JST で数える） */
const jstMidnight = (ms: number) => Math.floor((ms + JST_MS) / DAY_MS) * DAY_MS - JST_MS;

/** JST のある日の h:m を UTC の Date に */
const atJst = (dayStartMs: number, [h, m]: [number, number]) => new Date(dayStartMs + (h * 60 + m) * 60000);

/** JST の日付 YYYYMMDD（UID 用） */
const jstYmd = (dayStartMs: number) => new Date(dayStartMs + JST_MS).toISOString().slice(0, 10).replace(/-/g, "");

export function buildCalendar(opts: {
  now: Date;
  classes: CalendarClass[];
  deadlines: CalendarDeadline[];
  /** 授業を何週間前から入れるか */
  weeksBefore?: number;
  /** 授業を何週間先まで入れるか */
  weeksAfter?: number;
}): string {
  const { now, classes, deadlines, weeksBefore = 1, weeksAfter = 8 } = opts;
  const stamp = icsTime(now);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FMS//Timetable and deadlines//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:FMS",
    "X-WR-TIMEZONE:Asia/Tokyo",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  // 授業: 今週の月曜から数えて weeksBefore 週前〜weeksAfter 週先まで、毎週の授業を 1 件ずつ入れる
  // （休講・祝日は分からないため入ったままになる）
  const today = jstMidnight(now.getTime());
  const jstDow = new Date(today + JST_MS).getUTCDay(); // 0=日
  const monday = today - ((jstDow + 6) % 7) * DAY_MS;
  for (let w = -weeksBefore; w < weeksAfter; w++) {
    for (const c of classes) {
      const idx = WDAY_INDEX[c.wday];
      const base = PERIOD_TIMES.find((p) => p.period === c.period);
      if (!idx || !base) continue;
      // 管理者が調整した時刻があればそれを使う
      const hm = (v: string | null | undefined, fallback: [number, number]): [number, number] => {
        const m = v ? /^(\d{1,2}):(\d{2})/.exec(v) : null;
        return m ? [Number(m[1]), Number(m[2])] : fallback;
      };
      const time = { start: hm(c.start_time, base.start), end: hm(c.end_time, base.end) };
      const day = monday + (w * 7 + idx - 1) * DAY_MS;
      const url = c.attendance_id
        ? `${LMS_BASE}/mod/attendance/view.php?id=${c.attendance_id}`
        : `${LMS_BASE}/course/view.php?id=${String(c.id).split("-")[0]}`;
      const desc = [c.teacher ? `担当: ${c.teacher}` : "", url].filter(Boolean).join("\n");
      lines.push(
        "BEGIN:VEVENT",
        `UID:class-${String(c.id)}-${jstYmd(day)}-${c.period}@fms-iput.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${icsTime(atJst(day, time.start))}`,
        `DTEND:${icsTime(atJst(day, time.end))}`,
        `SUMMARY:${escapeText(`${c.period}限 ${c.name}`)}`,
        ...(c.classroom ? [`LOCATION:${escapeText(c.classroom)}`] : []),
        `DESCRIPTION:${escapeText(desc)}`,
        `URL:${url}`,
        "CATEGORIES:授業",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
    }
  }

  // 締切: 締切の時刻ちょうどの予定（長さ 0）として入れる。予定の時間帯を埋めないよう TRANSPARENT にする
  for (const d of deadlines) {
    const at = new Date(d.deadline);
    if (Number.isNaN(at.getTime())) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:deadline-${d.uid.replace(/[^A-Za-z0-9_-]/g, "_")}@fms-iput.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTime(at)}`,
      `DTEND:${icsTime(at)}`,
      `SUMMARY:${escapeText(`締切: ${d.title}`)}`,
      ...(d.url ? [`URL:${d.url}`, `DESCRIPTION:${escapeText(d.url)}`] : []),
      "CATEGORIES:締切",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
