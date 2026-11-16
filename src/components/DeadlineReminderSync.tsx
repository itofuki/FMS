/* src/components/DeadlineReminderSync.tsx
 * 画面には何も描画しない。マイページを開いている間、未完了の課題一覧をサーバーに同期して
 * 締切リマインダー（notify-scheduler）の対象を最新に保つ。課題タブを開いていなくても動く。
 */
import { useMemo } from 'react';
import { useUnifiedAssignments } from '../hooks/useUnifiedAssignments';
import { useDeadlineSync } from '../hooks/useDeadlineSync';
import { toDeadlineSyncItems, type Subject } from '../lib/assignments';

export default function DeadlineReminderSync({ subjects }: { subjects: Subject[] }) {
  const { items, ready, userId } = useUnifiedAssignments(subjects);
  const syncItems = useMemo(() => toDeadlineSyncItems(items), [items]);

  // キャッシュ表示中・取得エラー中は同期しない（LMS課題が一覧から消えて通知されなくなるため）
  useDeadlineSync(userId, syncItems, ready);
  return null;
}
