/* src/components/AttendDialog.tsx
 * FMS の中で LMS の出欠に出席を入れる（Open LMS のアプリの「出席を送信」と同じ）。
 *   - AttendForm        : パスワード（と、あれば出欠の状態）を入れて送る。時間割の行の中にそのまま出す（ボタンを押さずに入れられる）
 *   - AttendDialog      : 通知から来たときなどの、下から出る画面（中身は AttendForm）
 * 送ったあと LMS を読み直して、記録できたかを確かめる。記録できた回は端末に覚えておき「出席済み」と出す。
 * 確かめられないときは出席ページへのリンクを出す（今までどおり LMS で入れられる）。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FiCheckCircle, FiExternalLink } from 'react-icons/fi';
import { BsQrCodeScan } from 'react-icons/bs';
import { getLmsSession } from '../lib/lms';
import { submitAttendance } from '../lib/attendanceMark';
import { debugSubmit, isDebugAttend } from '../lib/debugAttend';
import { useOpenAttendance, type AttendTarget } from '../hooks/useOpenAttendance';

/** FMS から出席を入れた日（出欠ページごと）。同じ日に開き直しても「出席済み」と出す */
const doneKey = (cmid: number) => `fms_attended_${cmid}`;
const todayStr = () => new Date().toLocaleDateString('sv-SE');
const readDone = (cmid: number) => { try { return localStorage.getItem(doneKey(cmid)) === todayStr(); } catch { return false; } };
const writeDone = (cmid: number) => { try { localStorage.setItem(doneKey(cmid), todayStr()); } catch { /* 覚えられなくても記録は LMS にある */ } };

const LmsLink = ({ url }: { url: string }) => (
  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
    出席ページを開く<FiExternalLink size={13} aria-hidden="true" />
  </a>
);

/**
 * 出席の入力。inline のときは時間割の行の中に 1 本の入力バーで出し、受け付けていないときは QR の読み取りだけ出す
 * （出席済みなら「出席済み」）。inline でないとき（AttendDialog）は、状態をすべて文で出す
 */
