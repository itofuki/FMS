/* src/lib/attendanceLog.ts
 * FMS から LMS の出欠に出席を送ったときの記録（不具合の調査用）。この端末にだけ、直近 20 件を残す。
 * パスワードとログイン用のトークンは残さない。残すのは、いつ・どの授業のどの回か・結果・LMS のエラー・
 * LMS の返事に含まれていた文言の名前・送る前と後の「記録された回の数」と「出席を送信」ボタンの有無。
 */

/** 出欠画面のようす（記録された回の数と、その回の「出席を送信」ボタンがあるか）。読めなかったら null */
export type ViewState = { completed: number | null; open: boolean } | null;

/** submitAttendance が返す、調査用のくわしい内容 */
export type SubmitDiag = {
  /** 送信に対して LMS が返したエラー（なければ null） */
  sendError: string | null;
  /** 送信の返事に含まれていた、LMS の文言の名前（例: attendancesuccess） */
  keys: string[];
  before: ViewState;
  after: ViewState;
};

export type AttendLogEntry = {
  at: string;
  course: string;
  cmid: number;
  sessid: number | null;
  result: 'ok' | 'password' | 'unknown' | 'error';
  /** 送信の前後で起きたエラー（LMS のエラー・通信のエラー） */
  error: string | null;
  diag: SubmitDiag | null;
};

const KEY = 'fms_attendance_log';
const MAX = 20;

export function readAttendLog(): AttendLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AttendLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function addAttendLog(entry: AttendLogEntry) {
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...readAttendLog()].slice(0, MAX)));
  } catch { /* 残せなくても出席には関係ない */ }
}

export function clearAttendLog() {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
