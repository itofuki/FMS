/* src/components/LmsCourseSettings.tsx
 * 設定の「時間割（LMS のコース）」の中身。
 * LMS から取り込んだ今学期のコースを一覧にし、コース名から読み取れなかった曜日・時限や、LMS にない教室を手で入れる。
 * 入れた内容は user_course_settings に保存し、サーバーの get_effective_timetable が時間割に反映する。
 * 管理者が決めた既定値（lms_course_defaults。全コース共通・自分のコース向け）があれば、それを「既定」として出す。
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

type Course = { course_id: number; name: string; fullname: string; wday: Weekday | null; periods: number[] | null; teachers: string[]; attendance_id: number | null };
type CourseSetting = { course_id: number; wday: Weekday | null; periods: number[] | null; classroom: string | null; hidden: boolean };
type CourseDefault = { course_id: number; course_code: string | null; wday: Weekday | null; periods: number[] | null; classroom: string | null };
/** 本人が何も入れていないときに使う値（管理者の既定値 > LMS のコース名から読み取った値） */
type Base = { wday: Weekday | null; periods: number[] | null; classroom: string | null; slotFromDefault: boolean; roomFromDefault: boolean };

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
      supabase.from('lms_course_defaults').select('course_id, course_code, wday, periods, classroom'),
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
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="my-course" className="text-sm font-semibold text-fg">あなたのコース</label>
      <select
        id="my-course"
        value={myCode ?? ''}
        onChange={(e) => saveCourse(e.target.value || null)}
        className="h-9 bg-surface border border-line-strong rounded-md px-2 text-sm text-fg"
      >
        <option value="">未設定</option>
        {courseOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
      </select>
      <p className="w-full text-xs text-fg-subtle">LMS のコース名から自動で入ります。コースによって決まっている時限・教室を使うために使います。</p>
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

  const save = async (courseId: number, next: Omit<CourseSetting, 'course_id'>) => {
    const { error } = await supabase.from('user_course_settings').upsert({
      user_id: userId, course_id: courseId, ...next, updated_at: new Date().toISOString(),
    });
    if (error) {
      toast.error(`保存できませんでした: ${error.message}`);
      return;
    }
    setSettings((prev) => ({ ...prev, [courseId]: { course_id: courseId, ...next } }));
    setEditing(null);
    onChanged?.();
    toast.success('保存しました。時間割に反映されます。');
  };

  if (courses === null) return <p className="text-sm text-fg-muted">読み込み中...</p>;

  if (courses.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-fg-muted leading-relaxed">
          {hasLms
            ? 'LMS の今学期のコースから時間割を作ります（1日1回自動で取り込みます）。'
            : '「LMS 連携」でログインすると、LMS の今学期のコースから時間割を作れます。'}
        </p>
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
          const slot = formatSlot(s?.wday ?? base.wday, s?.periods ?? base.periods);
          const classroom = s?.classroom || base.classroom;
          const hidden = s?.hidden ?? false;
          return (
            <li key={c.course_id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[15px] font-semibold leading-snug ${hidden ? 'text-fg-subtle line-through' : 'text-fg'}`}>{c.name}</p>
                  <p className="mt-0.5 text-sm text-fg-muted flex flex-wrap gap-x-2">
                    {slot
                      ? <span>{slot}{!s?.wday && !s?.periods && base.slotFromDefault && <span className="text-fg-subtle">（既定）</span>}</span>
                      : <span className="text-warn font-semibold">曜日・時限が未設定</span>}
                    <span>{classroom ? `教室 ${classroom}` : '教室未設定'}{!s?.classroom && base.roomFromDefault && <span className="text-fg-subtle">（既定）</span>}</span>
                    {c.attendance_id && <span>出欠あり</span>}
                    {hidden && <span>時間割に出さない</span>}
                  </p>
                </div>
                <button type="button" onClick={() => setEditing(editing === c.course_id ? null : c.course_id)} className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors">
                  <FiEdit2 size={13} aria-hidden="true" />
                  <span className="text-xs font-bold">{editing === c.course_id ? '閉じる' : '編集'}</span>
                </button>
              </div>
              {editing === c.course_id && <CourseEditor course={c} base={base} setting={s} onSave={(next) => save(c.course_id, next)} />}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-subtle">曜日・時限はコース名から読み取ります（管理者が決めた「既定」があればそちら）。1日1回、LMS から取り直します。</p>
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

function CourseEditor({ course, base, setting, onSave }: { course: Course; base: Base; setting?: CourseSetting; onSave: (next: Omit<CourseSetting, 'course_id'>) => void }) {
  // null は「既定どおり」（管理者の既定値、なければ LMS のコース名から読み取った値）
  const [wday, setWday] = useState<Weekday | null>(setting?.wday ?? null);
  const [periods, setPeriods] = useState<number[] | null>(setting?.periods ?? null);
  const [classroom, setClassroom] = useState(setting?.classroom ?? '');
  const [hidden, setHidden] = useState(setting?.hidden ?? false);
  const effectivePeriods = periods ?? base.periods ?? [];
  const togglePeriod = (p: number) => {
    const next = effectivePeriods.includes(p) ? effectivePeriods.filter((x) => x !== p) : [...effectivePeriods, p].sort();
    setPeriods(next);
  };
  const parsed = formatSlot(base.wday, base.periods);

  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-4 py-3 space-y-3">
      <p className="text-xs text-fg-subtle break-all">LMS のコース名: {course.fullname}</p>
      <div>
        <label htmlFor={`wday-${course.course_id}`} className="block text-sm font-semibold text-fg mb-1">曜日</label>
        <select
          id={`wday-${course.course_id}`}
          value={wday ?? ''}
          onChange={(e) => setWday((e.target.value || null) as Weekday | null)}
          className="h-9 bg-surface border border-line-strong rounded-md px-2 text-sm text-fg"
        >
          <option value="">{parsed ? `既定どおり（${WEEKDAY_LABELS[base.wday!]}曜）` : '未設定'}</option>
          {WEEKDAYS.map((d) => <option key={d} value={d}>{WEEKDAY_LABELS[d]}曜</option>)}
        </select>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-1">時限</legend>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((p) => {
            const on = effectivePeriods.includes(p);
            return (
              <button key={p} type="button" aria-pressed={on} onClick={() => togglePeriod(p)}
                className={`w-10 h-9 rounded-md border text-sm font-bold transition-colors ${on ? 'bg-accent-soft border-accent text-accent' : 'bg-surface border-line text-fg-muted hover:text-fg'}`}>
                {p}
              </button>
            );
          })}
          {periods && base.periods && (
            <button type="button" onClick={() => setPeriods(null)} className="ml-1 text-xs font-semibold text-link hover:underline">既定どおりに戻す</button>
          )}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`room-${course.course_id}`} className="block text-sm font-semibold text-fg mb-1">教室</label>
        <input
          id={`room-${course.course_id}`}
          value={classroom}
          maxLength={50}
          onChange={(e) => setClassroom(e.target.value)}
          placeholder={base.classroom ? `既定: ${base.classroom}` : '例: 353'}
          className="w-full sm:w-48 h-9 bg-surface border border-line-strong rounded-md px-3 text-sm text-fg"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="w-4 h-4 accent-[var(--color-accent-solid)]" />
        時間割に出さない（学年共通のコースなど）
      </label>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onSave({
            wday,
            // 既定と同じなら、上書きせず既定どおりにしておく（既定やコース名が変わったときに追従する）
            periods: periods && JSON.stringify(periods) !== JSON.stringify(base.periods) ? periods : null,
            classroom: classroom.trim() || null,
            hidden,
          })}
          className="h-9 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors"
        >
          <span className="text-sm font-bold">保存</span>
        </button>
      </div>
    </div>
  );
}
