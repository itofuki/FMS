/* src/components/AdminClassExceptions.tsx
 * 設定の「管理者」タブの「授業の変更」。イレギュラーな授業回を日付を指定して登録する（class_exceptions）。
 *   - 時刻・教室の変更 : その日だけ時刻や教室が違う
 *   - 休講             : その日は授業がない
 *   - 補講・振替       : いつもはない日・時限に授業を足す
 * 登録した日は、時間割の画面・授業前の通知・カレンダー連携のすべてでこちらを優先する。
 * 対象は「全コース共通」か、特定のコース（IA・IS など）のユーザーだけ（コースの既定値と同じ）。
 *
 * 時間割として決まっている「いつもの授業」（コース名から読み取った曜日・時限 ＋ コースの既定値の時刻・教室）を正とし、
 * 授業を選ぶとその曜日・時限・時刻・教室を出して、そこから変えた分だけを登録する。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { fetchCourseOptions } from '../lib/courses';
import { dbErrorText } from '../lib/dbError';
import { WEEKDAY_LABELS, nowInJst, periodTime, toYmd, type Weekday } from '../lib/schedule';
import { Segmented } from './ui/SettingControls';

type Kind = 'change' | 'cancel' | 'extra';
type LmsCourse = { course_id: number; name: string; fullname: string; wday: Weekday | null; periods: number[] | null };
type PeriodTimes = Record<string, { start?: string; end?: string }>;
/** コースの既定値（lms_course_defaults）のうち、いつもの授業を決めるのに使うもの */
type CourseDefault = {
  course_id: number; course_code: string | null; wday: Weekday | null; periods: number[] | null;
  classroom: string | null; period_times: PeriodTimes | null; start_time: string | null; end_time: string | null;
  not_a_class: boolean;
};
/** いつもの授業（曜日・時限・時限ごとの時刻・教室） */
type Usual = { wday: Weekday | null; periods: number[]; times: Record<number, { start: string; end: string }>; classroom: string };
/** 登録済みの授業の変更（1 つの授業・1 日・1 対象につき 1 件） */
type Row = {
  id: number; course_id: number; course_code: string | null; date: string; kind: Kind;
  periods: number[] | null; period_times: PeriodTimes | null; classroom: string | null; note: string | null;
};
/** periods: 対象の時限（コースの既定値と同じボタンで選ぶ）。times: 時限ごとの時刻（いつもの時刻が入っていて、そこから変える） */
/** id: 編集中の登録（新しく登録するときは空） */
type Draft = { id?: number; courseId: string; courseCode: string; kind: Kind; date: string; periods: number[]; times: Record<number, { start: string; end: string }>; classroom: string; note: string };