export function AttendForm({ target, inline = false, onScan, onDone }: { target: AttendTarget; inline?: boolean; onScan?: () => void; onDone?: () => void }) {
  const token = getLmsSession()?.token ?? null;
  const queryClient = useQueryClient();
  const open = useOpenAttendance(target, true);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(() => !isDebugAttend() && readDone(target.cmid));
  const [error, setError] = useState<'password' | 'unknown' | null>(null);
  // この画面で出席を送れた回（読み直しが終わるまでのあいだも、入力を出さない）
  const [sentSessid, setSentSessid] = useState<number | null>(null);

  const submit = async () => {
    const debug = isDebugAttend();
    if (!open.data || (!token && !debug)) return;
    setSending(true);
    setError(null);
    try {
      // 見た目を試しているときは LMS に送らない（覚えもしない）
      const r = debug
        ? await debugSubmit(password.trim())
        : await submitAttendance(token!, open.data.session, open.data.form, { password: password.trim(), status: status || undefined });
      if (r.ok) {
        if (!debug) writeDone(target.cmid);
        setSentSessid(open.data.session.sessid);
        setDone(true);
        queryClient.invalidateQueries({ queryKey: ['attendance'] });
        queryClient.invalidateQueries({ queryKey: ['attendOpen', target.cmid] });
        onDone?.();
      } else setError(r.reason);
    } catch {
      setError('unknown');
    } finally {
      setSending(false);
    }
  };

  // 受け付け中の回があれば入力を出す（同じ日に別の回が開いたときも入れられるように、「出席済み」より優先）
  const form = open.data?.form;
  if (form && open.data && open.data.session.sessid !== sentSessid) {
    const canSend = (!form.needsPassword || password.trim() !== '') && (form.statuses.length === 0 || status !== '');
    const onSubmit = (e: React.FormEvent) => { e.preventDefault(); if (canSend && !sending) submit(); };
    // 時間割の行の中: 1 本の入力バー。点滅する点・「出席パスワード」・色の付いた枠で「受付中」を表し、
    // 右端に QR（アイコン）と「出席」を置く
    if (inline) {
      return (
        <form onSubmit={onSubmit} className="mt-2">
          {form.statuses.length > 0 && (
            <fieldset className="mb-1.5 flex flex-wrap gap-1.5">
              <legend className="sr-only">出欠</legend>
              {form.statuses.map((st) => (
                <label key={st.id} className={`inline-flex items-center h-7 px-2.5 rounded-full border text-xs cursor-pointer ${status === st.id ? 'border-accent text-accent font-bold' : 'border-line-strong text-fg'}`}>
                  <input type="radio" name={`status-${target.cmid}`} value={st.id} checked={status === st.id} onChange={() => setStatus(st.id)} className="sr-only" />
                  {st.label}
                </label>
              ))}
            </fieldset>
          )}
          <div
            title={open.data.session.label ? `出席受付中 ${open.data.session.label}` : '出席受付中'}
            // パスワードは半角 10 文字ほどなので、横幅いっぱいにはせず 10 文字が入る幅にとどめる
            className={`flex items-center w-full max-w-[15.5rem] h-10 pl-3 pr-1 rounded-lg border-[1.5px] bg-surface transition-colors focus-within:ring-2 focus-within:ring-accent/30 ${error === 'password' ? 'border-down' : 'border-accent'}`}
          >
            <span className="relative flex w-2 h-2 flex-shrink-0" aria-hidden="true">
              <span className="absolute inline-flex w-full h-full rounded-full bg-accent opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-accent" />
            </span>
            {form.needsPassword ? (
              <input
                type="text"
                aria-label="出席パスワード（出席受付中）"
                placeholder="パスワード"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                // 文字は 16px（iPhone で入力時に画面が拡大されないように）
                className="flex-1 min-w-0 h-full pl-2 border-0 bg-transparent text-fg text-base placeholder:text-fg-subtle !outline-none !ring-0 !shadow-none"
              />
            ) : (
              <span className="flex-1 pl-2 text-sm font-semibold text-accent">出席受付中</span>
            )}
            {onScan && (
              <button type="button" onClick={onScan} aria-label="QR を読み取る" className="w-8 h-8 flex-shrink-0 rounded-md flex items-center justify-center text-fg-muted hover:bg-surface-3 transition-colors">
                <BsQrCodeScan size={16} aria-hidden="true" />
              </button>
            )}
            <button
              type="submit"
              disabled={!canSend || sending}
              className="ml-1 inline-flex flex-shrink-0 items-center gap-1 h-8 px-3 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent text-[13px] font-bold transition-colors disabled:opacity-40"
            >
              <FiCheckCircle size={13} aria-hidden="true" />
              {sending ? '送信中' : '出席'}
            </button>
          </div>
          {error === 'password' && <p className="mt-1 text-xs font-semibold text-down">パスワードが違います</p>}
          {error === 'unknown' && <p className="mt-1 text-xs font-semibold text-down">記録できたか確かめられませんでした。 <LmsLink url={target.url} /></p>}
        </form>
      );
    }
    return (
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3"
      >
        <p className="flex items-center gap-1.5 text-sm font-bold text-accent">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" aria-hidden="true" />
          出席受付中
          {open.data.session.label && <span className="font-normal text-fg-muted tabular-nums">{open.data.session.label.replace(/^\d{4}\/\d{1,2}\/\d{1,2}\s*\([^)]*\)\s*/, '')}</span>}
        </p>
        {form.statuses.length > 0 && (
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">出欠</legend>
            {form.statuses.map((st) => (
              <label key={st.id} className={`inline-flex items-center h-8 px-3 rounded-full border text-sm cursor-pointer ${status === st.id ? 'border-accent bg-surface text-accent font-bold' : 'border-line-strong bg-surface text-fg'}`}>
                <input type="radio" name={`status-${target.cmid}`} value={st.id} checked={status === st.id} onChange={() => setStatus(st.id)} className="sr-only" />
                {st.label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex gap-2">
          {form.needsPassword && (
            <input
              type="text"
              aria-label="出席のパスワード"
              placeholder="パスワード"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              autoFocus
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              className={`flex-1 min-w-0 px-3 rounded-lg border bg-surface text-fg text-base focus:outline-none focus:ring-2 focus:ring-accent ${error === 'password' ? 'border-down' : 'border-line-strong'} h-11`}
            />
          )}
          <button
            type="submit"
            disabled={!canSend || sending}
            className={`flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-4 rounded-lg bg-accent-solid hover:bg-accent-solid-hover text-on-accent font-bold transition-colors disabled:opacity-50 h-11 text-[15px] ${form.needsPassword ? '' : 'flex-1'}`}
          >
            <FiCheckCircle size={15} aria-hidden="true" />
            {sending ? '送信中...' : '出席'}
          </button>
        </div>
        {error === 'password' && <p className="mt-1.5 text-[13px] font-semibold text-down">パスワードが違います。</p>}
        {error === 'unknown' && (
          <p className="mt-1.5 text-[13px] font-semibold text-down">記録できたか確かめられませんでした。 <LmsLink url={target.url} /></p>
        )}
      </form>
    );
  }

  if (done) {
    return (
      <p className={`flex items-center gap-1 font-bold text-up ${inline ? 'mt-1.5 text-xs' : 'justify-center gap-1.5 py-4 text-base'}`}>
        <FiCheckCircle size={inline ? 13 : 20} aria-hidden="true" />出席済み
      </p>
    );
  }
  // 受け付けていないとき（時間割の行の中）: QR の読み取りだけ出す
  if (inline) {
    return onScan ? (
      <button type="button" onClick={onScan} className="mt-2 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors">
        <BsQrCodeScan size={14} aria-hidden="true" />
        <span className="pill-text text-[13px] font-bold">QR を読み取る</span>
      </button>
    ) : null;
  }

  // ダイアログ: 受け付けていない・読めないときの説明
  if (!token) return <p className="text-sm text-fg-muted">LMS に接続していないため、FMS からは出席を入れられません。 <LmsLink url={target.url} /></p>;
  if (open.isLoading) return <p className="py-6 text-center text-sm text-fg-muted">出欠を確かめています...</p>;
  if (open.isError) return <p className="text-sm text-fg-muted">出欠を読み込めませんでした（LMS のログインが切れている可能性があります）。 <LmsLink url={target.url} /></p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-fg-muted">今は出席を受け付けていません。受け付けが始まると、ここにパスワードの欄が出ます（1 分ごとに確かめます）。</p>
      <LmsLink url={target.url} />
    </div>
  );
}

/** 下から出る出席の画面（通知から来たときなど） */
export default function AttendDialog({ target, onScan, onClose }: { target: AttendTarget; onScan?: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attend-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-surface rounded-t-2xl sm:rounded-2xl shadow-xl px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5"
      >
        {target.subtitle && <p className="text-sm font-semibold text-accent">{target.subtitle}</p>}
        <h2 id="attend-dialog-title" className="mt-1 mb-4 text-lg font-extrabold text-fg leading-snug">{target.name}</h2>
        <AttendForm target={target} />
        <div className="mt-4 flex flex-col gap-1">
          {onScan && (
            <button type="button" onClick={() => { onClose(); onScan(); }} className="inline-flex items-center justify-center gap-2 h-10 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors">
              <BsQrCodeScan size={15} aria-hidden="true" />
              <span className="text-sm font-bold">QR を読み取る</span>
            </button>
          )}
          <button type="button" onClick={onClose} className="h-10 rounded-full text-fg-muted hover:bg-surface-3 transition-colors">
            <span className="text-sm font-semibold">閉じる</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
