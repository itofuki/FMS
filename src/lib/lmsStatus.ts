/* src/lib/lmsStatus.ts
 * 画面の裏で LMS に問い合わせる処理（出席率・コースの同期）が失敗したかどうかを、画面に知らせるための小さな入れ物。
 * 時間割は失敗しても前回の内容で表示を続けるので、ここを見て「更新できませんでした」とだけ伝える。
 */
import { useSyncExternalStore } from 'react';

export type LmsIssue = 'expired' | 'failed';

let issue: LmsIssue | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** LMS のエラーを、トークン切れ（再ログインが必要）とそれ以外に分ける */
export function classifyLmsError(e: unknown): LmsIssue {
  const msg = e instanceof Error ? e.message : String(e);
  return /invalidtoken|accessdenied|TOKEN_EXPIRED/i.test(msg) ? 'expired' : 'failed';
}

export function reportLmsIssue(e: unknown) {
  const next = classifyLmsError(e);
  // トークン切れのほうを優先して残す
  if (issue === 'expired' && next === 'failed') return;
  issue = next;
  emit();
}

export function clearLmsIssue() {
  if (issue === null) return;
  issue = null;
  emit();
}

export function useLmsIssue(): LmsIssue | null {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => issue,
  );
}
