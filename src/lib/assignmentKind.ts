/* src/lib/assignmentKind.ts
 * 課題の種類（公式課題 / 個人課題）と、その色。課題の一覧（科目名の色）とカレンダー（●の色）で同じ色を使う。
 *   公式課題（LMS の課題を含む）= アプリの基本色（青緑）、個人課題 = 紫（「注意」の意味を持たない落ち着いた色）
 */
import type { UnifiedAssignment } from './assignments';

export type AssignmentKind = 'official' | 'private';

export const kindOf = (a: Pick<UnifiedAssignment, 'isLms' | 'classification'>): AssignmentKind =>
  (a.isLms || a.classification === 'official' ? 'official' : 'private');

export const KIND_STYLE: Record<AssignmentKind, { text: string; dot: string; label: string }> = {
  official: { text: 'text-accent', dot: 'bg-accent', label: '公式課題（LMS を含む）' },
  private: { text: 'text-violet-600 dark:text-violet-300', dot: 'bg-violet-500 dark:bg-violet-400', label: '個人課題' },
};
