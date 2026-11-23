/* src/components/LmsCourseSettings.tsx
 * 設定の「時間割」の中身。
 * LMS から取り込んだ今学期のコースを一覧にし、曜日・時限・教室は管理者の既定値（なければ LMS のコース名）を出す。
 * 時間割は管理者の情報を正とするので、学生が変えられるのは「時間割に出すかどうか」だけ。
 * ただし、管理者の既定値もコース名からの読み取りもなく曜日・時限が決まらない授業だけは、本人が曜日・時限を入れられる
 * （管理者が既定値を入れたら、そちらを使う）。入れた内容は user_course_settings に保存する。
 * いちばん上で、自分のコース（IA・IS など。profiles.course_code）を選ぶ（LMS のコース名から自動で入る）。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiRefreshCw, FiEdit2 } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { getLmsSession } from '../lib/lms';
import { syncLmsCoursesNow } from '../hooks/useLmsCourseSync';
import { fetchCourseOptions } from '../lib/courses';
import { WEEKDAYS, WEEKDAY_LABELS, type Weekday } from '../lib/schedule';
import { Link } from 'react-router-dom';
import { Switch } from './ui/SettingControls';

type Course = { course_id: number; name: string; fullname: string; wday: Weekday | null; periods: number[] | null; teachers: string[]; attendance_id: number | null };
type CourseSetting = { course_id: number; wday: Weekday | null; periods: number[] | null; classroom: string | null; hidden: boolean };
type CourseDefault = { course_id: number; course_code: string | null; wday: Weekday | null; periods: number[] | null; classroom: string | null; not_a_class: boolean };
/** 本人が何も入れていないときに使う値（管理者の既定値 > LMS のコース名から読み取った値） */
type Base = { wday: Weekday | null; periods: number[] | null; classroom: string | null; slotFromDefault: boolean; roomFromDefault: boolean; notAClass: boolean };

const baseOf = (c: Course, defaults: CourseDefault[], myCode: string | null): Base => {
  const mine = defaults.find((d) => d.course_id === c.course_id && myCode && d.course_code === myCode);
  const all = defaults.find((d) => d.course_id === c.course_id && d.course_code === null);
  const wday = mine?.wday ?? all?.wday ?? null;
  const periods = mine?.periods ?? all?.periods ?? null;
  const classroom = mine?.classroom || all?.classroom || null;
  return {
    wday: wday ?? c.wday,
    periods: periods ?? c.periods,
    classroom,
    slotFromDefault: !!(wday || periods),
    roomFromDefault: !!classroom,
    // 管理者が「授業ではない」とした名目上のコース（自分のコース向けの既定値があればそちらに従う）
    notAClass: (mine ?? all)?.not_a_class ?? false,
  };
};

const formatSlot = (wday: Weekday | null, periods: number[] | null) =>
  wday && periods?.length ? `${WEEKDAY_LABELS[wday]}曜 ${periods.join('・')}限` : null;