const KIND_OPTIONS: { value: Kind; label: string }[] = [
  { value: 'change', label: '時刻・教室の変更' },
  { value: 'cancel', label: '休講' },
  { value: 'extra', label: '補講・振替' },
];
const KIND_LABEL: Record<Kind, string> = { change: '変更', cancel: '休講', extra: '補講' };
const KIND_CLASS: Record<Kind, string> = {
  change: 'bg-warn-soft text-warn border-warn/40',
  cancel: 'bg-down-soft text-down border-down/40',
  extra: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/40',
};
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const hm = (v: string | null) => (v ? v.slice(0, 5) : '');
const dateLabel = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}（${WD[new Date(y, m - 1, d).getDay()]}）`;
};
const emptyDraft = (): Draft => ({ courseId: '', courseCode: '', kind: 'change', date: '', periods: [], times: {}, classroom: '', note: '' });

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: { h: number; m: number }) => `${pad(t.h)}:${pad(t.m)}`;
const WEEKDAY_INDEX: Record<Weekday, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };

/**
 * いつもの授業: コース別の既定値 > 全コース共通の既定値 > LMS のコース名から読み取った値（時間割と同じ優先順）。
 * 時刻は時限ごとに、既定値で調整した時刻、なければ時限の本来の時刻。
 */
function usualOf(course: LmsCourse | undefined, defaults: CourseDefault[], code: string): Usual | null {
  if (!course) return null;
  const dc = code ? defaults.find((d) => d.course_id === course.course_id && d.course_code === code) : undefined;
  const da = defaults.find((d) => d.course_id === course.course_id && d.course_code === null);
  const periods = [...(dc?.periods ?? da?.periods ?? course.periods ?? [])].sort((a, b) => a - b);
  const times: Usual['times'] = {};
  periods.forEach((p, i) => {
    const base = periodTime(p);
    if (!base) return;
    const own = dc?.period_times?.[String(p)] ?? da?.period_times?.[String(p)];
    // 以前の形（最初の時限の開始・最後の時限の終了）
    const legacyStart = i === 0 ? hm(dc?.start_time ?? da?.start_time ?? null) : '';
    const legacyEnd = i === periods.length - 1 ? hm(dc?.end_time ?? da?.end_time ?? null) : '';
    times[p] = { start: own?.start || legacyStart || hhmm(base.start), end: own?.end || legacyEnd || hhmm(base.end) };
  });
  return { wday: dc?.wday ?? da?.wday ?? course.wday, periods, times, classroom: dc?.classroom ?? da?.classroom ?? '' };
}

/** その曜日の、今日以降でいちばん近い日（YYYY-MM-DD） */
function nextDateOf(wday: Weekday | null, today: string): string {
  if (!wday) return today;
  const [y, m, d] = today.split('-').map(Number);
  const x = new Date(y, m - 1, d);
  const diff = (WEEKDAY_INDEX[wday] - x.getDay() + 7) % 7;
  x.setDate(x.getDate() + diff);
  return toYmd(x);
}

/**
 * その時限の既定の時刻（既定値にない時限なら、時限の本来の時刻）。
 * 補講は既定値の日とは別の日に行うので、いつも本来の時刻と比べる（plain = true）
 */
function usualTimeOf(usual: Usual | null, p: number, plain = false): { start: string; end: string } {
  const own = plain ? undefined : usual?.times[p];
  if (own) return own;
  const base = periodTime(p);
  return base ? { start: hhmm(base.start), end: hhmm(base.end) } : { start: '', end: '' };
}

const inputClass = 'h-9 bg-surface border border-line-strong rounded-md px-2.5 text-sm text-fg';

export default function AdminClassExceptions({ onChanged }: { onChanged?: () => void }) {
  const [courses, setCourses] = useState<LmsCourse[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [courseOptions, setCourseOptions] = useState<{ code: string; name: string }[]>([]);
  const [courseDefaults, setCourseDefaults] = useState<CourseDefault[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const today = toYmd(nowInJst());

  const load = useCallback(async () => {
    const [c, r, o, d] = await Promise.all([
      supabase.rpc('admin_list_lms_courses'),
      // 今日以降のもの（過ぎたものは出さない）
      supabase.from('class_exceptions')
        .select('id, course_id, course_code, date, kind, periods, period_times, classroom, note')
        .gte('date', today)
        .order('date').order('course_id'),
      fetchCourseOptions(),
      supabase.from('lms_course_defaults').select('course_id, course_code, wday, periods, classroom, period_times, start_time, end_time, not_a_class'),
    ]);
    if (c.error) toast.error(`コースの一覧を読めませんでした: ${dbErrorText(c.error)}`);
    setCourseDefaults((d.data ?? []) as CourseDefault[]);
    if (r.error) toast.error(`授業の変更を読めませんでした: ${dbErrorText(r.error)}`);
    setCourses(((c.data ?? []) as LmsCourse[]).sort((a, b) => a.name.localeCompare(b.name, 'ja')));
    setRows((r.data ?? []) as Row[]);
    setCourseOptions(o);
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const courseName = (id: number) => courses.find((c) => c.course_id === id)?.name ?? `コース ${id}`;
  const targetName = (code: string | null) => (code ? courseOptions.find((o) => o.code === code)?.name ?? code : '');

  // 選んだ授業のいつもの授業（対象のコースの既定値も含めて）
  const usual = useMemo(
    () => (draft ? usualOf(courses.find((c) => String(c.course_id) === draft.courseId), courseDefaults, draft.courseCode) : null),
    [draft, courses, courseDefaults],
  );
  const usualRoom = usual?.classroom ?? '';
  // 変更・休講で、選んだ日がいつもの曜日でないとき
  const offDay = !!(draft && usual?.wday && draft.date && draft.kind !== 'extra'
    && new Date(`${draft.date}T12:00:00`).getDay() !== WEEKDAY_INDEX[usual.wday]);
  const selected = draft ? [...draft.periods].sort((a, b) => a - b) : [];
  // 既定値の時限から選び直したか（時限を動かした・減らした・増やした）
  const periodsChanged = !!draft && JSON.stringify(selected) !== JSON.stringify(usual?.periods ?? []);
  const timeChanged = (p: number, key: 'start' | 'end') => !!draft && (draft.times[p]?.[key] ?? '') !== usualTimeOf(usual, p, draft?.kind === 'extra')[key];

  // 入力の確認（足りないものがあれば、その理由）
  const problem = useMemo(() => {
    if (!draft) return null;
    if (!draft.courseId) return '授業を選んでください';
    if (!draft.date) return '日付を選んでください';
    if (selected.length === 0) return '時限を選んでください';
    const bad = selected.find((p) => { const t = draft.times[p]; return t?.start && t?.end && t.start >= t.end; });
    if (bad) return `${bad}限: 終了は開始より後にしてください`;
    if (draft.kind === 'change' && !periodsChanged && !selected.some((p) => timeChanged(p, 'start') || timeChanged(p, 'end')) && draft.classroom.trim() === usualRoom)
      return '既定値から、時限・時刻・教室のどれかを変えてください';
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, usual, usualRoom]);

  const save = async () => {
    if (!draft || problem) return;
    const courseId = Number(draft.courseId);
    const code = draft.courseCode || null;
    // 1 つの授業・1 日・1 対象につき 1 件。編集中ならその登録を、新しく登録するときは同じ授業・日の登録があれば置き換える
    const existing = draft.id != null
      ? rows?.find((r) => r.id === draft.id)
      : rows?.find((r) => r.course_id === courseId && (r.course_code ?? null) === code && r.date === draft.date);
    // 編集で授業・日・対象を変えて、ほかの登録と重なるとき
    const clash = draft.id != null && rows?.find((r) => r.id !== draft.id && r.course_id === courseId && (r.course_code ?? null) === code && r.date === draft.date);
    if (clash) {
      toast.error(`${dateLabel(draft.date)} の${courseName(courseId)}には、ほかの変更が登録されています。先にそちらを削除してください。`);
      return;
    }
    if (existing && draft.id == null && !window.confirm(`${dateLabel(draft.date)} の${courseName(courseId)}には、すでに変更（${KIND_LABEL[existing.kind]}）が登録されています。置き換えますか？`)) return;
    setSaving(true);
    // 時限: 既定値の時限と同じなら空（既定値どおり）。補講は足す時限
    const periods = draft.kind !== 'extra' && !periodsChanged ? null : selected;
    // 時刻: 既定値（補講は本来の時刻）と違う時限の、違うところだけ
    const times: PeriodTimes = {};
    if (draft.kind !== 'cancel') {
      for (const p of selected) {
        const t: { start?: string; end?: string } = {};
        if (timeChanged(p, 'start') && draft.times[p]?.start) t.start = draft.times[p].start;
        if (timeChanged(p, 'end') && draft.times[p]?.end) t.end = draft.times[p].end;
        if (t.start || t.end) times[String(p)] = t;
      }
    }
    const row = {
      course_id: courseId,
      course_code: code,
      date: draft.date,
      kind: draft.kind,
      periods,
      period_times: Object.keys(times).length ? times : null,
      classroom: draft.kind === 'cancel' || !draft.classroom.trim() || draft.classroom.trim() === usualRoom ? null : draft.classroom.trim(),
      note: draft.note.trim() || null,
    };
    const { error } = existing
      ? await supabase.from('class_exceptions').update(row).eq('id', existing.id)
      : await supabase.from('class_exceptions').insert(row);
    setSaving(false);
    if (error) {
      toast.error(`登録できませんでした: ${dbErrorText(error)}`);
      return;
    }
    setDraft(null);
    await load();
    onChanged?.();
  };

  const remove = async (row: Row) => {
    if (!window.confirm(`${dateLabel(row.date)} ${courseName(row.course_id)} の${KIND_LABEL[row.kind]}を削除しますか？`)) return;
    const { error } = await supabase.from('class_exceptions').delete().eq('id', row.id);
    if (error) {
      toast.error(`削除できませんでした: ${dbErrorText(error)}`);
      return;
    }
    await load();
    onChanged?.();
  };

  if (rows === null) return <p className="text-sm text-fg-muted">読み込み中...</p>;

  /**
   * 入力を変える。授業・対象・種類が変わったら、いつもの授業の時限・時刻・教室を入れ直す（そこから変えてもらう）。
   * 授業を選び直したときは、日付をその授業のいつもの曜日のいちばん近い日にする
   */
  const changeDraft = (patch: Partial<Draft>, courseChanged = false) => {
    setDraft((d) => {
      if (!d) return d;
      let next = { ...d, ...patch };
      if (courseChanged || 'courseCode' in patch || 'kind' in patch) {
        const u = usualOf(courses.find((c) => String(c.course_id) === next.courseId), courseDefaults, next.courseCode);
        // 変更・休講はいつもの時限をすべて選んだ状態から。補講は何も選ばない状態から
        const periods = next.kind === 'extra' ? [] : [...(u?.periods ?? [])];
        next = {
          ...next,
          periods,
          times: Object.fromEntries(periods.map((p) => [p, usualTimeOf(u, p, next.kind === 'extra')])),
          classroom: u?.classroom ?? '',
          date: courseChanged && next.kind !== 'extra' ? nextDateOf(u?.wday ?? null, today) : next.date,
        };
      }
      return next;
    });
  };

  /** 登録済みの変更を編集する（登録した内容を、既定値に重ねてフォームに入れる） */
  const startEdit = (r: Row) => {
    const u = usualOf(courses.find((c) => c.course_id === r.course_id), courseDefaults, r.course_code ?? '');
    const periods = [...(r.periods ?? u?.periods ?? [])].sort((a, b) => a - b);
    setDraft({
      id: r.id,
      courseId: String(r.course_id),
      courseCode: r.course_code ?? '',
      kind: r.kind,
      date: r.date,
      periods,
      times: Object.fromEntries(periods.map((p) => {
        const base = usualTimeOf(u, p, r.kind === 'extra');
        const own = r.period_times?.[String(p)];
        return [p, { start: own?.start || base.start, end: own?.end || base.end }];
      })),
      classroom: r.classroom ?? u?.classroom ?? '',
      note: r.note ?? '',
    });
    requestAnimationFrame(() => document.getElementById('ex-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  /** 時限のボタン: 選ぶと、その時限のいつもの時刻を入れる */
  const togglePeriod = (p: number) => {
    setDraft((d) => {
      if (!d) return d;
      const on = d.periods.includes(p);
      return {
        ...d,
        periods: on ? d.periods.filter((x) => x !== p) : [...d.periods, p],
        times: on ? d.times : { ...d.times, [p]: d.times[p] ?? usualTimeOf(usual, p, d.kind === 'extra') },
      };
    });
  };
  const setTime = (p: number, key: 'start' | 'end', value: string) =>
    setDraft((d) => (d ? { ...d, times: { ...d.times, [p]: { ...(d.times[p] ?? usualTimeOf(usual, p, d.kind === 'extra')), [key]: value } } } : d));

  return (
    <div className="space-y-3">
      {/* 登録済み（今日以降） */}
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">これからの授業の変更はありません。</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-lg">
          {rows.map((r) => {
            // 時限: 登録した時限、なければ既定値の時限（実際の時限を出す）
            const ps = r.periods?.length ? r.periods : usualOf(courses.find((c) => c.course_id === r.course_id), courseDefaults, r.course_code ?? '')?.periods ?? [];
            return (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0 text-sm">
                  {/* 1 行目: 種類のしるしと授業名 */}
                  <p className="flex items-center gap-2">
                    <span className={`flex-shrink-0 inline-flex items-center h-5 px-2 rounded-full border text-xs font-bold ${KIND_CLASS[r.kind]}`}><span className="pill-text">{KIND_LABEL[r.kind]}</span></span>
                    <span className="font-semibold text-fg truncate">{courseName(r.course_id)}</span>
                  </p>
                  {/* 2 行目: 日付・時限・時刻・教室・対象・メモ */}
                  <p className="mt-1 text-fg-muted">
                    <span className="font-semibold text-fg tabular-nums">{dateLabel(r.date)}</span>
                    {[
                      ps.length > 0 && `${[...ps].sort((a, b) => a - b).join('・')}限`,
                      Object.keys(r.period_times ?? {}).length > 0 && `時刻 ${Object.entries(r.period_times ?? {})
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([p, t]) => `${p}限 ${t.start ?? ''}〜${t.end ?? ''}`).join('・')}`,
                      r.classroom && `教室 ${r.classroom}`,
                      targetName(r.course_code) && `対象 ${targetName(r.course_code)}`,
                      r.note,
                    ].filter(Boolean).map((t) => <span key={String(t)}><span className="mx-1.5 text-fg-subtle">·</span>{t}</span>)}
                  </p>
                </div>
                <span className="flex-shrink-0 flex items-center gap-1">
                  <button type="button" aria-label="編集" onClick={() => startEdit(r)} className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3"><FiEdit2 size={14} /></button>
                  <button type="button" aria-label="削除" onClick={() => remove(r)} className="p-1.5 rounded-md text-down hover:bg-down-soft"><FiTrash2 size={14} /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* 追加 */}
      {!draft ? (
        <button type="button" onClick={() => setDraft({ ...emptyDraft(), date: today })} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors">
          <FiPlus size={14} aria-hidden="true" />
          <span className="pill-text text-sm font-bold">授業の変更を登録</span>
        </button>
      ) : (
        <div id="ex-form" className="scroll-mt-20 rounded-lg bg-surface-2 px-4 py-3 space-y-3">
          {draft.id != null && <p className="text-sm font-bold text-fg">変更を編集</p>}
          {/* 1. 授業（選ぶと、いつもの授業の内容が下の欄に入る） */}
          <div>
            <label htmlFor="ex-course" className="block text-sm font-semibold text-fg mb-1">授業</label>
            <select id="ex-course" value={draft.courseId} onChange={(e) => changeDraft({ courseId: e.target.value }, true)} className={`${inputClass} w-full max-w-md`}>
              <option value="">選んでください</option>
              {/* 授業ではない名目上のコースは選べない */}
              {courses
                .filter((c) => !courseDefaults.some((d) => d.course_id === c.course_id && d.course_code === null && d.not_a_class))
                .map((c) => <option key={c.course_id} value={c.course_id}>{c.name}</option>)}
            </select>
          </div>

          {draft.courseId && (
            <>
              {/* いつもの授業（時間割として決まっているもの。ここから変える） */}
              <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <p className="font-semibold text-fg">
                  既定値：
                  {usual?.wday ? `${WEEKDAY_LABELS[usual.wday]}曜 ` : '曜日未設定 '}
                  {usual?.periods.length ? `${usual.periods.join('・')}限` : '時限未設定'}
                  <span className="ml-2 font-normal text-fg-muted">教室 {usual?.classroom || '未設定'}</span>
                </p>
                {!!usual?.periods.length && (
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-fg-muted tabular-nums">
                    {usual.periods.map((p) => {
                      const t = usual.times[p];
                      const base = periodTime(p);
                      const shifted = base && t && (t.start !== hhmm(base.start) || t.end !== hhmm(base.end));
                      return (
                        <span key={p} className="whitespace-nowrap">
                          {p}限 <span className={shifted ? 'text-warn font-semibold' : ''}>{t?.start}〜{t?.end}</span>
                        </span>
                      );
                    })}
                  </p>
                )}
              </div>

              {/* 2. 種類 */}
              <Segmented label="種類" options={KIND_OPTIONS} value={draft.kind} onChange={(kind) => changeDraft({ kind })} />

              {/* 3. 日付・時限・対象 */}
              <div className="flex flex-wrap gap-4">
                <div>
                  <label htmlFor="ex-date" className="block text-sm font-semibold text-fg mb-1">日付</label>
                  <input id="ex-date" type="date" value={draft.date} onChange={(e) => changeDraft({ date: e.target.value })} className={`${inputClass} tabular-nums`} />
                  {draft.date && <p className="mt-1 text-xs text-fg-muted">{dateLabel(draft.date)}</p>}
                </div>
                <div>
                  <label htmlFor="ex-target" className="block text-sm font-semibold text-fg mb-1">対象</label>
                  <select id="ex-target" value={draft.courseCode} onChange={(e) => changeDraft({ courseCode: e.target.value })} className={inputClass}>
                    <option value="">全コース共通</option>
                    {courseOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              {offDay && usual?.wday && (
                <p className="text-xs text-warn font-semibold">この日は{WEEKDAY_LABELS[usual.wday]}曜ではありません（既定値では授業がない日です）。別の日に授業を足すときは「補講・振替」を選んでください。</p>
              )}

              {/* 4. 時限（コースの既定値と同じボタン）。変更・休講はいつもの時限が選ばれた状態から */}
              <fieldset>
                <legend className="text-sm font-semibold text-fg mb-1">時限{draft.kind === 'extra' ? '（補講を行う時限）' : ''}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((p) => {
                    const on = draft.periods.includes(p);
                    const isUsual = !!usual?.periods.includes(p);
                    return (
                      <button key={p} type="button" aria-pressed={on} onClick={() => togglePeriod(p)}
                        title={isUsual ? '既定値の時限' : undefined}
                        className={`w-10 h-9 rounded-md border text-sm font-bold transition-colors ${on ? 'bg-accent-soft border-accent text-accent' : 'bg-surface border-line text-fg-muted hover:text-fg'} ${isUsual && !on ? 'border-dashed border-accent/50' : ''}`}>
                        {p}
                      </button>
                    );
                  })}
                </div>
                {draft.kind === 'change' && <p className="mt-1 text-xs text-fg-subtle">既定値の時限が選ばれています。その日の授業の時限に選び直してください（例: 2 限 → 4 限に動かすなら 2 を外して 4 を選ぶ）。</p>}
                {draft.kind === 'cancel' && <p className="mt-1 text-xs text-fg-subtle">既定値の時限が選ばれています。一部の時限だけ休むときは、ほかの時限を外してください。</p>}
              </fieldset>

              {/* 5. 時刻（時限ごと。いつもの時刻が入っている）と教室。変えたところだけ登録する */}
              {draft.kind !== 'cancel' && selected.length > 0 && (
                <fieldset>
                  <legend className="text-sm font-semibold text-fg mb-1">時刻</legend>
                  <div className="space-y-1.5">
                    {selected.map((p) => {
                      const t = draft.times[p] ?? usualTimeOf(usual, p, draft?.kind === 'extra');
                      const u = usualTimeOf(usual, p, draft?.kind === 'extra');
                      return (
                        <div key={p} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="w-10 text-sm font-bold text-accent">{p}限</span>
                          <input type="time" aria-label={`${p}限の開始`} value={t.start} onChange={(e) => setTime(p, 'start', e.target.value)} className={`w-[6.75rem] ${inputClass} tabular-nums ${timeChanged(p, 'start') ? '!border-warn !bg-warn-soft' : ''}`} />
                          <span className="text-fg-muted">〜</span>
                          <input type="time" aria-label={`${p}限の終了`} value={t.end} onChange={(e) => setTime(p, 'end', e.target.value)} className={`w-[6.75rem] ${inputClass} tabular-nums ${timeChanged(p, 'end') ? '!border-warn !bg-warn-soft' : ''}`} />
                          <span className="basis-full sm:basis-auto pl-12 sm:pl-0 text-xs text-fg-subtle tabular-nums">{usual?.times[p] ? '既定' : '本来'} {u.start}〜{u.end}</span>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              )}
              {draft.kind !== 'cancel' && (
                <div>
                  <label htmlFor="ex-room" className="block text-sm font-semibold text-fg mb-1">教室</label>
                  <input id="ex-room" value={draft.classroom} maxLength={50} onChange={(e) => changeDraft({ classroom: e.target.value })} placeholder="例: 401" className={`${inputClass} w-32 ${draft.classroom.trim() !== usualRoom ? '!border-warn !bg-warn-soft' : ''}`} />
                  <span className="ml-2 text-xs text-fg-muted">既定 {usualRoom || '未設定'}</span>
                </div>
              )}
              {draft.kind !== 'cancel' && <p className="text-xs text-fg-subtle">既定値と違う欄は黄色になります。登録されるのは、既定値と違うところだけです。</p>}

              <div>
                <label htmlFor="ex-note" className="block text-sm font-semibold text-fg mb-1">メモ（任意。時間割に出ます）</label>
                <input id="ex-note" value={draft.note} maxLength={200} onChange={(e) => changeDraft({ note: e.target.value })} placeholder="例: 第5回の振替" className={`${inputClass} w-full`} />
              </div>
            </>
          )}
          {problem && <p role="alert" className="text-xs text-down font-semibold">{problem}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="h-9 px-4 rounded-md text-fg-muted hover:bg-surface-3"><span className="text-sm font-bold">やめる</span></button>
            <button type="button" onClick={save} disabled={!!problem || saving} className="h-9 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent disabled:opacity-50"><span className="text-sm font-bold">{saving ? '保存中...' : draft.id != null ? '保存' : '登録'}</span></button>
          </div>
        </div>
      )}
    </div>
  );
}
