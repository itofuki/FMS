/* src/components/SubmitPanel.tsx
 * 課題の「提出」の欄。課題の一覧で提出のボタンを押すと、その課題のカードの下に伸びる（アコーディオン）。
 * LMS の課題にファイルで提出する。よくある課題アプリの形（Google Classroom など）:
 * 状態と残り時間 → ファイルの行 →「ファイルを追加」→ 横いっぱいの「提出する」→ キャンセル → 詳細（たたむ）
 *   - 提出済みのファイル（残す・外すを選べる）と、新しく足すファイル（写真・カメラ・ファイル）を並べる
 *   - 「提出する」で、すぐ送る。送ったあと LMS を読み直し、状態とファイル名がそろったら成功
 *       成功   : 親に知らせる（親が通知を出し、欄を閉じ、課題を完了に移す）
 *       失敗   : 欄は開いたまま、理由を出す。選んだファイルは残すので、そのまま出し直せる
 *       不明   : 欄は開いたまま。「もう一度確かめる」で LMS を読むだけ（二重に送らない）
 *   - 送るたびに、調査用の記録を残す（設定の開発者タブ）
 * テキストで提出する課題・FMS で扱えない設定の課題は、LMS で開くリンクを出す。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FiAlertTriangle, FiCheckCircle, FiChevronRight, FiChevronUp, FiExternalLink, FiFile, FiPlus, FiRefreshCw, FiRotateCcw, FiX } from 'react-icons/fi';
import { getLmsSession } from '../lib/lms';
import { fetchGroupName, fetchSubmission, findAssign, judgeSubmission, submitFiles, type SubmittedFile } from '../lib/assignSubmit';
import { addAttendLog } from '../lib/attendanceLog';

// 提出の状態のバッジ
const STATUS_BADGE: Record<string, { label: string; className: string; dot: string }> = {
  new: { label: '未提出', className: 'bg-surface-3 text-fg-muted', dot: 'bg-fg-subtle' },
  draft: { label: '下書き', className: 'bg-warn-soft text-warn', dot: 'bg-warn' },
  submitted: { label: '提出済み', className: 'bg-up-soft text-up', dot: 'bg-up' },
  reopened: { label: '再提出が必要', className: 'bg-down-soft text-down', dot: 'bg-down' },
};
const GRADING_LABEL: Record<string, string> = { notgraded: '未評定', graded: '評定済み' };
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
/** 「2026年 11月 26日(木曜日) 00:00」（LMS と同じ形） */
const lmsDate = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}年 ${d.getMonth() + 1}月 ${d.getDate()}日(${WEEKDAY[d.getDay()]}曜日) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
/** 「残り 6 日 8 時間」 */
const remainingText = (due: number, submitted: boolean) => {
  if (!due) return '-';
  const diff = due * 1000 - Date.now();
  if (diff <= 0) return submitted ? '期限後' : '期限切れ';
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  return `残り ${days ? `${days} 日 ` : ''}${days || hours ? `${hours} 時間` : `${mins} 分`}`;
};

const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

