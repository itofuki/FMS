/* src/lib/debugAttend.ts
 * 出席の入力の見た目を試すための表示（この端末の画面だけ。LMS には何も送らない）。
 *   URL に ?debugAttend=1 を付けて開くと、次の授業（または授業中の授業）に「出席受付中」とパスワードの欄が出る。
 *   パスワード「test」で「出席済み」、それ以外で「パスワードが違います」になる。?debugAttend=off で解除。
 *   タブを閉じても解除される（sessionStorage）。
 */
import type { OpenSession, SessionForm } from './attendanceMark';

const KEY = 'fms_debug_attend';

function read(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('debugAttend');
    if (param === 'off') sessionStorage.removeItem(KEY);
    else if (param) sessionStorage.setItem(KEY, '1');
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let on = read();

/** 出席の見た目を試しているか */
export const isDebugAttend = () => on;

/** 試すのをやめる */
export function clearDebugAttend() {
  on = false;
  try { sessionStorage.removeItem(KEY); } catch { /* noop */ }
}

/** 試すときの「受け付け中の回」 */
export const debugOpenSession = (cmid: number, courseid: number): { session: OpenSession; form: SessionForm } => ({
  session: { cmid, courseid, sessid: 0, label: '（テスト）9:30AM - 9:50AM' },
  form: { needsPassword: true, statuses: [] },
});

/** 試すときの送信（LMS には送らない）。「test」なら出席済み */
export const debugSubmit = async (password: string) => {
  await new Promise((r) => setTimeout(r, 600));
  return password === 'test' ? ({ ok: true } as const) : ({ ok: false, reason: 'password' } as const);
};
