/* src/lib/assignments.ts
 * 課題表示まわりの型と純粋関数（UIから切り離してテスト可能にする）
 */
import { LMS_BASE } from './lms';
import { parseCourseName } from './lmsCourses';

export type Assignment = {
  id: number;
  name: string;
  deadline: string;
  done: boolean;
  classification: 'official' | 'private';
  user_id: string | null;
  subject_name: string | null;
  url: string | null;
};

export type Subject = { id: number; name: string };

export type DbSubject = {
  id: number;
  category_code: string;
  subject_classes: { subject_id: number }[];
  subject_departments: { subject_id: number }[];
  subject_courses: { subject_id: number }[];
};

export interface LmsAttachment {
  filename: string;
  url: string;
}

export type SubmissionStatus = 'submitted' | 'draft' | 'new' | null;

export interface LmsEvent {
  uid: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  categoryCode?: string;
  /** LMS のコースの id（時間割の授業の id と同じ番号）。古いキャッシュにはない */
  courseId?: number | null;
  /** LMS のコース名（時間割にないコースの科目名に使う）。古いキャッシュにはない */
  courseName?: string;
  url?: string;
  submissionStatus?: SubmissionStatus;
  attachments?: LmsAttachment[];
}

export type SubjectCategoryType = 'class' | 'department' | 'course' | 'none';

export type UnifiedAssignment = {
  id: number | string;
  name: string;
  deadline: string;
  done: boolean;
  classification: 'official' | 'private';
  user_id: string | null;
  subject_name: string | null;
  url: string | null;
  isLms: boolean;
  description?: string;
  subjectCategoryType: SubjectCategoryType;
  submissionStatus?: SubmissionStatus;
  attachments?: LmsAttachment[];
};

export type LmsStatus = { lms_uid: string; done: boolean };

const DAY_MS = 24 * 60 * 60 * 1000;

export const getDeadlineStatus = (deadlineDate: string, isDone: boolean, now: Date = new Date()) => {
  if (isDone) return { color: 'text-fg-subtle', label: '' };

  const diffTime = new Date(deadlineDate).getTime() - now.getTime();
  const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
  const diffDays = Math.ceil(diffTime / DAY_MS);

  if (diffTime < 0) return { color: 'text-down font-bold', label: '(期限切れ)' };

  if (diffHours < 24) {
    const hours = diffHours === 0 ? '1' : diffHours;
    return { color: 'text-down font-bold', label: `(あと ${hours} 時間)` };
  }

  return {
    color: diffDays <= 3 ? 'text-warn font-bold' : 'text-fg-muted',
    label: `(あと ${diffDays} 日)`,
  };
};

export const getSubjectCategoryType = (dbSub?: DbSubject): SubjectCategoryType => {
  if (!dbSub) return 'none';
  if (dbSub.subject_classes?.length > 0) return 'class';
  if (dbSub.subject_departments?.length > 0) return 'department';
  if (dbSub.subject_courses?.length > 0) return 'course';
  return 'none';
};

type MergeInput = {
  assignments: Assignment[];
  lmsEvents: LmsEvent[];
  dbSubjects: DbSubject[];
  subjects: Subject[];
  lmsStatuses: LmsStatus[];
  officialOnly: boolean;
  now?: Date;
};

/**
 * DBの手動課題とLMSの課題を1つのリストに統合する。
 * - LMS課題の完了状態は「手動チェック」を最優先し、未操作ならMoodleの提出状況を使う
 * - 期限切れから1日を過ぎたものは除外
 * - 未完了 → 期限が近い順 に並べる
 */
export function mergeAssignments({
  assignments, lmsEvents, dbSubjects, subjects, lmsStatuses, officialOnly, now = new Date(),
}: MergeInput): UnifiedAssignment[] {
  const dbUnified: UnifiedAssignment[] = assignments.map((a) => {
    const matchedSubject = subjects.find((s) => s.name === a.subject_name);
    const dbSub = matchedSubject ? dbSubjects.find((s) => s.id === matchedSubject.id) : undefined;
    return { ...a, isLms: false, subjectCategoryType: getSubjectCategoryType(dbSub) };
  });

  const statusByUid = new Map(lmsStatuses.map((s) => [s.lms_uid, s.done]));

  const lmsUnified: UnifiedAssignment[] = lmsEvents.map((event) => {
    const matched = dbSubjects.find(
      (s) => s.category_code && event.categoryCode && s.category_code === event.categoryCode,
    );
    // 科目は、コースの id で時間割の授業と結び付ける（なければ以前の科目の表とコースの略称で探す）
    const byCourse = event.courseId != null ? subjects.find((s) => s.id === event.courseId) : undefined;
    let eventUrl = '';
    if (event.url) eventUrl = event.url;
    else if (event.courseId != null) eventUrl = `${LMS_BASE}/course/view.php?id=${event.courseId}`;
    else if (matched) eventUrl = `${LMS_BASE}/course/view.php?id=${matched.id}`;
    else if (event.categoryCode) eventUrl = `${LMS_BASE}/course/search.php?search=${encodeURIComponent(event.categoryCode)}`;

    const manualDone = statusByUid.get(event.uid);
    return {
      id: event.uid,
      name: event.summary,
      deadline: event.end || event.start,
      // LMS で提出済みなら、手動のチェックに関係なく完了。まだのものは手動のチェックで完了にできる
      done: event.submissionStatus === 'submitted' || (manualDone ?? false),
      classification: 'official' as const,
      user_id: null,
      // 科目名: 時間割の授業 → 以前の科目の表 → LMS のコース名（括弧より前）。分からなければ空（画面では科目を出さない）
      subject_name: byCourse?.name || subjects.find((s) => s.id === matched?.id)?.name || (event.courseName ? parseCourseName(event.courseName).name : ''),
      url: eventUrl,
      isLms: true,
      description: event.description,
      subjectCategoryType: getSubjectCategoryType(matched),
      submissionStatus: event.submissionStatus,
      attachments: event.attachments,
    };
  });

  let combined = [...dbUnified, ...lmsUnified];
  if (officialOnly) combined = combined.filter((a) => a.classification === 'official');

  const cutoff = now.getTime() - DAY_MS;
  combined = combined.filter((a) => new Date(a.deadline).getTime() >= cutoff);

  return combined.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });
}