export default function SubmitPanel({ cmid, title, url, onSubmitted, onCancel }: {
  cmid: number; title: string; url: string; onSubmitted?: () => void; onCancel?: () => void;
}) {
  const token = getLmsSession()?.token ?? null;
  const fileInput = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState<File[]>([]);
  // 外す提出済みのファイル（名前）
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [agree, setAgree] = useState(false);
  // ファイルを枠の上に重ねて（ドラッグして）いる間
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // 送った結果。unknown は、送ったが LMS で提出済みになったか確かめられなかったとき（expected は送ったファイル名）
  const [result, setResult] = useState<
    | { kind: 'ok'; message: string }
    | { kind: 'error'; message: string }
    | { kind: 'unknown'; expected: string[] }
    | null
  >(null);
  const [rechecking, setRechecking] = useState(false);

  const info = useQuery({
    queryKey: ['assignSubmit', cmid],
    enabled: !!token,
    retry: false,
    queryFn: async () => {
      const assign = await findAssign(token!, cmid);
      if (!assign) return null;
      return { assign, state: await fetchSubmission(token!, assign.id) };
    },
  });
  const assign = info.data?.assign;
  const state = info.data?.state;
  // グループで提出する課題なら、自分のグループの名前
  const group = useQuery({
    queryKey: ['assignGroup', assign?.courseId, state?.groupId],
    enabled: !!token && !!assign?.teamSubmission && !!state?.groupId,
    queryFn: () => fetchGroupName(token!, assign!.courseId, state!.groupId!),
  });

  // 新しいファイルと同じ名前の提出済みのファイルは、新しいほうに置き換える（同じ名前のファイルは 2 つ置けないため）
  const keep: SubmittedFile[] = useMemo(
    () => (state?.files ?? []).filter((f) => !removed.has(f.filename) && !added.some((a) => a.name === f.filename)),
    [state, removed, added],
  );
  const total = keep.length + added.length;
  const tooBig = assign?.maxBytes ? added.find((f) => f.size > assign.maxBytes) : undefined;
  const tooMany = !!assign?.maxFiles && total > assign.maxFiles;
  const changed = added.length > 0 || keep.length !== (state?.files.length ?? 0);
  const problem = tooBig ? `「${tooBig.name}」が大きすぎます（上限 ${sizeText(assign!.maxBytes)}）`
    : tooMany ? `ファイルは ${assign!.maxFiles} 個までです`
    : !changed ? null
    : total === 0 ? '提出するファイルがありません'
    : assign?.requiresStatement && !agree ? '提出宣言に同意してください'
    : null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...added];
    for (const f of Array.from(list)) {
      const i = next.findIndex((x) => x.name === f.name);
      if (i >= 0) next[i] = f; else next.push(f);
    }
    setAdded(next);
    setResult(null);
  };

  const send = async () => {
    if (!assign || !token) return;
    setResult(null);
    setProgress({ done: 0, total });
    const r = await submitFiles(token, assign, keep, added, { finalize: true, onProgress: (done, t) => setProgress({ done, total: t }) });
    setProgress(null);
    addAttendLog({
      at: new Date().toISOString(), kind: 'assignment', course: title, cmid, sessid: null,
      result: r.ok ? 'ok' : r.error ? 'error' : 'unknown', error: r.error, diag: null, assignDiag: r.diag,
    });
    if (r.ok) succeed(r.diag.expected.length);
    else if (r.error) setResult({ kind: 'error', message: `提出できませんでした: ${r.error}` });
    else setResult({ kind: 'unknown', expected: r.diag.expected });
    // 確かめられなかったときは、ここでは読み直さない（選んだファイルと見比べられなくなるため。「もう一度確かめる」で読む）
    if (r.ok || r.error) info.refetch();
  };

  const succeed = (files: number) => {
    setResult({ kind: 'ok', message: `提出しました（${files} ファイル）。LMS で提出済みになったことを確かめました。` });
    setAdded([]);
    setRemoved(new Set());
    onSubmitted?.();
  };

  // 確かめられなかったときに、LMS を読み直すだけ（送り直さない）
  const recheck = async () => {
    if (!assign || !token || result?.kind !== 'unknown') return;
    setRechecking(true);
    try {
      const after = await fetchSubmission(token, assign.id);
      if (judgeSubmission(after, result.expected, assign.drafts, true)) {
        succeed(result.expected.length);
        info.refetch();
      } else {
        setResult({ kind: 'error', message: 'LMS ではまだ提出済みになっていません。もう一度「この状態で提出する」を押してください。' });
        info.refetch();
      }
    } catch (e) {
      setResult({ kind: 'error', message: `LMS を読めませんでした: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setRechecking(false);
    }
  };
  const sending = !!progress;

  // 閉じる（キャンセルと同じ。選んだファイルは捨てる）
  const close = () => { setAdded([]); setRemoved(new Set()); setResult(null); onCancel?.(); };

  // 開いたとき・中身を読み込んだとき、欄全体が画面に入るようにスクロールする
  // （開く動き 0.22 秒が終わってから。上の見出し・下のメニューに隠れないよう scroll-margin を付けてある）
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 260);
    return () => window.clearTimeout(t);
  }, [info.status]);

  const lmsLink = (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
      LMS で開く<FiExternalLink size={13} aria-hidden="true" />
    </a>
  );

  // 閉じるボタン（欄の右上。状態の行に置く）
  const closeButton = (
    <button type="button" onClick={close} disabled={sending} aria-label="提出の欄を閉じる" title="閉じる"
      className="flex-shrink-0 -my-1 -mr-1.5 p-1.5 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 disabled:opacity-40">
      <FiChevronUp size={18} />
    </button>
  );
  // 状態の行がある（課題を読めた）ときは、閉じるボタンはその行の右端に置く
  let inHeader = false;
  let body: React.ReactNode;
  if (!token) body = <p className="text-sm text-fg-muted">LMS に接続していないため、FMS からは提出できません。 {lmsLink}</p>;
  else if (info.isLoading) body = <p className="py-6 text-center text-sm text-fg-muted">課題を読み込んでいます...</p>;
  else if (info.isError || !assign || !state) body = <p className="text-sm text-fg-muted">課題を読み込めませんでした。 {lmsLink}</p>;
  else if (!assign.fileEnabled) body = <p className="text-sm text-fg-muted">この課題はファイルでの提出ではないため、FMS からは提出できません。 {lmsLink}</p>;
  else {
    inHeader = true;
    const submitted = state.status === 'submitted';
    const overdue = !!assign.duedate && assign.duedate * 1000 < Date.now();
    const badge = STATUS_BADGE[state.status] ?? STATUS_BADGE.new;
    // 詳細（たたんでおく。LMS の「提出ステータス」の表の残り）
    const details: [string, React.ReactNode][] = [
      ['コース', assign.courseName || '-'],
      ...(assign.teamSubmission && group.data ? [['グループ', group.data] as [string, React.ReactNode]] : []),
      ...(assign.allowFrom > 0 ? [['開始', lmsDate(assign.allowFrom)] as [string, React.ReactNode]] : []),
      ['期限', assign.duedate ? lmsDate(assign.duedate) : 'なし'],
      ['評定', GRADING_LABEL[state.gradingStatus ?? ''] ?? state.gradingStatus ?? '-'],
      ['最終更新', state.timemodified ? lmsDate(state.timemodified) : '-'],
    ];
    const limits = [
      assign.maxFiles ? `${assign.maxFiles} 個まで` : '',
      assign.maxBytes ? `1 ファイル ${sizeText(assign.maxBytes)} まで` : '',
      assign.fileTypes ? `種類 ${assign.fileTypes}` : '',
    ].filter(Boolean).join('・');
    const canDrop = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
    const rowBtn = 'flex-shrink-0 p-1.5 -m-1 rounded-md text-fg-muted hover:bg-surface-3 hover:text-fg';
    body = (
      <div className="space-y-3">
        {/* 1 行目: 提出の状態と残り時間 */}
        <div className="flex items-center gap-2 text-sm">
          <span className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-xs font-bold ${badge.className}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} aria-hidden="true" />
            {badge.label}
          </span>
          <span className={`ml-auto tabular-nums ${overdue && !submitted ? 'text-down font-semibold' : 'text-fg-muted'}`}>
            {remainingText(assign.duedate, submitted)}
          </span>
          {closeButton}
        </div>

        {!state.canEdit ? (
          <>
            {state.files.length > 0 && (
              <ul className="rounded-lg border border-line bg-surface divide-y divide-line">
                {state.files.map((f) => (
                  <li key={f.filename} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                    <FiFile size={15} className="flex-shrink-0 text-fg-subtle" aria-hidden="true" />
                    <span className="flex-1 min-w-0 truncate text-fg">{f.filename}</span>
                    <span className="text-xs text-fg-subtle tabular-nums">{sizeText(f.filesize)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-warn font-semibold">今は提出・変更できません（受付前、締切後、または評定済み）。 {lmsLink}</p>
          </>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); if (!sending) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); if (!sending) addFiles(e.dataTransfer.files); }}
            aria-disabled={sending}
            className={`space-y-2 rounded-lg transition-colors ${dragging ? 'ring-2 ring-accent bg-accent-soft/40' : ''} ${sending ? 'opacity-60 pointer-events-none' : ''}`}
          >
            {/* ファイルの行（提出済み・新しく足すもの） */}
            {(state.files.length > 0 || added.length > 0) && (
              <ul className="rounded-lg border border-line bg-surface divide-y divide-line">
                {state.files.map((f) => {
                  const off = removed.has(f.filename);
                  const replaced = added.some((x) => x.name === f.filename);
                  return (
                    <li key={f.filename} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                      <FiFile size={15} className="flex-shrink-0 text-fg-subtle" aria-hidden="true" />
                      <span className={`flex-1 min-w-0 truncate ${off || replaced ? 'line-through text-fg-subtle' : 'text-fg'}`}>{f.filename}</span>
                      <span className="text-xs text-fg-subtle whitespace-nowrap">{replaced ? '置き換え' : off ? '外す' : '提出済み'}</span>
                      {!replaced && (
                        <button type="button" onClick={() => setRemoved((r) => { const n = new Set(r); if (off) n.delete(f.filename); else n.add(f.filename); return n; })}
                          aria-label={off ? `${f.filename} を残す` : `${f.filename} を外す`} className={rowBtn}>
                          {off ? <FiRotateCcw size={15} /> : <FiX size={15} />}
                        </button>
                      )}
                    </li>
                  );
                })}
                {added.map((f) => (
                  <li key={f.name} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                    <FiFile size={15} className="flex-shrink-0 text-accent" aria-hidden="true" />
                    <span className="flex-1 min-w-0 truncate text-fg font-medium">{f.name}</span>
                    <span className="text-xs text-fg-subtle tabular-nums whitespace-nowrap">{sizeText(f.size)}</span>
                    <button type="button" onClick={() => setAdded((x) => x.filter((y) => y !== f))} aria-label={`${f.name} をやめる`} className={rowBtn}><FiX size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
            {/* ファイルを追加（PC ではここへドラッグしても入れられる） */}
            <button type="button" onClick={() => fileInput.current?.click()}
              className="w-full flex items-center justify-center gap-1.5 h-11 rounded-lg border border-dashed border-line-strong text-fg-muted hover:text-accent hover:border-accent hover:bg-accent-soft/40 transition-colors">
              <FiPlus size={16} aria-hidden="true" />
              <span className="text-sm font-semibold">ファイルを追加</span>
              {canDrop && <span className="text-xs text-fg-subtle">（ドラッグでも可）</span>}
            </button>
            <input ref={fileInput} type="file" multiple accept={assign.fileTypes ? assign.fileTypes.split(/[,;\s]+/).filter(Boolean).join(',') : undefined}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} className="hidden" />
            {limits && <p className="text-xs text-fg-subtle">{limits}。同じ名前のファイルは置き換えます。</p>}
          </div>
        )}

        {state.canEdit && assign.requiresStatement && (
          <label className="flex items-start gap-2 text-sm text-fg">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
            提出宣言に同意します（自分で作成したものであること）。
          </label>
        )}
        {state.canEdit && problem && changed && <p className="text-sm font-semibold text-down">{problem}</p>}
        {state.canEdit && state.files.length > keep.length && !problem && <p className="text-xs font-semibold text-warn">提出済みのファイルのうち {state.files.length - keep.length} 個は外れます（置き換えを含む）。</p>}

        {result?.kind === 'ok' && (
          <p role="status" className="flex items-start gap-1.5 text-sm font-semibold text-up">
            <FiCheckCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{result.message}</span>
          </p>
        )}
        {result?.kind === 'error' && (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-semibold text-down">
            <FiAlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{result.message} {lmsLink}</span>
          </p>
        )}
        {result?.kind === 'unknown' && (
          <div role="alert" className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm space-y-2">
            <p className="flex items-start gap-1.5 font-semibold text-warn">
              <FiAlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>提出できたか確かめられませんでした。LMS では提出済みになっている可能性があります。</span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={recheck} disabled={rechecking}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line-strong bg-surface font-bold text-fg hover:bg-surface-3 disabled:opacity-60">
                <FiRefreshCw size={14} className={rechecking ? 'animate-spin' : ''} aria-hidden="true" />
                <span className="text-sm">{rechecking ? '確かめています...' : 'もう一度確かめる'}</span>
              </button>
              {lmsLink}
            </div>
          </div>
        )}

        {/* 提出（横いっぱい）とキャンセル */}
        {state.canEdit && (
          <div className="space-y-1 pt-1">
            <button type="button" disabled={!changed || !!problem || sending || rechecking || result?.kind === 'ok'} onClick={send}
              className={`w-full h-11 rounded-lg bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-bold transition-colors tabular-nums ${sending ? 'cursor-wait' : 'disabled:opacity-40 disabled:cursor-not-allowed'}`}>
              {/* 文字の大きさは中の span で決める（button への指定は全体の書式に負けるため） */}
              <span className="text-[15px]">
                {sending ? `送信中 ${progress!.done}/${progress!.total}`
                  : `${submitted ? '再提出する' : '提出する'}${changed && total > 0 ? `（${total} ファイル）` : ''}`}
              </span>
            </button>
            <button type="button" disabled={sending} onClick={close}
              className="w-full h-9 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-3 font-semibold disabled:opacity-40">
              <span className="text-sm">キャンセル</span>
            </button>
          </div>
        )}

        {/* 詳細（コース・期限・評定・最終更新） */}
        <details className="group border-t border-line pt-2">
          <summary className="flex items-center gap-1 cursor-pointer list-none text-sm font-semibold text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <FiChevronRight size={15} className="transition-transform group-open:rotate-90" aria-hidden="true" />
            詳細
          </summary>
          <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            {details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-muted">{k}</dt>
                <dd className="text-fg break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2">{lmsLink}</p>
        </details>
      </div>
    );
  }

  return (
    // 枠で囲まず、課題の行の下に区切り線を引いて続ける（カードがそのまま下に伸びたように見せる）
    <div ref={rootRef} className="mt-3 pt-3 border-t border-line scroll-mt-36 scroll-mb-28">
      {inHeader ? body : (
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">{body}</div>
          {closeButton}
        </div>
      )}
    </div>
  );
}
