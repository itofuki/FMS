/* src/lib/courses.ts
 * 学科のコース（courses 表）。DB では name 列にコースの記号（IA・IS など）が入っている。
 */
import { supabase } from './supabaseClient';

/** 画面に出すコース名（以前の画面で使っていた短い呼び名と記号） */
export const COURSE_LABELS: Record<string, string> = {
  IA: 'AI（IA）',
  IS: 'IoT（IS）',
  IR: 'ロボット（IR）',
  DL: 'プランナー（DL）',
  DG: 'プログラマー（DG）',
  DC: 'CG（DC）',
};

export const courseLabel = (code: string | null) => (code ? COURSE_LABELS[code] ?? code : '全コース共通');

export type CourseOption = { code: string; name: string };

/** コースの一覧（記号と画面に出す名前） */
export async function fetchCourseOptions(): Promise<CourseOption[]> {
  const { data } = await supabase.from('courses').select('id, name').order('id');
  return ((data ?? []) as { name: string }[]).map((c) => ({ code: c.name, name: COURSE_LABELS[c.name] ?? c.name }));
}
