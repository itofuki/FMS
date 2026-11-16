/* src/components/DeadlineReminderSync.tsx
 * 画面には何も描画しない。マイページを開いている間、未完了の課題一覧をサーバーに同期して
 * 締切リマインダー（notify-scheduler）の対象を最新に保つ。課題タブを開いていなくても動く。
 */
import { useMemo } from 'react';
import { useCurrentUser } from '../hooks/useUserProfile';
import { useLmsEvents } from '../hooks/useLmsEvents';
import { useDbAssignments, useDbSubjects, useLmsStatuses } from '../hooks/useAssignmentSources';
import { useDeadlineSync } from '../hooks/useDeadlineSync';
import { mergeAssignments, toDeadlineSyncItems, type Subject } from '../lib/assignments';

export default function DeadlineReminderSync({ subjects }: { subjects: Subject[] }) {
  const { data: currentUser } = useCurrentUser();
  const assignments = useDbAssignments();
  const dbSubjects = useDbSubjects();
  const lmsStatuses = useLmsStatuses(currentUser?.id);
  const lms = useLmsEvents();

  const items = useMemo(() => toDeadlineSyncItems(mergeAssignments({
    assignments: assignments.data ?? [],
    lmsEvents: lms.data ?? [],
    dbSubjects: dbSubjects.data ?? [],
    subjects,
    lmsStatuses: lmsStatuses.data ?? [],
    officialOnly: false,
  })), [assignments.data, lms.data, dbSubjects.data, subjects, lmsStatuses.data]);

  // キャッシュ表示中・取得エラー中は同期しない（LMS課題が一覧から消えて通知されなくなるため）
  const ready = assignments.isSuccess && dbSubjects.isSuccess && lmsStatuses.isSuccess
    && (!lms.hasLmsSession || (lms.isSuccess && !lms.isPlaceholderData));

  useDeadlineSync(currentUser?.id, items, ready);
  return null;
}
