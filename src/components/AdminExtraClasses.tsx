/* src/components/AdminExtraClasses.tsx
 * 設定の「管理者」タブの「臨時授業」。LMS にない授業（臨時授業など）を、日付を指定して登録する（extra_classes）。
 * 対象（全コース共通か特定のコース）の学生の時間割・授業前の通知・カレンダー連携に「臨時」として出る。
 * 時限と時刻は「授業の変更」と同じく、時限のボタンと時限ごとの時刻で入れる（時刻は本来の時刻が入った状態から）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';
import { dbErrorText } from '../lib/dbError';
import { fetchCourseOptions } from '../lib/courses';
import { nowInJst, periodTime, toYmd } from '../lib/schedule';

type PeriodTimes = Record<string, { start?: string; end?: string }>;
type Row = { id: number; name: string; course_code: string | null; date: string; periods: number[]; period_times: PeriodTimes | null; classroom: string | null; note: string | null };
type Draft = { id?: number; name: string; courseCode: string; date: string; periods: number[]; times: Record<number, { start: string; end: string }>; classroom: string; note: string };

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const standard = (p: number) => {
  const t = periodTime(p);
  return t ? { start: `${pad(t.start.h)}:${pad(t.start.m)}`, end: `${pad(t.end.h)}:${pad(t.end.m)}` } : { start: '', end: '' };
};
const dateLabel = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}（${WD[new Date(y, m - 1, d).getDay()]}）`;
};
const inputClass = 'h-9 bg-surface border border-line-strong rounded-md px-2.5 text-sm text-fg';

export default function AdminExtraClasses({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [courseOptions, setCourseOptions] = useState<{ code: string; name: string }[]>([]);
  const targetName = (code: string | null) => (code ? courseOptions.find((o) => o.code === code)?.name ?? code : '');
  const today = toYmd(nowInJst());

  const load = useCallback(async () => {
    // 今日以降のもの（過ぎたものは出さない）
    const [{ data, error }, options] = await Promise.all([
      supabase.from('extra_classes')
        .select('id, name, course_code, date, periods, period_times, classroom, note')
        .gte('date', today)
        .order('date'),
      fetchCourseOptions(),
    ]);
    if (error) toast.error(`臨時授業を読めませんでした: ${dbErrorText(error)}`);
    setRows((data ?? []) as Row[]);
    setCourseOptions(options);
  }, [today]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => (draft ? [...draft.periods].sort((a, b) => a - b) : []), [draft]);
  const problem = useMemo(() => {
    if (!draft) return null;
    if (!draft.name.trim()) return '授業名を入れてください';
    if (!draft.date) return '日付を選んでください';
    if (selected.length === 0) return '時限を選んでください';
    const bad = selected.find((p) => { const t = draft.times[p]; return t?.start && t?.end && t.start >= t.end; });
    if (bad) return `${bad}限: 終了は開始より後にしてください`;
    return null;
  }, [draft, selected]);

  const togglePeriod = (p: number) => setDraft((d) => {
    if (!d) return d;
    const on = d.periods.includes(p);
    return { ...d, periods: on ? d.periods.filter((x) => x !== p) : [...d.periods, p], times: on ? d.times : { ...d.times, [p]: d.times[p] ?? standard(p) } };
  });
  const setTime = (p: number, key: 'start' | 'end', value: string) =>
    setDraft((d) => (d ? { ...d, times: { ...d.times, [p]: { ...(d.times[p] ?? standard(p)), [key]: value } } } : d));

  const startEdit = (r: Row) => setDraft({
    id: r.id,
    name: r.name,
    courseCode: r.course_code ?? '',
    date: r.date,
    periods: [...r.periods],
    times: Object.fromEntries(r.periods.map((p) => [p, { start: r.period_times?.[String(p)]?.start || standard(p).start, end: r.period_times?.[String(p)]?.end || standard(p).end }])),
    classroom: r.classroom ?? '',
    note: r.note ?? '',
  });

  const save = async () => {
    if (!draft || problem) return;
    setSaving(true);
    // 時刻は本来の時刻と違う時限の、違うところだけ保存する
    const times: PeriodTimes = {};
    for (const p of selected) {
      const t: { start?: string; end?: string } = {};
      if (draft.times[p]?.start && draft.times[p].start !== standard(p).start) t.start = draft.times[p].start;
      if (draft.times[p]?.end && draft.times[p].end !== standard(p).end) t.end = draft.times[p].end;
      if (t.start || t.end) times[String(p)] = t;
    }
    const row = {
      name: draft.name.trim(),
      course_code: draft.courseCode || null,
      date: draft.date,
      periods: selected,
      period_times: Object.keys(times).length ? times : null,
      classroom: draft.classroom.trim() || null,
      note: draft.note.trim() || null,
    };
    const { error } = draft.id != null
      ? await supabase.from('extra_classes').update(row).eq('id', draft.id)
      : await supabase.from('extra_classes').insert(row);
    setSaving(false);
    if (error) {
      toast.error(`保存できませんでした: ${dbErrorText(error)}`);
      return;
    }
    setDraft(null);
    await load();
    onChanged?.();
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`${dateLabel(r.date)} の「${r.name}」を削除しますか？`)) return;
    const { error } = await supabase.from('extra_classes').delete().eq('id', r.id);
    if (error) {
      toast.error(`削除できませんでした: ${dbErrorText(error)}`);
      return;
    }
    await load();
    onChanged?.();
  };

  if (rows === null) return <p className="text-sm text-fg-muted">読み込み中...</p>;

  return (
    <div className="space-y-3">
      {rows.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-lg">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2">
                  <span className="flex-shrink-0 inline-flex items-center h-5 px-2 rounded-full border text-xs font-bold bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/40"><span className="pill-text">臨時</span></span>
                  <span className="font-semibold text-fg truncate">{r.name}</span>
                </p>
                <p className="mt-1 text-fg-muted">
                  <span className="font-semibold text-fg tabular-nums">{dateLabel(r.date)}</span>
                  {[
                    `${[...r.periods].sort((a, b) => a - b).join('・')}限`,
                    Object.keys(r.period_times ?? {}).length > 0 && `時刻 ${Object.entries(r.period_times ?? {}).sort(([a], [b]) => Number(a) - Number(b)).map(([p, t]) => `${p}限 ${t.start ?? ''}〜${t.end ?? ''}`).join('・')}`,
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
          ))}
        </ul>
      )}

      {!draft ? (
        <button type="button" onClick={() => setDraft({ name: '', courseCode: '', date: today, periods: [], times: {}, classroom: '', note: '' })} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors">
          <FiPlus size={14} aria-hidden="true" />
          <span className="pill-text text-sm font-bold">臨時授業を登録</span>
        </button>
      ) : (
        <div className="rounded-lg bg-surface-2 px-4 py-3 space-y-3">
          {draft.id != null && <p className="text-sm font-bold text-fg">臨時授業を編集</p>}
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-48">
              <label htmlFor="px-name" className="block text-sm font-semibold text-fg mb-1">授業名</label>
              <input id="px-name" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例: 臨時ゼミ" className={`${inputClass} w-full`} />
            </div>
            <div>
              <label htmlFor="px-target" className="block text-sm font-semibold text-fg mb-1">対象</label>
              <select id="px-target" value={draft.courseCode} onChange={(e) => setDraft({ ...draft, courseCode: e.target.value })} className={inputClass}>
                <option value="">全コース共通</option>
                {courseOptions.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="px-date" className="block text-sm font-semibold text-fg mb-1">日付</label>
              <input id="px-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={`${inputClass} tabular-nums`} />
              {draft.date && <p className="mt-1 text-xs text-fg-muted">{dateLabel(draft.date)}</p>}
            </div>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-fg mb-1">時限</legend>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((p) => {
                const on = draft.periods.includes(p);
                return (
                  <button key={p} type="button" aria-pressed={on} onClick={() => togglePeriod(p)}
                    className={`w-10 h-9 rounded-md border text-sm font-bold transition-colors ${on ? 'bg-accent-soft border-accent text-accent' : 'bg-surface border-line text-fg-muted hover:text-fg'}`}>
                    {p}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {selected.length > 0 && (
            <fieldset>
              <legend className="text-sm font-semibold text-fg mb-1">時刻（本来の時刻と違うときだけ変える）</legend>
              <div className="space-y-1.5">
                {selected.map((p) => {
                  const t = draft.times[p] ?? standard(p);
                  return (
                    <div key={p} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="w-10 text-sm font-bold text-accent">{p}限</span>
                      <input type="time" aria-label={`${p}限の開始`} value={t.start} onChange={(e) => setTime(p, 'start', e.target.value)} className={`w-[6.75rem] ${inputClass} tabular-nums`} />
                      <span className="text-fg-muted">〜</span>
                      <input type="time" aria-label={`${p}限の終了`} value={t.end} onChange={(e) => setTime(p, 'end', e.target.value)} className={`w-[6.75rem] ${inputClass} tabular-nums`} />
                      <span className="basis-full sm:basis-auto pl-12 sm:pl-0 text-xs text-fg-subtle tabular-nums">本来 {standard(p).start}〜{standard(p).end}</span>
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="px-room" className="block text-sm font-semibold text-fg mb-1">教室（任意）</label>
              <input id="px-room" value={draft.classroom} maxLength={50} onChange={(e) => setDraft({ ...draft, classroom: e.target.value })} placeholder="例: 401" className={`${inputClass} w-32`} />
            </div>
            <div className="flex-1 min-w-48">
              <label htmlFor="px-note" className="block text-sm font-semibold text-fg mb-1">メモ（任意）</label>
              <input id="px-note" value={draft.note} maxLength={200} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="例: 特別講義" className={`${inputClass} w-full`} />
            </div>
          </div>
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
