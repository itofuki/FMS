/* src/lib/dbError.ts
 * Supabase（データベース）のエラーを、画面に出せる短い文にする。
 * 権限のエラー（RLS で拒否）のときだけ「権限がありません」とし、それ以外は中身（message・details・code）を出す。
 */
export function dbErrorText(error: unknown): string {
  const e = error as { message?: string; details?: string; hint?: string; code?: string } | null;
  if (e?.code === '42501' || /row-level security/i.test(e?.message ?? '')) return '権限がありません';
  const text = [e?.message, e?.details, e?.hint, e?.code && `(${e.code})`].filter(Boolean).join(' ');
  return text || String(error);
}
