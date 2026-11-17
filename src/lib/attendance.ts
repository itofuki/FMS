/* src/lib/attendance.ts
 * LMS の出席プラグイン（mod_attendance）から、科目ごとの出席率を読む。
 *
 * LMS のアプリ（Open LMS）が「出欠」を開くときと同じく、tool_mobile_get_content で
 * アプリ用の画面（HTML）を取り、`{{ 'plugin.mod_attendance.<名前>' | translate }}` の直後にある値を拾う。
 * 表示の文言ではなく内部の名前を目印にするので、文言が変わっても壊れにくい。
 *
 * 注意: 取得するたびに LMS に「出欠を見た」閲覧記録が 1 件残る（アプリで開いたときと同じ）。
 *       そのため取得は 1 日 1 回にとどめ、結果は端末にキャッシュする。
 * 出席を付ける機能（mod_iledt_mark_attendance など）は呼ばない。
 */
import { LMS_BASE } from './lms';

export type AttendanceSummary = {
  /** 出欠が記録された回数 */
  completed: number;
  /** 予定されている回の合計 */
  total: number;
  /** 記録された回に対する出席率（%）。まだ 1 回も記録がなければ null */
  percent: number | null;
  /** 記録された回の得点（例: "3 / 3"） */
  points: string | null;
};

/** アプリ用の画面（HTML）から、内部の名前と値の組を取り出す */
export function parseAttendanceValues(html: string): Record<string, string> {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  const out: Record<string, string> = {};
  const re = /\{\{\s*'plugin\.mod_attendance\.(\w+)'\s*\|\s*translate\s*\}\}\s*([^{]*)/g;
  for (const m of text.matchAll(re)) {
    const value = m[2].replace(/\s+/g, ' ').trim();
    if (value && !(m[1] in out)) out[m[1]] = value;
  }
  return out;
}

const toInt = (v: string | undefined) => {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : null;
};
const toPercent = (v: string | undefined) => {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** 取り出した値を、画面で使う形にまとめる。必要な値がなければ null */
export function toAttendanceSummary(values: Record<string, string>): AttendanceSummary | null {
  const completed = toInt(values.sessionscompleted);
  const total = toInt(values.sessionstotal);
  if (completed === null || total === null) return null;
  return {
    completed,
    total,
    percent: completed > 0 ? toPercent(values.percentagesessionscompleted) : null,
    points: values.pointssessionscompleted ?? null,
  };
}

/** 1 科目分の出席率を LMS から取る。cmid は出欠ページの id、courseId はコースの id */
export async function fetchAttendanceSummary(token: string, cmid: number, courseId: number): Promise<AttendanceSummary | null> {
  const body = new URLSearchParams({
    wstoken: token,
    wsfunction: 'tool_mobile_get_content',
    moodlewsrestformat: 'json',
    component: 'mod_attendance',
    method: 'mobile_view_activity',
    'args[0][name]': 'cmid',
    'args[0][value]': String(cmid),
    'args[1][name]': 'courseid',
    'args[1][value]': String(courseId),
  });
  const res = await fetch(`${LMS_BASE}/webservice/rest/server.php`, { method: 'POST', body });
  const data = await res.json();
  if (data?.exception) throw new Error(`${data.errorcode}: ${data.message}`);
  const html = ((data?.templates ?? []) as { html?: string }[]).map((t) => t.html ?? '').join('\n');
  return toAttendanceSummary(parseAttendanceValues(html));
}
