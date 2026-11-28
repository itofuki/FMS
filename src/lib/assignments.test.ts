import { describe, it, expect } from 'vitest';
import { mergeAssignments, getDeadlineStatus, getSubjectCategoryType, toDeadlineSyncItems, groupAssignments, inDeadlineRange, type Assignment, type LmsEvent, type DbSubject } from './assignments';

const NOW = new Date('2026-11-16T12:00:00+09:00');
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString();

const dbAssign = (over: Partial<Assignment>): Assignment => ({
  id: 1, name: 'レポート', deadline: hoursFromNow(48), done: false,
  classification: 'private', user_id: 'u1', subject_name: null, url: null, ...over,
});
const lmsEvent = (over: Partial<LmsEvent>): LmsEvent => ({
  uid: 'assign_1', summary: '課題1', description: '', start: hoursFromNow(0), end: hoursFromNow(24), ...over,
});
const base = { assignments: [], lmsEvents: [], dbSubjects: [], subjects: [], lmsStatuses: [], officialOnly: false, now: NOW };

describe('mergeAssignments', () => {
  it('未完了を先に、期限が近い順に並べる', () => {
    const result = mergeAssignments({
      ...base,
      assignments: [
        dbAssign({ id: 1, deadline: hoursFromNow(72) }),
        dbAssign({ id: 2, deadline: hoursFromNow(1), done: true }),
        dbAssign({ id: 3, deadline: hoursFromNow(5) }),
      ],
    });
    expect(result.map((a) => a.id)).toEqual([3, 1, 2]);
  });

  it('期限切れから1日を過ぎたものは除外し、1日以内は残す', () => {
    const result = mergeAssignments({
      ...base,
      assignments: [dbAssign({ id: 1, deadline: hoursFromNow(-23) }), dbAssign({ id: 2, deadline: hoursFromNow(-25) })],
    });
    expect(result.map((a) => a.id)).toEqual([1]);
  });

  it('LMS で提出済みの課題は、手動のチェックに関係なく完了。まだのものは手動のチェックで完了にできる', () => {
    const result = mergeAssignments({
      ...base,
      lmsEvents: [
        lmsEvent({ uid: 'a', submissionStatus: 'submitted' }),
        lmsEvent({ uid: 'b', submissionStatus: 'submitted' }),
        lmsEvent({ uid: 'c', submissionStatus: 'new' }),
        lmsEvent({ uid: 'd', submissionStatus: 'new' }),
      ],
      lmsStatuses: [{ lms_uid: 'a', done: false }, { lms_uid: 'd', done: true }],
    });
    const done = Object.fromEntries(result.map((a) => [a.id, a.done]));
    expect(done).toEqual({ a: true, b: true, c: false, d: true });
  });

  it('LMS課題を category_code で科目と紐付け、URL がなければ科目ページを使う', () => {
    const dbSubjects: DbSubject[] = [
      { id: 10, category_code: 'CS101', subject_classes: [{ subject_id: 10 }], subject_departments: [], subject_courses: [] },
    ];
    const [a] = mergeAssignments({
      ...base,
      dbSubjects,
      subjects: [{ id: 10, name: 'プログラミング' }],
      lmsEvents: [lmsEvent({ categoryCode: 'CS101', url: undefined })],
    });
    expect(a.subject_name).toBe('プログラミング');
    expect(a.subjectCategoryType).toBe('class');
    expect(a.url).toBe('https://lms-tokyo.iput.ac.jp/course/view.php?id=10');
  });

  it('科目が見つからないLMS課題は、科目名を空にする（画面では科目を出さない）', () => {
    const [a] = mergeAssignments({ ...base, lmsEvents: [lmsEvent({ categoryCode: 'UNKNOWN' })] });
    expect(a.subject_name).toBe('');
    expect(a.isLms).toBe(true);
  });

  it('時間割にないコースのLMS課題は、LMS のコース名（括弧より前）を科目名にする', () => {
    const [a] = mergeAssignments({ ...base, lmsEvents: [lmsEvent({ categoryCode: 'UNKNOWN', courseId: 999, courseName: 'キャリアデザイン（月5限）' })] });
    expect(a.subject_name).toBe('キャリアデザイン');
  });

  it('officialOnly のときは個人課題を除外する', () => {
    const result = mergeAssignments({
      ...base,
      officialOnly: true,
      assignments: [dbAssign({ id: 1 }), dbAssign({ id: 2, classification: 'official' })],
      lmsEvents: [lmsEvent({ uid: 'x' })],
    });
    expect(result.map((a) => a.id).sort()).toEqual([2, 'x'].sort());
  });
});

describe('getDeadlineStatus', () => {
  it('完了済みはラベルなし', () => {
    expect(getDeadlineStatus(hoursFromNow(-5), true, NOW).label).toBe('');
  });
  it('期限切れ', () => {
    expect(getDeadlineStatus(hoursFromNow(-1), false, NOW).label).toBe('(期限切れ)');
  });
  it('24時間未満は時間表示（0時間は1時間と表示）', () => {
    expect(getDeadlineStatus(hoursFromNow(0.5), false, NOW).label).toBe('(あと 1 時間)');
    expect(getDeadlineStatus(hoursFromNow(5), false, NOW).label).toBe('(あと 5 時間)');
  });
  it('それ以上は日数表示（切り上げ）', () => {
    expect(getDeadlineStatus(hoursFromNow(30), false, NOW).label).toBe('(あと 2 日)');
  });
});

