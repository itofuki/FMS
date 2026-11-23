// supabase/functions/_shared/calendar.ts
// カレンダー購読（iCalendar / .ics）を組み立てる純粋関数。Deno / Vitest の両方から読み込める。
// 時刻はすべて UTC（末尾 Z）で書き出す。授業の時刻は JST で定義し、ここで UTC に直す。

import { LMS_BASE, PERIOD_TIMES } from "./reminders.ts";
import { applyExceptionsForDate, type ClassException, type TimetableRowLike } from "./exceptions.ts";

export { PERIOD_TIMES };


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
  /** イレギュラーな授業回（休講・時刻や教室の変更・補講） */
  exceptions?: ClassException[];
  /** 授業を何週間前から入れるか */
  weeksBefore?: number;
  /** 授業を何週間先まで入れるか */
  weeksAfter?: number;
}): string {
  const { now, classes, deadlines, exceptions = [], weeksBefore = 1, weeksAfter = 8 } = opts;
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

  // 授業: 今週の月曜から数えて weeksBefore 週前〜weeksAfter 週先まで、平日ごとにその日の授業を入れる。
  // その日のイレギュラーな授業回（休講・時刻や教室の変更・補講）があれば当てはめる（祝日は分からないため入ったままになる）
  const today = jstMidnight(now.getTime());
  const jstDow = new Date(today + JST_MS).getUTCDay(); // 0=日
  const monday = today - ((jstDow + 6) % 7) * DAY_MS;
  const hm = (v: string | null | undefined, fallback: [number, number]): [number, number] => {
    const m = v ? /^(\d{1,2}):(\d{2})/.exec(v) : null;
    return m ? [Number(m[1]), Number(m[2])] : fallback;
  };
  for (let w = -weeksBefore; w < weeksAfter; w++) {
    for (let i = 0; i < 5; i++) {
      const day = monday + (w * 7 + i) * DAY_MS;
      const ymd = jstYmd(day);
      const date = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      const rows = applyExceptionsForDate(classes as TimetableRowLike[], exceptions, date);
      for (const c of rows) {
        const base = PERIOD_TIMES.find((p) => p.period === c.period);
        if (!base) continue;
        // 管理者が調整した時刻（イレギュラーな授業回の時刻を含む）があればそれを使う
        const time = { start: hm(c.start_time, base.start), end: hm(c.end_time, base.end) };
        // 臨時授業（id が負の数）は LMS にないので、リンクを付けない
        const personal = Number(c.id) < 0;
        const url = personal ? "" : c.attendance_id
          ? `${LMS_BASE}/mod/attendance/view.php?id=${c.attendance_id}`
          : `${LMS_BASE}/course/view.php?id=${String(c.id).split("-")[0]}`;
        const label = personal ? "（臨時）" : c.exception === "extra" ? "（補講）" : c.exception === "change" ? "（変更）" : "";
        const desc = [c.exception_note ?? "", c.teacher ? `担当: ${c.teacher}` : "", url].filter(Boolean).join("\n");
        lines.push(
          "BEGIN:VEVENT",
          `UID:class-${String(c.id)}-${ymd}-${c.period}@fms-iput.app`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${icsTime(atJst(day, time.start))}`,
          `DTEND:${icsTime(atJst(day, time.end))}`,
          `SUMMARY:${escapeText(`${c.period}限 ${c.name}${label}`)}`,
          ...(c.classroom ? [`LOCATION:${escapeText(c.classroom)}`] : []),
          `DESCRIPTION:${escapeText(desc)}`,
          ...(url ? [`URL:${url}`] : []),
          "CATEGORIES:授業",
          "TRANSP:OPAQUE",
          "END:VEVENT",
        );
      }
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
