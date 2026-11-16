/* src/hooks/useAssignmentSources.ts
 * 課題一覧の元データ（DB課題・科目・LMS課題の手動ステータス）を取得するクエリ。
 * 課題タブと、バックグラウンドの締切リマインダー同期で同じキャッシュを共有する。
 *
 * エラー時は空配列を返さず throw する（空配列を「課題0件」と区別できなくなり、
 * 同期時に締切リマインダーが全部消えてしまうため）。
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import type { Assignment, DbSubject, LmsStatus } from '../lib/assignments';

export function useDbAssignments() {
  return useQuery<Assignment[]>({
    queryKey: ['assignments'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_assignments');
      if (error) {
        console.error('Error fetching assignments:', error);
        throw error;
      }
      return data as Assignment[];
    },
  });
}

export function useDbSubjects() {
  return useQuery<DbSubject[]>({
    queryKey: ['dbSubjects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subjects')
        .select(`
          id,
          category_code,
          subject_classes (subject_id),
          subject_departments (subject_id),
          subject_courses (subject_id)
        `);
      if (error) {
        console.error('subjectsテーブルのJOIN取得エラー:', error);
        throw error;
      }
      return data as DbSubject[];
    },
  });
}

export function useLmsStatuses(userId: string | undefined) {
  return useQuery<LmsStatus[]>({
    queryKey: ['lmsStatuses', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('lms_assignment_status').select('lms_uid, done').eq('user_id', userId!);
      if (error) throw error;
      return data as LmsStatus[];
    },
    enabled: !!userId,
  });
}
