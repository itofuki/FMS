/* src/hooks/useDeadlineSync.ts
 * 未完了の課題一覧をサーバー（user_deadlines）に同期し、締切リマインダーの対象にする。
 * LMS のトークンはサーバーに置かない方針のため、アプリで課題を取得したタイミングで同期する。
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { DeadlineSyncItem } from '../lib/assignments';

const DEBOUNCE_MS = 2000;

/**
 * @param items 同期する項目
 * @param ready データが確定しているときだけ true（キャッシュ表示中や取得エラー中に同期すると、
 *              LMS課題が一覧から消えて通知されなくなるため）
 */
export function useDeadlineSync(userId: string | undefined, items: DeadlineSyncItem[], ready: boolean) {
  const lastSynced = useRef<string | null>(null);
  const serialized = JSON.stringify(items);

  useEffect(() => {
    if (!userId || !ready || serialized === lastSynced.current) return;

    const timer = window.setTimeout(async () => {
      const { error } = await supabase.rpc('sync_user_deadlines', { p_items: JSON.parse(serialized) });
      if (error) {
        console.error('締切リマインダーの同期に失敗しました:', error);
        return;
      }
      lastSynced.current = serialized;
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [userId, ready, serialized]);
}
