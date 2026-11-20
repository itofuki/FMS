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
  period: number | null;
  start_time: string | null;
  end_time: string | null;
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
 * ある日（date・曜日 day）のいつもの授業に、その日のイレギュラーな授業回を当てはめる。
 *   - cancel : 休講（period が空ならその日の全時限）。消さずに status = 'cancel' にする
 *   - change : 時刻・教室を、入っているものだけ変える（period が空なら全時限。時刻は最初の時限の開始・最後の時限の終了）
 *   - extra  : 補講（同じ時限にいつもの授業があれば置き換える）
 * allSubjects は、補講のコースのいつもの教室・先生を探すのに使う（週のすべての授業）。
 */
export function applyClassExceptions(
  daySubjects: Subject[], exceptions: ClassException[], date: string, day: Day, allSubjects: Subject[],
): Subject[] {
  let list = daySubjects.map((s) => ({ ...s }));
  for (const e of exceptions.filter((x) => x.date === date)) {
    const hits = (s: Subject) => courseOf(s) === e.course_id && (e.period == null || s.period === e.period);
    if (e.kind === 'cancel') {
      list = list.map((s) => (hits(s) ? { ...s, status: 'cancel' as const, note: e.note } : s));
    } else if (e.kind === 'change') {
      const targets = list.filter(hits).sort((a, b) => a.period - b.period);
      targets.forEach((s, i) => {
        s.status = 'change';
        s.note = e.note;
        if (e.classroom) s.classroom = e.classroom;
        if (e.start_time && (e.period != null || i === 0)) s.startTime = e.start_time;
        if (e.end_time && (e.period != null || i === targets.length - 1)) s.endTime = e.end_time;
      });
    } else if (e.kind === 'extra' && e.period != null) {
      const regular = allSubjects.find((s) => courseOf(s) === e.course_id);
      list = list.filter((s) => s.period !== e.period);
      list.push({
        id: `${e.course_id}-${day}-${e.period}-extra`,
        name: e.name,
        teacher: regular?.teacher ?? '',
        wday: day,
        period: e.period,
        classroom: e.classroom ?? regular?.classroom ?? '',
        attendanceId: e.attendance_id ?? regular?.attendanceId ?? null,
        startTime: e.start_time,
        endTime: e.end_time,
        status: 'extra',
        note: e.note,
      });
    }
  }
  return list.sort((a, b) => a.period - b.period);
}
