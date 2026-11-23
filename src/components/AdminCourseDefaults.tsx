/* src/components/AdminCourseDefaults.tsx
 * 設定の「コースの既定値（管理者）」。管理者だけに出す。
 * 誰かの時間割に出てくる LMS のコースごとに、曜日・時限・時刻・教室・担当の先生の既定値を決める（lms_course_defaults）。
 * 時刻は、本来の時限とずれている授業だけ入れる（時間割・授業前の通知・カレンダー連携がその時刻に合う）。
 * 対象は「全コース共通」か、特定のコース（IA・IS など）のユーザーだけ。
 * 時間割に使う値の優先順: 本人の設定 > コース別の既定値 > 全コース共通の既定値 > LMS のコース名から読み取った値。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { WEEKDAYS, WEEKDAY_LABELS, formatHm, periodTime, type Weekday } from '../lib/schedule';
import { fetchCourseOptions } from '../lib/courses';

type LmsCourse = { course_id: number; name: string; fullname: string; wday: Weekday | null; periods: number[] | null; users: number };
/** 時限ごとの時刻（'HH:MM'。空なら時限の本来の時刻）。ずれている時限だけ入れる */
type PeriodTimes = Record<string, { start?: string; end?: string }>;
type Default = {
  id: number; course_id: number; course_code: string | null; wday: Weekday | null; periods: number[] | null;
  classroom: string | null; teacher: string | null;
  period_times: PeriodTimes | null;
  /** 授業ではない名目上のコース（時間割に出さない） */
  not_a_class: boolean;
  /** 以前の形（最初の時限の開始・最後の時限の終了）。読み込んだときに period_times に移す */
  start_time: string | null; end_time: string | null;
};
type Draft = { id?: number; course_code: string | null; wday: Weekday | null; periods: number[]; classroom: string; teacher: string; times: PeriodTimes; notAClass: boolean };

/** 'HH:MM:SS' → 'HH:MM' */
const hm = (v: string | null | undefined) => (v ? v.slice(0, 5) : '');

/** 既定値の時刻を、時限ごとの形にそろえる（以前の形の開始・終了は、最初・最後の時限に当てはめる） */
function timesOf(d: Default, periods: number[]): PeriodTimes {
  const times: PeriodTimes = { ...(d.period_times ?? {}) };
  const sorted = [...periods].sort((a, b) => a - b);
  if (sorted.length) {
    const first = String(sorted[0]);
    const last = String(sorted[sorted.length - 1]);
    if (d.start_time && !times[first]?.start) times[first] = { ...times[first], start: hm(d.start_time) };
    if (d.end_time && !times[last]?.end) times[last] = { ...times[last], end: hm(d.end_time) };
  }
  return times;
}

/** 一覧に出す時刻の要約（例: 「1限 9:00〜10:30・2限 10:40〜」） */
function timesText(times: PeriodTimes | null | undefined): string {
  const entries = Object.entries(times ?? {})
    .filter(([, t]) => t?.start || t?.end)
    .sort(([a], [b]) => Number(a) - Number(b));
  return entries.map(([p, t]) => `${p}限 ${t.start ?? ''}〜${t.end ?? ''}`).join('・');
}

const slotText = (wday: Weekday | null, periods: number[] | null) =>
  wday && periods?.length ? `${WEEKDAY_LABELS[wday]}曜 ${periods.join('・')}限` : wday ? `${WEEKDAY_LABELS[wday]}曜` : periods?.length ? `${periods.join('・')}限` : '';

