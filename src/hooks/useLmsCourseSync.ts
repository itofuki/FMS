/* src/hooks/useLmsCourseSync.ts
 * LMS から今学期のコースを取り、サーバー（user_lms_courses）に同期する。1 日 1 回。
 * 同期した内容が前回と変わったら onChanged を呼ぶ（時間割の読み直し用）。
 * サーバー側では get_effective_timetable がこのコースから時間割を組み立てる（授業前の通知・カレンダー購読も同じもの）。
 */
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getLmsSession, lmsCoursesSyncKey } from '../lib/lms';
import { detectCourseCode, fetchLmsCourses } from '../lib/lmsCourses';
import { nowInJst, toYmd } from '../lib/schedule';
import { clearLmsIssue, reportLmsIssue } from '../lib/lmsStatus';

type SyncMark = { day: string; sig: string };

/** 今すぐ LMS から取り直して同期する。内容が前回から変わったら true */
export async function syncLmsCoursesNow(): Promise<boolean> {
  const session = getLmsSession();
  if (!session) return false;
  const key = lmsCoursesSyncKey(session.username);
  let prev: SyncMark | null = null;
  try { prev = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { /* 読めなければ初回扱い */ }

  let courses;
  try {
    courses = await fetchLmsCourses(session.token, session.userId);
  } catch (e) {
    reportLmsIssue(e);
    throw e;
  }
  clearLmsIssue();
  const { error } = await supabase.rpc('sync_user_lms_courses', { p_items: courses });
  if (error) throw error;

  // コース（IA・IS など）がまだ決まっていなければ、LMS のコース名から推測して入れる（設定で変えた値は上書きしない）
  let courseChanged = false;
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('course_code').eq('user_id', user.id).maybeSingle();
    if (!profile?.course_code) {
      // courses 表の name 列にコースの記号（IA・IS など）が入っている
      const { data: known } = await supabase.from('courses').select('name');
      const code = detectCourseCode(courses.map((c) => c.fullname), (known ?? []).map((k: { name: string }) => k.name));
      if (code) {
        const { error: pError } = await supabase.from('profiles').upsert({ user_id: user.id, course_code: code }, { onConflict: 'user_id' });
        courseChanged = !pError;
      }
    }
  }
  const sig = JSON.stringify(courses);
  try { localStorage.setItem(key, JSON.stringify({ day: toYmd(nowInJst()), sig })); } catch { /* 次回また取るだけ */ }
  return sig !== prev?.sig || courseChanged;
}

export function useLmsCourseSync(onChanged: () => void) {
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  useEffect(() => {
    const session = getLmsSession();
    if (!session) return;
    try {
      const prev = JSON.parse(localStorage.getItem(lmsCoursesSyncKey(session.username)) ?? 'null') as SyncMark | null;
      if (prev?.day === toYmd(nowInJst())) return; // 今日はもう同期した
    } catch { /* 読めなければ同期する */ }

    let cancelled = false;
    syncLmsCoursesNow()
      .then((changed) => { if (changed && !cancelled) onChangedRef.current(); })
      // トークン切れ・通信エラーなどは、今の時間割のまま表示を続ける（再ログインの案内は課題ページで出る）
      .catch((e) => console.warn('[LMS] コースの同期に失敗しました', e));
    return () => { cancelled = true; };
  }, []);
}