export type DeadlineSyncItem = { uid: string; title: string; deadline: string; url: string | null };

/**
 * 締切リマインダー用にサーバーへ同期する項目を作る。
 * 未完了かつ締切前の課題のみ。uid は LMS 課題はそのまま、DB 課題は `db_<id>`。
 * 締切順に並べるので、内容が同じなら結果も同じになる（不要な再同期の判定に使う）。
 */
export function toDeadlineSyncItems(items: UnifiedAssignment[], now: Date = new Date()): DeadlineSyncItem[] {
  return items
    .filter((a) => !a.done && new Date(a.deadline).getTime() > now.getTime())
    .map((a) => ({
      uid: a.isLms ? String(a.id) : `db_${a.id}`,
      title: a.name.replace(/[「」]|の提出期限/g, ''),
      deadline: new Date(a.deadline).toISOString(),
      url: a.url || null,
    }))
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.uid.localeCompare(b.uid));
}

export type AssignmentGroupKey = 'overdue' | 'today' | 'week' | 'later' | 'done';

export const ASSIGNMENT_GROUP_LABELS: Record<AssignmentGroupKey, string> = {
  overdue: '期限切れ',
  today: '24時間以内',
  week: '1週間以内',
  later: 'それ以降',
  done: '完了',
};

/**
 * 一覧を期限の近さで区切る（掲示板の小見出しのように、まとまりごとに見せるため）。
 * 並び順は overdue → today → week → later → done。空のグループは返さない。
 * 各グループ内の順序は入力（mergeAssignments の並び）を保つ。
 */
export function groupAssignments(items: UnifiedAssignment[], now: Date = new Date()) {
  const order: AssignmentGroupKey[] = ['overdue', 'today', 'week', 'later', 'done'];
  const buckets: Record<AssignmentGroupKey, UnifiedAssignment[]> = { overdue: [], today: [], week: [], later: [], done: [] };
  for (const a of items) {
    if (a.done) { buckets.done.push(a); continue; }
    const remaining = new Date(a.deadline).getTime() - now.getTime();
    if (remaining < 0) buckets.overdue.push(a);
    else if (remaining <= DAY_MS) buckets.today.push(a);
    else if (remaining <= 7 * DAY_MS) buckets.week.push(a);
    else buckets.later.push(a);
  }
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: ASSIGNMENT_GROUP_LABELS[key], items: buckets[key] }));
}

/** 締切での絞り込み。範囲は入れ子で、広い範囲は狭い範囲を含む（1ヶ月以内 ⊃ 1週間以内 ⊃ 24時間以内） */
export type DeadlineRange = 'all' | 'overdue' | 'day' | 'week' | 'month' | 'done';
export const DEADLINE_RANGES: DeadlineRange[] = ['all', 'day', 'week', 'month', 'overdue', 'done'];
export const DEADLINE_RANGE_LABELS: Record<DeadlineRange, string> = {
  all: 'すべて', overdue: '期限切れ', day: '24時間以内', week: '1週間以内', month: '1ヶ月以内', done: '完了',
};
const RANGE_DAYS = { day: 1, week: 7, month: 31 } as const;

/**
 * 絞り込みに入るか。
 *   完了     : 完了した課題だけ
 *   期限切れ : 締切を過ぎた、まだの課題（完了したものは含めない）
 *   ○○以内  : いまから締切までの残りで決める（完了したものも含め、一覧では「完了」の区切りにたたんで出す）
 */
export function inDeadlineRange(a: { deadline: string; done: boolean }, range: DeadlineRange, now: number = Date.now()): boolean {
  if (range === 'all') return true;
  if (range === 'done') return a.done;
  const remaining = new Date(a.deadline).getTime() - now;
  if (range === 'overdue') return !a.done && remaining < 0;
  return remaining >= 0 && remaining <= RANGE_DAYS[range] * DAY_MS;
}
