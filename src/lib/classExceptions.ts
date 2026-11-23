/* src/lib/classExceptions.ts
 * イレギュラーな授業回（管理者が日付を指定して登録した休講・時刻や教室の変更・補講）を、画面の時間割に当てはめる。
 * サーバー側（授業前の通知・カレンダー連携）は supabase/functions/_shared/exceptions.ts が同じ考え方で当てはめる。
 * 画面では休講を消さずに「休講」として残す。
 */
import { supabase } from './supabaseClient';
import type { Subject, Day } from '../components/Timetable';

export type ClassException = {
  id: number;
  course_id: number;
  name: string;
  date: string; // YYYY-MM-DD
  kind: 'change' | 'cancel' | 'extra';
  /** その日の授業の時限（変更: 動かした先も含めたその日の時限 / 休講: 休む時限 / 補講: 足す時限）。空なら既定値の時限すべて */
  periods: number[] | null;
  /** 時限ごとの時刻（既定値と違う時限だけ） */
  period_times: Record<string, { start?: string; end?: string }> | null;
  classroom: string | null;
  note: string | null;
  attendance_id: number | null;
};

/** 自分に関係するイレギュラーな授業回（from〜to） */
export async function fetchClassExceptions(userId: string, from: string, to: string): Promise<ClassException[]> {
  const { data, error } = await supabase.rpc('get_class_exceptions', { p_user_id: userId, p_from: from, p_to: to });
  if (error) {
    console.error('イレギュラーな授業回の取得に失敗:', error);
    return [];
  }
  return (data ?? []) as ClassException[];
}

const courseOf = (s: Subject) => Number(s.id.split('-')[0]);

/**
 * ある日（date・曜日 day）のいつもの授業に、その日のイレギュラーな授業回を当てはめる（1 つの授業・1 日につき 1 件）。
 *   - cancel : periods の時限（空ならその日の全時限）を休講にする。消さずに status = 'cancel' にする
 *   - change : その日のその授業を、periods の時限（空ならいつもの時限のまま）に置き換える。
 *              時刻は period_times にある時限だけ変え、ない時限はいつもの時刻。教室は入っていれば変える
 *   - extra  : 補講として periods の時限に授業を足す（同じ時限にほかの授業があれば置き換える）
 * allSubjects は、補講のコースのいつもの教室・先生を探すのに使う（週のすべての授業）。
 */
export function applyClassExceptions(
  daySubjects: Subject[], exceptions: ClassException[], date: string, day: Day, allSubjects: Subject[],
): Subject[] {
  let list = daySubjects.map((s) => ({ ...s }));
  for (const e of exceptions.filter((x) => x.date === date)) {
    const mine = list.filter((s) => courseOf(s) === e.course_id);
    const regular = mine[0] ?? allSubjects.find((s) => courseOf(s) === e.course_id);
    const timeOf = (p: number, key: 'start' | 'end') => e.period_times?.[String(p)]?.[key] || null;
    if (e.kind === 'cancel') {
      list = list.map((s) => (courseOf(s) === e.course_id && (e.periods == null || e.periods.includes(s.period))
        ? { ...s, status: 'cancel' as const, note: e.note } : s));
    } else {
      const periods = e.periods ?? mine.map((s) => s.period);
      list = list.filter((s) => !(e.kind === 'change' && courseOf(s) === e.course_id) && !periods.includes(s.period));
      for (const p of periods) {
        const same = mine.find((s) => s.period === p);
        list.push({
          // 臨時授業（course_id が負の数）は「x」で始まる id にする（「-」で区切って読むため、負の数にしない）
          id: e.course_id < 0 ? `x${-e.course_id}-${day}-${p}-extra` : `${e.course_id}-${day}-${p}${e.kind === 'extra' ? '-extra' : ''}`,
          name: regular?.name ?? e.name,
          teacher: regular?.teacher ?? '',
          wday: day,
          period: p,
          classroom: e.classroom ?? regular?.classroom ?? '',
          attendanceId: e.attendance_id ?? regular?.attendanceId ?? null,
          startTime: timeOf(p, 'start') ?? same?.startTime ?? null,
          endTime: timeOf(p, 'end') ?? same?.endTime ?? null,
          status: e.kind,
          note: e.note,
          roomChanged: !!e.classroom && e.classroom !== regular?.classroom,
          timeChanged: !!(timeOf(p, 'start') || timeOf(p, 'end')),
          // いつもはこの時限にない（時限を動かした・補講）
          periodMoved: e.kind === 'change' && !same,
        });
      }
    }
  }
  return list.sort((a, b) => a.period - b.period);
}
