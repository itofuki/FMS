/* src/components/AdminCourseDefaults.tsx
 * 設定の「コースの既定値（管理者）」。管理者だけに出す。
 * 誰かの時間割に出てくる LMS のコースごとに、曜日・時限・教室・担当の先生の既定値を決める（lms_course_defaults）。
 * 対象は「全コース共通」か、特定のコース（IA・IS など）のユーザーだけ。
 * 時間割に使う値の優先順: 本人の設定 > コース別の既定値 > 全コース共通の既定値 > LMS のコース名から読み取った値。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { WEEKDAYS, WEEKDAY_LABELS, type Weekday } from '../lib/schedule';
import { fetchCourseOptions } from '../lib/courses';

type LmsCourse = { course_id: number; name: string; fullname: string; wday: Weekday | null; periods: number[] | null; users: number };
type Default = { id: number; course_id: number; course_code: string | null; wday: Weekday | null; periods: number[] | null; classroom: string | null; teacher: string | null };
type Draft = { id?: number; course_code: string | null; wday: Weekday | null; periods: number[]; classroom: string; teacher: string };

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
      supabase.from('lms_course_defaults').select('id, course_id, course_code, wday, periods, classroom, teacher').order('course_code', { nullsFirst: true }),
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
                      {parsed ? `コース名から: ${parsed}` : <span className="text-warn font-semibold">コース名から曜日・時限を読み取れません</span>}
                      <span className="ml-2">{c.users}人</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing({ courseId: c.course_id, draft: { course_code: null, wday: null, periods: [], classroom: '', teacher: '' } })}
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
                          <span className="ml-2 text-fg-muted">{[slotText(d.wday, d.periods), d.classroom && `教室 ${d.classroom}`, d.teacher && `担当 ${d.teacher}`].filter(Boolean).join('・') || '（値なし）'}</span>
                        </span>
                        <span className="flex-shrink-0 flex items-center gap-1">
                          <button type="button" aria-label="編集" onClick={() => setEditing({ courseId: c.course_id, draft: { id: d.id, course_code: d.course_code, wday: d.wday, periods: d.periods ?? [], classroom: d.classroom ?? '', teacher: d.teacher ?? '' } })} className="p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3"><FiEdit2 size={14} /></button>
                          <button type="button" aria-label="削除" onClick={() => remove(d.id)} className="p-1.5 rounded-md text-down hover:bg-down-soft"><FiTrash2 size={14} /></button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {editing?.courseId === c.course_id && (
                  <DefaultEditor
                    draft={editing.draft}
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

function DefaultEditor({ draft, courseOptions, onCancel, onSave }: {
  draft: Draft;
  courseOptions: { code: string; name: string }[];
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const toggle = (p: number) => setD((x) => ({ ...x, periods: x.periods.includes(p) ? x.periods.filter((y) => y !== p) : [...x.periods, p] }));
  return (
    <div className="mt-3 rounded-lg bg-surface-2 px-4 py-3 space-y-3">
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
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-9 px-4 rounded-md text-fg-muted hover:bg-surface-3"><span className="text-sm font-bold">やめる</span></button>
        <button type="button" onClick={() => onSave(d)} className="h-9 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent"><span className="text-sm font-bold">保存</span></button>
      </div>
    </div>
  );
}