describe('getSubjectCategoryType', () => {
  it('未定義は none', () => expect(getSubjectCategoryType(undefined)).toBe('none'));
  it('class > department > course の優先順', () => {
    expect(getSubjectCategoryType({ id: 1, category_code: '', subject_classes: [], subject_departments: [{ subject_id: 1 }], subject_courses: [{ subject_id: 1 }] })).toBe('department');
  });
});

describe('toDeadlineSyncItems', () => {
  it('未完了かつ締切前のものだけを、締切順に同期用の形へ変換する', () => {
    const merged = mergeAssignments({
      ...base,
      assignments: [
        dbAssign({ id: 1, name: 'レポート', deadline: hoursFromNow(48), url: 'https://example.com' }),
        dbAssign({ id: 2, deadline: hoursFromNow(5), done: true }),
        dbAssign({ id: 3, deadline: hoursFromNow(-2) }),
      ],
      lmsEvents: [lmsEvent({ uid: 'assign_9', summary: '「課題9」の提出期限', end: hoursFromNow(3) })],
    });
    expect(toDeadlineSyncItems(merged, NOW)).toEqual([
      { uid: 'assign_9', title: '課題9', deadline: new Date(hoursFromNow(3)).toISOString(), url: null },
      { uid: 'db_1', title: 'レポート', deadline: new Date(hoursFromNow(48)).toISOString(), url: 'https://example.com' },
    ]);
  });
});

describe('groupAssignments', () => {
  it('期限の近さでグループ分けし、空のグループは返さない', () => {
    const merged = mergeAssignments({
      ...base,
      assignments: [
        dbAssign({ id: 1, deadline: hoursFromNow(-2) }),
        dbAssign({ id: 2, deadline: hoursFromNow(3) }),
        dbAssign({ id: 3, deadline: hoursFromNow(24) }),
        dbAssign({ id: 4, deadline: hoursFromNow(100) }),
        dbAssign({ id: 5, deadline: hoursFromNow(5), done: true }),
      ],
    });
    const groups = groupAssignments(merged, NOW);
    expect(groups.map((g) => [g.key, g.items.map((a) => a.id)])).toEqual([
      ['overdue', [1]],
      ['today', [2, 3]],
      ['week', [4]],
      ['done', [5]],
    ]);
    expect(groups[0].label).toBe('期限切れ');
  });

  it('8日以上先は「それ以降」', () => {
    const merged = mergeAssignments({ ...base, assignments: [dbAssign({ id: 1, deadline: hoursFromNow(24 * 8) })] });
    expect(groupAssignments(merged, NOW).map((g) => g.key)).toEqual(['later']);
  });
});

describe('LMS 課題の科目（コースの id で時間割の授業と結び付ける）', () => {
  it('courseId が時間割の授業と同じなら、その授業名になる', () => {
    const [a] = mergeAssignments({
      ...base,
      lmsEvents: [{ uid: 'assign_1', summary: '第1回', description: '', start: '2026-11-20T00:00:00Z', end: '2026-11-20T14:59:00Z', courseId: 4139, categoryCode: 'X' }],
      subjects: [{ id: 4139, name: 'データベース' }],
    });
    expect(a.subject_name).toBe('データベース');
  });
});

describe('inDeadlineRange（締切での絞り込み）', () => {
  const now = new Date('2026-11-28T12:00:00+09:00').getTime();
  const after = (h: number, done = false) => ({ deadline: new Date(now + h * 3600_000).toISOString(), done });
  it('広い範囲は狭い範囲を含む（1ヶ月以内 ⊃ 1週間以内 ⊃ 24時間以内）', () => {
    expect(['day', 'week', 'month'].map(r => inDeadlineRange(after(3), r as 'day', now))).toEqual([true, true, true]);
    expect(['day', 'week', 'month'].map(r => inDeadlineRange(after(72), r as 'day', now))).toEqual([false, true, true]);
    expect(['day', 'week', 'month'].map(r => inDeadlineRange(after(24 * 20), r as 'day', now))).toEqual([false, false, true]);
    expect(inDeadlineRange(after(24 * 40), 'month', now)).toBe(false);
  });
  it('期限切れは期限切れだけに入る', () => {
    expect(inDeadlineRange(after(-1), 'overdue', now)).toBe(true);
    expect(inDeadlineRange(after(-1), 'month', now)).toBe(false);
    expect(inDeadlineRange(after(1), 'overdue', now)).toBe(false);
    expect(inDeadlineRange(after(-1), 'all', now)).toBe(true);
    expect(inDeadlineRange(after(-1, true), 'overdue', now)).toBe(false);
  });
  it('完了は完了した課題だけ', () => {
    expect(inDeadlineRange(after(3, true), 'done', now)).toBe(true);
    expect(inDeadlineRange(after(-3, true), 'done', now)).toBe(true);
    expect(inDeadlineRange(after(3), 'done', now)).toBe(false);
  });
});
