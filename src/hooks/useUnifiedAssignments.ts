/* src/hooks/useUnifiedAssignments.ts
 * DB の課題と LMS の課題をまとめた一覧（課題ページと同じもの）を返す。
 * 時間割の「この科目の課題 N 件」「今日締切の課題」や、締切リマインダーの同期で使う。
 * React Query のキャッシュを共有するので、複数の画面で使っても通信は増えない。
 */
import { useMemo } from 'react';
import { useCurrentUser } from './useUserProfile';
import { useLmsEvents } from './useLmsEvents';
import { useDbAssignments, useDbSubjects, useLmsStatuses } from './useAssignmentSources';
import { mergeAssignments, type Subject } from '../lib/assignments';

export function useUnifiedAssignments(subjects: Subject[]) {
  const { data: currentUser } = useCurrentUser();
  const assignments = useDbAssignments();
  const dbSubjects = useDbSubjects();
  const lmsStatuses = useLmsStatuses(currentUser?.id);
  const lms = useLmsEvents();

  const items = useMemo(() => mergeAssignments({
    assignments: assignments.data ?? [],
    lmsEvents: lms.data ?? [],
    dbSubjects: dbSubjects.data ?? [],
    subjects,
    lmsStatuses: lmsStatuses.data ?? [],
    officialOnly: false,
  }), [assignments.data, lms.data, dbSubjects.data, subjects, lmsStatuses.data]);

  // キャッシュ表示中・取得エラー中は「確定した一覧」とみなさない
  const ready = assignments.isSuccess && dbSubjects.isSuccess && lmsStatuses.isSuccess
    && (!lms.hasLmsSession || (lms.isSuccess && !lms.isPlaceholderData));

  return { items, ready, userId: currentUser?.id };
}