export default function LmsCourseSettings({ userId, onChanged }: { userId: string; onChanged?: () => void }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [settings, setSettings] = useState<Record<number, CourseSetting>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [defaults, setDefaults] = useState<CourseDefault[]>([]);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [courseOptions, setCourseOptions] = useState<{ code: string; name: string }[]>([]);
  const hasLms = !!getLmsSession();

  const load = useCallback(async () => {
    const [c, s, d, p, o] = await Promise.all([
      supabase.from('user_lms_courses').select('course_id, name, fullname, wday, periods, teachers, attendance_id').eq('user_id', userId).order('name'),
      supabase.from('user_course_settings').select('course_id, wday, periods, classroom, hidden').eq('user_id', userId),
      supabase.from('lms_course_defaults').select('course_id, course_code, wday, periods, classroom, not_a_class'),
      supabase.from('profiles').select('course_code').eq('user_id', userId).maybeSingle(),
      fetchCourseOptions(),
    ]);
    setCourses(c.error ? [] : (c.data as Course[]));
    setSettings(Object.fromEntries(((s.data ?? []) as CourseSetting[]).map((x) => [x.course_id, x])));
    setDefaults((d.data ?? []) as CourseDefault[]);
    setMyCode((p.data?.course_code as string | null) ?? null);
    setCourseOptions(o);
  }, [userId]);

  // 自分のコース（選んだ瞬間に保存）。コースごとの既定値が変わるので時間割も読み直す
  const saveCourse = async (code: string | null) => {
    const prev = myCode;
    setMyCode(code);
    const { error } = await supabase.from('profiles').upsert({ user_id: userId, course_code: code }, { onConflict: 'user_id' });
    if (error) {
      setMyCode(prev);
      toast.error(`保存できませんでした: ${error.message}`);
      return;
    }
    onChanged?.();
  };

  const courseSelect = (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor="my-course" className="block text-[15px] font-medium text-fg">あなたのコース</label>
        <p className="mt-0.5 text-[13px] text-fg-muted leading-snug">コースごとの時限・教室の既定に使います</p>
      </div>
      <select
        id="my-course"
        value={myCode ?? ''}
        onChange={(e) => saveCourse(e.target.value || null)}
        className="h-9 bg-surface border border-line-strong rounded-md px-2 text-sm text-fg"
      >
        <option value="">未設定</option>
        {courseOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
      </select>
    </div>
  );

  useEffect(() => { load(); }, [load]);

  const resync = async () => {
    setSyncing(true);
    try {
      await syncLmsCoursesNow();
      await load();
      onChanged?.();
      toast.success('LMS からコースを取り込みました');
    } catch (e) {
      toast.error(`取り込めませんでした: ${e instanceof Error ? e.message : String(e)}（LMS 連携から再ログインしてください）`);
    } finally {
      setSyncing(false);
    }
  };

  const save = async (courseId: number, patch: Partial<Omit<CourseSetting, 'course_id'>>, quiet = false) => {
    const current = settings[courseId] ?? { course_id: courseId, wday: null, periods: null, classroom: null, hidden: false };
    const next = { ...current, ...patch };
    setSettings((prev) => ({ ...prev, [courseId]: next }));
    const { error } = await supabase.from('user_course_settings').upsert({
      user_id: userId, course_id: courseId,
      wday: next.wday, periods: next.periods, classroom: next.classroom, hidden: next.hidden,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setSettings((prev) => ({ ...prev, [courseId]: current }));
      toast.error(`保存できませんでした: ${error.message}`);
      return;
    }
    setEditing(null);
    onChanged?.();
    if (!quiet) toast.success('保存しました。時間割に反映されます。');
  };

  if (courses === null) return <p className="text-sm text-fg-muted">読み込み中...</p>;

  if (courses.length === 0) {
    return (
      <div className="space-y-3">
        {!hasLms && (
          <p className="text-sm text-fg-muted">LMS に再ログインすると、コースを取り込めます。</p>
        )}
        {hasLms && (
          <button type="button" onClick={resync} disabled={syncing} className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors disabled:opacity-50">
            <FiRefreshCw size={15} className={syncing ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            <span className="text-sm font-bold">{syncing ? '取り込み中...' : 'LMS からコースを取り込む'}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {courseSelect}
      <ul className="divide-y divide-line border border-line rounded-lg">
        {courses.map((c) => {
          const s = settings[c.course_id];
          const base = baseOf(c, defaults, myCode);
          // 管理者の既定値かコース名から曜日・時限が決まっているか（決まっていれば、それを正とする）
          const decided = !!(base.wday && base.periods?.length);
          // 授業ではない名目上のコース: 時間割には出ないので、説明だけ出す
          if (base.notAClass) {
            return (
              <li key={c.course_id} className="px-4 py-3">
                <p className="text-[15px] font-medium leading-snug text-fg-subtle">{c.name}</p>
                <p className="mt-0.5 text-[13px] text-fg-subtle">授業ではありません（時間割に出ません）</p>
              </li>
            );
          }
          const slot = decided ? formatSlot(base.wday, base.periods) : formatSlot(s?.wday ?? null, s?.periods ?? null);
          const hidden = s?.hidden ?? false;
          return (
            <li key={c.course_id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[15px] font-medium leading-snug ${hidden ? 'text-fg-subtle line-through' : 'text-fg'}`}>{c.name}</p>
                  <p className="mt-0.5 text-[13px] text-fg-muted flex flex-wrap gap-x-2">
                    {slot
                      ? <span>{slot}{!decided && <span className="text-fg-subtle">（自分で入力）</span>}</span>
                      : <span className="text-warn font-semibold">曜日・時限が未設定</span>}
                    {base.classroom && <span>教室 {base.classroom}</span>}
                  </p>
                  {/* 曜日・時限が決まらない授業だけ、自分で入れられる */}
                  {!decided && !hidden && (
                    <button type="button" onClick={() => setEditing(editing === c.course_id ? null : c.course_id)} className="mt-1 inline-flex items-center gap-1 text-link hover:underline">
                      <FiEdit2 size={12} aria-hidden="true" />
                      {/* Mantine の CSS が button の文字の大きさを上書きするため、span で指定する */}
                      <span className="text-[13px] font-semibold">{editing === c.course_id ? '閉じる' : slot ? '曜日・時限を直す' : '曜日・時限を入れる'}</span>
                    </button>
                  )}
                </div>
                <Switch checked={!hidden} onChange={(on) => save(c.course_id, { hidden: !on }, true)} label={`${c.name}を時間割に出す`} />
              </div>
              {editing === c.course_id && <CourseEditor course={c} setting={s} onSave={(next) => save(c.course_id, next)} />}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-subtle">
        右のスイッチで、時間割に出すかどうかを選べます（取っていない授業や、授業ではないコースは外してください）。
        曜日・時限・時刻・教室は管理者が設定しています。
        <Link to="?tab=feedback" className="ml-1 font-semibold text-link hover:underline">時間割の間違いを報告</Link>
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-subtle">1日1回、LMS から自動で取り直します。</p>
        {hasLms && (
          <button type="button" onClick={resync} disabled={syncing} className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline disabled:opacity-50">
            <FiRefreshCw size={13} className={syncing ? 'motion-safe:animate-spin' : ''} aria-hidden="true" />
            {syncing ? '取り込み中...' : '今すぐ取り直す'}
          </button>
        )}
      </div>
    </div>
  );
}

function CourseEditor({ course, setting, onSave }: { course: Course; setting?: CourseSetting; onSave: (next: Partial<Omit<CourseSetting, 'course_id'>>) => void }) {
  // 曜日・時限が決まらない授業だけ、自分で入れる（管理者が既定値を入れたら、そちらを使う）
  const [wday, setWday] = useState<Weekday | null>(setting?.wday ?? null);
  const [periods, setPeriods] = useState<number[]>(setting?.periods ?? []);
  const togglePeriod = (p: number) => setPeriods((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p].sort()));

  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-4 py-3 space-y-3">
      <p className="text-xs text-fg-subtle break-all">LMS のコース名: {course.fullname}</p>
      <p className="text-xs text-fg-muted">コース名から曜日・時限が分からず、管理者の設定もまだない授業です。分かる範囲で入れてください。</p>
      <div>
        <label htmlFor={`wday-${course.course_id}`} className="block text-sm font-semibold text-fg mb-1">曜日</label>
        <select
          id={`wday-${course.course_id}`}
          value={wday ?? ''}
          onChange={(e) => setWday((e.target.value || null) as Weekday | null)}
          className="h-9 bg-surface border border-line-strong rounded-md px-2 text-sm text-fg"
        >
          <option value="">未設定</option>
          {WEEKDAYS.map((d) => <option key={d} value={d}>{WEEKDAY_LABELS[d]}曜</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-1">時限</legend>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((p) => {
            const on = periods.includes(p);
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => togglePeriod(p)}
                className={`w-10 h-9 rounded-md border text-sm font-bold transition-colors ${on ? 'bg-accent-soft border-accent text-accent' : 'bg-surface border-line text-fg-muted hover:text-fg'}`}>
                {p}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave({ wday, periods: periods.length ? periods : null })}
          className="h-9 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors"
        >
          <span className="text-sm font-bold">保存</span>
        </button>
      </div>
    </div>
  );
}
