/* src/lib/attendanceMark.ts
 * LMS の出欠に、パスワードで自分の出席を入れる（Open LMS のアプリの「出席を送信」と同じ流れ）。
 *   1. findOpenSessions : 出欠の画面（mobile_view_activity）から、いま受け付けている回（「出席を送信」ボタン）を探す
 *   2. fetchSessionForm : その回の入力画面（mobile_user_form）を読み、パスワードの欄と出欠の状態の選択肢を知る（読むだけ）
 *   3. submitAttendance : アプリと同じ値（cmid・courseid・sessid・status・studentpass）を mobile_view_activity に送る。
 *      送ったあと出欠の画面を読み直し、その回のボタンが消えていれば記録できたとみなす
 * 3 だけが LMS の正式な出欠に書き込む。本人が「送信」を押したときだけ呼ぶ。
 */
import { LMS_BASE } from './lms';

export type OpenSession = { cmid: number; courseid: number; sessid: number; timestamp?: number; label: string };
export type SessionForm = { needsPassword: boolean; statuses: { id: string; label: string }[] };
export type SubmitResult = { ok: true } | { ok: false; reason: 'password' | 'unknown'; message?: string };

async function getContent(token: string, method: string, args: Record<string, string | number>) {
  const body = new URLSearchParams({
    wstoken: token, wsfunction: 'tool_mobile_get_content', moodlewsrestformat: 'json',
    component: 'mod_attendance', method,
  });
  Object.entries(args).forEach(([k, v], i) => {
    body.set(`args[${i}][name]`, k);
    body.set(`args[${i}][value]`, String(v));
  });
  const res = await fetch(`${LMS_BASE}/webservice/rest/server.php`, { method: 'POST', body });
  const data = await res.json();
  if (data?.exception) throw new Error(`${data.errorcode}: ${data.message}`);
  return ((data?.templates ?? []) as { html?: string }[]).map((t) => t.html ?? '').join('\n');
}

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim();

/** 出欠の画面の HTML から、受け付け中の回（「出席を送信」ボタン）を取り出す */
export function parseOpenSessions(html: string): OpenSession[] {
  const out: OpenSession[] = [];
  // 回ごとに <ion-item> の中に、日時（h2）とボタンがある
  for (const item of html.split(/<ion-item\b/i)) {
    const m = item.match(/method="mobile_user_form"\s+\[args\]="\{([^}]*)\}"/);
    if (!m) continue;
    const args: Record<string, number> = {};
    for (const kv of m[1].split(',')) {
      const [k, v] = kv.split(':').map((x) => x.trim());
      if (k && v && /^\d+$/.test(v)) args[k] = Number(v);
    }
    if (!args.cmid || !args.courseid || !args.sessid) continue;
    const h2 = item.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    out.push({ cmid: args.cmid, courseid: args.courseid, sessid: args.sessid, timestamp: args.timestamp, label: h2 ? plain(h2[1]) : '' });
  }
  return out;
}

/** 入力画面の HTML から、パスワードの欄があるかと、出欠の状態の選択肢を取り出す */
export function parseSessionForm(html: string): SessionForm {
  const statuses: SessionForm['statuses'] = [];
  for (const item of html.split(/<ion-item\b/i)) {
    const radio = item.match(/<ion-radio\b[^>]*value="([^"]+)"/i);
    if (!radio) continue;
    const label = item.match(/<ion-label[^>]*>([\s\S]*?)<\/ion-label>/i);
    statuses.push({ id: radio[1], label: label ? plain(label[1]) : radio[1] });
  }
  return { needsPassword: /name="studentpass"/.test(html), statuses };
}

/** いま受け付けている回（なければ空） */
export async function findOpenSessions(token: string, cmid: number, courseid: number): Promise<OpenSession[]> {
  return parseOpenSessions(await getContent(token, 'mobile_view_activity', { cmid, courseid }));
}

/** 回の入力画面を読む（読むだけ。出席は送らない） */
export async function fetchSessionForm(token: string, s: OpenSession): Promise<SessionForm> {
  const args: Record<string, number> = { cmid: s.cmid, courseid: s.courseid, sessid: s.sessid };
  if (s.timestamp) args.timestamp = s.timestamp;
  return parseSessionForm(await getContent(token, 'mobile_user_form', args));
}

/**
 * 出席を送る（LMS の正式な出欠に書き込む）。アプリと同じく、選択肢がない回は status を付けない
 * （LMS が自動で状態を決める）。送ったあと読み直して、その回のボタンが消えたかで結果を決める
 */
export async function submitAttendance(token: string, s: OpenSession, form: SessionForm, input: { password: string; status?: string }): Promise<SubmitResult> {
  const args: Record<string, string | number> = { cmid: s.cmid, courseid: s.courseid, sessid: s.sessid };
  if (input.status) args.status = input.status;
  if (form.needsPassword) args.studentpass = input.password;
  const res = await getContent(token, 'mobile_view_activity', args);
  const still = (await findOpenSessions(token, s.cmid, s.courseid)).some((x) => x.sessid === s.sessid);
  if (!still) return { ok: true };
  if (/incorrectpassword|パスワード.*(違|正しく)/i.test(res)) return { ok: false, reason: 'password' };
  return { ok: false, reason: 'unknown' };
}

/** 出席ページの URL（…/mod/attendance/view.php?id=123）から cmid を取り出す */
export function cmidFromUrl(url: string | null | undefined): number | null {
  const m = url?.match(/\/mod\/attendance\/view\.php\?(?:.*&)?id=(\d+)/);
  return m ? Number(m[1]) : null;
}
