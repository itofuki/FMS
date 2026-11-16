import { describe, it, expect } from 'vitest';
import { mergeAssignments, getDeadlineStatus, getSubjectCategoryType, toDeadlineSyncItems, type Assignment, type LmsEvent, type DbSubject } from './assignments';

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

  it('LMS課題は手動チェックを Moodle の提出状況より優先する', () => {
    const result = mergeAssignments({
      ...base,
      lmsEvents: [
        lmsEvent({ uid: 'a', submissionStatus: 'submitted' }),
        lmsEvent({ uid: 'b', submissionStatus: 'submitted' }),
        lmsEvent({ uid: 'c', submissionStatus: 'new' }),
      ],
      lmsStatuses: [{ lms_uid: 'a', done: false }],
    });
    const done = Object.fromEntries(result.map((a) => [a.id, a.done]));
    expect(done).toEqual({ a: false, b: true, c: false });
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
