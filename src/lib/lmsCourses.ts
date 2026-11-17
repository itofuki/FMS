/* src/lib/lmsCourses.ts
 * 今学期の自分のコースを LMS から取り、時間割の材料にする（Open LMS アプリと同じ機能を使う。読み出しのみ）。
 *
 * コース名の例: 「グローバル市場化戦略A（2026_火曜3・4限_IA3A/IA3B）」→ 名前・曜日・時限を読み取る。
 * 曜日・時限が書かれていないコース（「ソリューション開発ⅠB（2026_三宅）」など）は wday/periods を null にし、
 * 設定画面で手で入れてもらう。教室は LMS にないため、これも設定で入れる。
 */
import { LMS_BASE } from './lms';

export type LmsCourse = {
  course_id: number;
  /** 括弧より前の表示名 */
  name: string;
  fullname: string;
  wday: string | null;
  periods: number[] | null;
  teachers: string[];
  /** 出欠ページ（mod_attendance）の id。複数あれば最初のもの */
  attendance_id: number | null;
};

const WDAY: Record<string, string> = { 月: 'Mon', 火: 'Tue', 水: 'Wed', 木: 'Thu', 金: 'Fri' };

/** コース名から、表示名・曜日・時限を読み取る */
export function parseCourseName(fullname: string): { name: string; wday: string | null; periods: number[] | null } {
  const name = fullname.replace(/\s*[（(].*$/, '').trim() || fullname.trim();
  const m = fullname.match(/([月火水木金])曜\s*([0-9０-９・･,、\s]+)\s*限/);
  if (!m) return { name, wday: null, periods: null };
  const periods = [...m[2].matchAll(/[0-9０-９]/g)]
    .map((d) => Number(String.fromCharCode(d[0].charCodeAt(0) >= 0xff10 ? d[0].charCodeAt(0) - 0xfee0 : d[0].charCodeAt(0))))
    .filter((p) => p >= 1 && p <= 6);
  const unique = [...new Set(periods)].sort((a, b) => a - b);
  return { name, wday: WDAY[m[1]], periods: unique.length ? unique : null };
}

/** 「machide.tomoya 町出（全角空白）智也」→「町出 智也」。ローマ字のログイン ID が先頭にあれば外す */
export function cleanTeacherName(raw: string): string {
  return raw.replace(/^[a-z0-9_-]+\.[a-z0-9._-]+\s+/i, '').replace(/[\s\u3000]+/g, ' ').trim();
}

type WsCall = (wsfunction: string, params?: Record<string, string>) => Promise<unknown>;

const makeCall = (token: string): WsCall => async (wsfunction, params = {}) => {
  const body = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: 'json', ...params });
  const res = await fetch(`${LMS_BASE}/webservice/rest/server.php`, { method: 'POST', body });
  const data = await res.json();
  if (data && typeof data === 'object' && 'exception' in data) {
    const e = data as { errorcode?: string; message?: string };
    throw new Error(`${e.errorcode}: ${e.message}`);
  }
  return data;
};

/** 今学期（終了日を過ぎていない）の自分のコースを LMS から取る */
export async function fetchLmsCourses(token: string, userId: number, now = new Date()): Promise<LmsCourse[]> {
  const call = makeCall(token);
  type Enrolled = { id: number; fullname: string; enddate?: number; hidden?: boolean };
  const enrolled = ((await call('core_enrol_get_users_courses', { userid: String(userId) })) as Enrolled[])
    .filter((c) => !c.hidden && (!c.enddate || c.enddate * 1000 > now.getTime()));
  if (enrolled.length === 0) return [];

  type ByField = { courses?: { id: number; contacts?: { fullname: string }[] }[] };
  const info = (await call('core_course_get_courses_by_field', { field: 'ids', value: enrolled.map((c) => c.id).join(',') })) as ByField;
  const contacts = new Map((info.courses ?? []).map((c) => [c.id, (c.contacts ?? []).map((x) => cleanTeacherName(x.fullname))]));

  type Section = { modules?: { id: number; modname: string }[] };
  const attendanceIds = await Promise.all(enrolled.map(async (c) => {
    try {
      const sections = (await call('core_course_get_contents', {
        courseid: String(c.id), 'options[0][name]': 'excludecontents', 'options[0][value]': '1',
      })) as Section[];
      return sections.flatMap((s) => s.modules ?? []).find((m) => m.modname === 'attendance')?.id ?? null;
    } catch {
      return null;
    }
  }));

  return enrolled.map((c, i) => ({
    course_id: c.id,
    fullname: c.fullname,
    ...parseCourseName(c.fullname),
    teachers: contacts.get(c.id) ?? [],
    attendance_id: attendanceIds[i],
  }));
}
