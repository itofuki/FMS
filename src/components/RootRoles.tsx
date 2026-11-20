/* src/components/RootRoles.tsx
 * 設定の「開発者」タブの「権限の管理」。開発者（root）のアカウントだけに出す。
 * 画面では admin を「管理者」、root を「開発者」と呼ぶ（設定のタブ名・課題の「管理者モード」とそろえる）。
 * アカウントを名前か LMS の ID で探し、admin の権限を付けたり外したりする（root_set_admin）。
 * root 自体はアプリからは付けられない（SQL Editor で付ける）。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabaseClient';

type Account = { user_id: string; full_name: string | null; lms_username: string | null; role: string | null; is_root: boolean };

export default function RootRoles() {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<Account[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    const { data, error } = await supabase.rpc('root_list_users', { p_query: q });
    if (error) {
      toast.error(`アカウントを読めませんでした: ${error.message}`);
      setUsers([]);
      return;
    }
    setUsers((data ?? []) as Account[]);
  }, []);

  // 入力が止まってから探す
  useEffect(() => {
    const t = window.setTimeout(() => load(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query, load]);

  const setAdmin = async (u: Account, admin: boolean) => {
    const who = u.full_name || u.lms_username || 'このアカウント';
    if (!window.confirm(admin ? `${who} を管理者にしますか？` : `${who} を管理者から外しますか？`)) return;
    setBusy(u.user_id);
    const { error } = await supabase.rpc('root_set_admin', { p_user_id: u.user_id, p_admin: admin });
    setBusy(null);
    if (error) {
      toast.error(`変更できませんでした: ${error.message}`);
      return;
    }
    await load(query.trim());
  };

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="名前か LMS の ID で探す"
        className="w-full h-10 bg-surface border border-line-strong rounded-md px-3 text-sm text-fg"
      />
      {users === null ? (
        <p className="text-sm text-fg-muted">読み込み中...</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-fg-muted">見つかりませんでした。</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-lg">
          {users.map((u) => {
            const isAdmin = u.role === 'admin';
            return (
              <li key={u.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-fg truncate">{u.full_name || '（名前なし）'}</p>
                  <p className="text-sm text-fg-muted truncate">{u.lms_username ? `@${u.lms_username}` : '（LMS 以外のアカウント）'}</p>
                </div>
                <div className="flex-shrink-0 flex items-center gap-2">
                  {u.is_root && <span className="inline-flex items-center h-5 px-2 rounded-full bg-down-soft text-down text-xs font-bold"><span className="pill-text">開発者</span></span>}
                  {!u.is_root && isAdmin && <span className="inline-flex items-center h-5 px-2 rounded-full bg-warn-soft text-warn text-xs font-bold"><span className="pill-text">管理者</span></span>}
                  {!u.is_root && (
                    <button
                      type="button"
                      onClick={() => setAdmin(u, !isAdmin)}
                      disabled={busy === u.user_id}
                      className={`inline-flex items-center h-8 px-3 rounded-full border text-xs font-bold transition-colors disabled:opacity-50 ${isAdmin ? 'border-down/50 text-down hover:bg-down-soft' : 'border-line-strong text-fg hover:bg-surface-3'}`}
                    >
                      {/* Mantine の CSS が button の文字の大きさを上書きするため、span で指定する */}
                      <span className="pill-text text-xs font-bold">{isAdmin ? '管理者から外す' : '管理者にする'}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-fg-subtle">管理者は、公式課題の追加と、コースの既定値（曜日・時限・教室・担当の先生）の設定ができます。開発者の権限はアプリからは付けられません。</p>
    </div>
  );
}