export default function AdminCourseDefaults({ onChanged }: { onChanged?: () => void }) {
  const [courses, setCourses] = useState<LmsCourse[] | null>(null);
  const [defaults, setDefaults] = useState<Default[]>([]);
  const [courseOptions, setCourseOptions] = useState<{ code: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ courseId: number; draft: Draft } | null>(null);

  const load = useCallback(async () => {
    const [c, d, o] = await Promise.all([
      supabase.rpc('admin_list_lms_courses'),
      supabase.from('lms_course_defaults').select('id, course_id, course_code, wday, periods, classroom, teacher, period_times, start_time, end_time, not_a_class').order('course_code', { nullsFirst: true }),
      fetchCourseOptions(),
    ]);
    if (c.error) toast.error(`コースの一覧を読めませんでした: ${c.error.message}`);
    setCourses((c.data ?? []) as LmsCourse[]);
    setDefaults((d.data ?? []) as Default[]);
    setCourseOptions(o);
  }, []);

  useEffect(() => { load(); }, [load]);

  const courseName = (code: string | null) => (code ? courseOptions.find((o) => o.code === code)?.name ?? code : '全コース共通');

  const save = async (courseId: number, draft: Draft) => {
    const row = {
      course_id: courseId,
      course_code: draft.course_code,
      wday: draft.wday,
      periods: draft.periods.length ? [...draft.periods].sort((a, b) => a - b) : null,
      classroom: draft.classroom.trim() || null,
      teacher: draft.teacher.trim() || null,
      // 時刻は時限ごとの形で保存する（入っている時限だけ）。以前の形は使わないので空にする
      period_times: (() => {
        const kept = Object.fromEntries(
          Object.entries(draft.times)
            .filter(([, t]) => t?.start || t?.end)
            .map(([p, t]) => [p, { ...(t.start ? { start: t.start } : {}), ...(t.end ? { end: t.end } : {}) }]),
        );
        return Object.keys(kept).length ? kept : null;
      })(),
      start_time: null,
      end_time: null,
      not_a_class: draft.notAClass,
      updated_at: new Date().toISOString(),
    };
    // 同じコース・同じ対象の既定値は 1 つだけ（新規で重なったら既存を更新する）
    const existing = draft.id ?? defaults.find((d) => d.course_id === courseId && d.course_code === draft.course_code)?.id;
    const { error } = existing
      ? await supabase.from('lms_course_defaults').update(row).eq('id', existing)
      : await supabase.from('lms_course_defaults').insert(row);
    if (error) {
      toast.error(`保存できませんでした: ${error.message}`);
      return;
    }
    setEditing(null);
    await load();
    onChanged?.();
  };

  const remove = async (id: number) => {
    if (!window.confirm('この既定値を削除しますか？')) return;
    const { error } = await supabase.from('lms_course_defaults').delete().eq('id', id);
    if (error) {
      toast.error(`削除できませんでした: ${error.message}`);
      return;
    }
    await load();
    onChanged?.();
  };

  const filtered = useMemo(
    () => (courses ?? []).filter((c) => !query || c.name.includes(query) || c.fullname.includes(query)),
    [courses, query],
  );

  if (courses === null) return <p className="text-sm text-fg-muted">読み込み中...</p>;

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="コース名で絞り込む"
        className="w-full h-10 bg-surface border border-line-strong rounded-md px-3 text-sm text-fg"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-fg-muted">対象のコースがありません（ユーザーが LMS から取り込んだコースが出ます）。</p>
      ) : (
        <ul className="divide-y divide-line border border-line rounded-lg">
          {filtered.map((c) => {
            const rows = defaults.filter((d) => d.course_id === c.course_id);
            const parsed = slotText(c.wday, c.periods);
            return (
              <li key={c.course_id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold text-fg leading-snug">{c.name}</p>
                    <p className="mt-0.5 text-xs text-fg-subtle break-all">{c.fullname}</p>
                    <p className="mt-0.5 text-sm text-fg-muted">
                      {rows.some((d) => d.not_a_class && d.course_code === null)
                        ? <span className="font-semibold text-fg-subtle">授業ではない（時間割に出さない）</span>
                        : parsed ? `コース名から: ${parsed}` : <span className="text-warn font-semibold">コース名から曜日・時限を読み取れません</span>}
                      <span className="ml-2">{c.users}人</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing({ courseId: c.course_id, draft: { course_code: null, wday: null, periods: [], classroom: '', teacher: '', times: {}, notAClass: false } })}
                    className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors"
                  >
                    <FiPlus size={13} aria-hidden="true" />
                    <span className="text-xs font-bold">既定値を追加</span>
                  </button>
                </div>

                {rows.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {rows.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <span className="font-semibold text-fg">{courseName(d.course_code)}</span>
                          <span className="ml-2 text-fg-muted">{[d.not_a_class && '授業ではない', slotText(d.wday, d.periods), timesText(timesOf(d, d.periods ?? c.periods ?? [])) && `時刻 ${timesText(timesOf(d, d.periods ?? c.periods ?? []))}`, d.classroom && `教室 ${d.classroom}`, d.teacher && `担当 ${d.teacher}`].filter(Boolean).join('・') || '（値なし）'}</span>
                        </span>
                        <span className="flex-shrink-0 flex items-center gap-1">
                          <button type="button" aria-label="編集" onClick={() => setEditing({ courseId: c.course_id, draft: { id: d.id, course_code: d.course_code, wday: d.wday, periods: d.periods ?? [], classroom: d.classroom ?? '', teacher: d.teacher ?? '', times: timesOf(d, d.periods ?? c.periods ?? []), notAClass: d.not_a_class } })} className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3"><FiEdit2 size={14} /></button>
                          <button type="button" aria-label="削除" onClick={() => remove(d.id)} className="p-1.5 rounded-md text-down hover:bg-down-soft"><FiTrash2 size={14} /></button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {editing?.courseId === c.course_id && (
                  <DefaultEditor
                    draft={editing.draft}
                    coursePeriods={c.periods ?? []}
                    courseOptions={courseOptions}
                    onCancel={() => setEditing(null)}
                    onSave={(draft) => save(c.course_id, draft)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DefaultEditor({ draft, coursePeriods, courseOptions, onCancel, onSave }: {
  draft: Draft;
  /** コース名から読み取った時限（既定値で時限を選んでいないときに、時刻を入れる時限として使う） */
  coursePeriods: number[];
  courseOptions: { code: string; name: string }[];
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const toggle = (p: number) => setD((x) => ({ ...x, periods: x.periods.includes(p) ? x.periods.filter((y) => y !== p) : [...x.periods, p] }));
  // 時刻を入れる時限: この既定値で選んだ時限、なければコース名から読み取った時限
  const timePeriods = [...(d.periods.length ? d.periods : coursePeriods)].sort((a, b) => a - b);
  const setTime = (p: number, key: 'start' | 'end', value: string) =>
    setD((x) => ({ ...x, times: { ...x.times, [String(p)]: { ...x.times[String(p)], [key]: value } } }));
  // 開始が終了より後になっている時限がないか
  const badPeriod = timePeriods.find((p) => { const t = d.times[String(p)]; return t?.start && t?.end && t.start >= t.end; });
  const timeError = !d.notAClass && badPeriod ? `${badPeriod}限: 終了は開始より後にしてください` : null;
  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-4 py-3 space-y-3">
      {/* 名目上のコース（お知らせ用など、曜日・時限がそもそもない）は「授業ではない」にして時間割に出さない */}
      <label className="flex items-start gap-2 text-sm text-fg">
        <input type="checkbox" checked={d.notAClass} onChange={(e) => setD({ ...d, notAClass: e.target.checked })} className="mt-0.5 w-4 h-4 accent-[var(--color-accent-solid)]" />
        <span>
          <span className="font-semibold">授業ではない</span>
          <span className="block text-xs text-fg-muted">お知らせ用など、曜日・時限がそもそもない名目上のコース。対象の学生の時間割に出しません。</span>
        </span>
      </label>
      {d.notAClass && (
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-semibold text-fg mb-1">対象</label>
            <select value={d.course_code ?? ''} onChange={(e) => setD({ ...d, course_code: e.target.value || null })} className="h-9 bg-surface border border-line-strong rounded-md px-2 text-sm text-fg">
              <option value="">全コース共通</option>
              {courseOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
            </select>
          </div>
        </div>
      )}
      {!d.notAClass && (<>
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="block text-sm font-semibold text-fg mb-1">対象</label>
          <select value={d.course_code ?? ''} onChange={(e) => setD({ ...d, course_code: e.target.value || null })} className="h-9 bg-surface border border-line-strong rounded-md px-2 text-sm text-fg">
            <option value="">全コース共通</option>
            {courseOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-fg mb-1">曜日</label>
          <select value={d.wday ?? ''} onChange={(e) => setD({ ...d, wday: (e.target.value || null) as Weekday | null })} className="h-9 bg-surface border border-line-strong rounded-md px-2 text-sm text-fg">
            <option value="">指定しない</option>
            {WEEKDAYS.map((w) => <option key={w} value={w}>{WEEKDAY_LABELS[w]}曜</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-fg mb-1">教室</label>
          <input value={d.classroom} maxLength={50} onChange={(e) => setD({ ...d, classroom: e.target.value })} placeholder="例: 353" className="w-32 h-9 bg-surface border border-line-strong rounded-md px-3 text-sm text-fg" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-fg mb-1">担当の先生</label>
          <input value={d.teacher} maxLength={100} onChange={(e) => setD({ ...d, teacher: e.target.value })} placeholder="空なら LMS の担当" className="w-48 h-9 bg-surface border border-line-strong rounded-md px-3 text-sm text-fg" />
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-1">時限（指定しないならどれも選ばない）</legend>
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((p) => (
            <button key={p} type="button" aria-pressed={d.periods.includes(p)} onClick={() => toggle(p)}
              className={`w-10 h-9 rounded-md border text-sm font-bold transition-colors ${d.periods.includes(p) ? 'bg-accent-soft border-accent text-accent' : 'bg-surface border-line text-fg-muted hover:text-fg'}`}>
              {p}
            </button>
          ))}
        </div>
      </fieldset>
      {/* 授業の時刻: 時限ごとに、本来の時刻とずれているときだけ入れる（例: 水曜 1〜4 限がすべてずれている授業） */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg mb-1">時刻（本来の時限とずれている時限だけ）</legend>
        {timePeriods.length === 0 ? (
          <p className="text-xs text-fg-subtle">先に時限を選ぶと、時限ごとの時刻を入れられます。</p>
        ) : (
          <div className="space-y-1.5">
            {timePeriods.map((p) => {
              const t = d.times[String(p)] ?? {};
              const base = periodTime(p);
              const bad = t.start && t.end && t.start >= t.end;
              return (
                <div key={p} className="flex flex-wrap items-center gap-2">
                  <span className="w-10 text-sm font-bold text-accent">{p}限</span>
                  <input type="time" aria-label={`${p}限の開始`} value={t.start ?? ''} onChange={(e) => setTime(p, 'start', e.target.value)} className={`h-9 bg-surface border rounded-md px-2 text-sm text-fg tabular-nums ${bad ? 'border-down' : 'border-line-strong'}`} />
                  <span className="text-fg-muted">〜</span>
                  <input type="time" aria-label={`${p}限の終了`} value={t.end ?? ''} onChange={(e) => setTime(p, 'end', e.target.value)} className={`h-9 bg-surface border rounded-md px-2 text-sm text-fg tabular-nums ${bad ? 'border-down' : 'border-line-strong'}`} />
                  {base && <span className="text-xs text-fg-subtle tabular-nums">本来 {formatHm(base.start)}〜{formatHm(base.end)}</span>}
                </div>
              );
            })}
            {Object.values(d.times).some((t) => t?.start || t?.end) && (
              <button type="button" onClick={() => setD({ ...d, times: {} })} className="h-8 px-3 rounded-md text-fg-muted hover:bg-surface-3"><span className="text-xs font-bold">すべて本来の時刻に戻す</span></button>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-fg-subtle">空のままの時限は本来の時刻です。時間割・授業前の通知・カレンダー連携がこの時刻に合います。</p>
        {timeError && <p role="alert" className="mt-1 text-xs text-down font-semibold">{timeError}</p>}
      </fieldset>
      </>)}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 px-4 rounded-md text-fg-muted hover:bg-surface-3"><span className="text-sm font-bold">やめる</span></button>
        <button type="button" onClick={() => onSave({ ...d, times: Object.fromEntries(Object.entries(d.times).filter(([p]) => timePeriods.includes(Number(p)))) })} disabled={!!timeError} className="h-9 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent disabled:opacity-50"><span className="text-sm font-bold">保存</span></button>
      </div>
    </div>
  );
}
