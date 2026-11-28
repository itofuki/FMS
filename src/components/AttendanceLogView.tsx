/* src/components/AttendanceLogView.tsx
 * 設定（開発者）: FMS から出席を送ったときの記録（この端末の直近 20 件）。不具合の調査用。
 * 結果・LMS のエラー・返事の文言の名前・送る前と後の「記録された回の数」とボタンの有無を出し、まとめてコピーできる。
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { clearAttendLog, readAttendLog, type AttendLogEntry, type ViewState } from '../lib/attendanceLog';

const RESULT_LABEL: Record<AttendLogEntry['result'], string> = {
  ok: '出席済み', password: 'パスワード違い', unknown: '確かめられなかった', error: 'エラー',
};
const RESULT_CLASS: Record<AttendLogEntry['result'], string> = {
  ok: 'text-up', password: 'text-warn', unknown: 'text-down', error: 'text-down',
};

const stateText = (v: ViewState) => (v ? `記録 ${v.completed ?? '?'} 回・ボタン${v.open ? 'あり' : 'なし'}` : '読めなかった');
const timeText = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function AttendanceLogView() {
  const [log, setLog] = useState(readAttendLog);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      toast.success('コピーしました');
    } catch {
      toast.error('コピーできませんでした');
    }
  };
  const clear = () => {
    if (!window.confirm('出席の送信の記録を消しますか？（LMS の出欠には影響しません）')) return;
    clearAttendLog();
    setLog([]);
  };

  if (log.length === 0) return <p className="text-sm text-fg-muted">まだ記録はありません。FMS から出席を送ると、ここに残ります。</p>;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line rounded-md border border-line">
        {log.map((e, i) => (
          <li key={i} className="px-3 py-2 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="tabular-nums text-fg-muted">{timeText(e.at)}</span>
              <span className="text-xs px-1.5 rounded bg-surface-3 text-fg-muted">{e.kind === 'assignment' ? '課題の提出' : '出席'}</span>
              <span className="font-semibold text-fg">{e.course}</span>
              <span className={`font-bold ${RESULT_CLASS[e.result]}`}>{RESULT_LABEL[e.result]}</span>
            </p>
            <div className="mt-0.5 text-xs text-fg-muted space-y-0.5 break-all">
              <p>{e.kind === 'assignment' ? `課題ページ ${e.cmid}` : `出欠ページ ${e.cmid}・回 ${e.sessid ?? '-'}`}</p>
              {e.error && <p className="text-down">LMS のエラー: {e.error}</p>}
              {e.assignDiag && (
                <>
                  <p>手順: {e.assignDiag.steps.join(' → ') || 'なし'}</p>
                  {e.assignDiag.warnings.length > 0 && <p className="text-warn">LMS の警告: {e.assignDiag.warnings.join(' / ')}</p>}
                  <p>提出するファイル: {e.assignDiag.expected.join(', ') || 'なし'}</p>
                  <p>送ったあと: {e.assignDiag.after ? `${e.assignDiag.after.status}・${e.assignDiag.after.files.join(', ') || 'ファイルなし'}` : '読めなかった'}</p>
                </>
              )}
              {e.diag && (
                <>
                  <p>返事の文言: {e.diag.keys.length ? e.diag.keys.join(', ') : 'なし'}</p>
                  <p>送る前: {stateText(e.diag.before)} → 送ったあと: {stateText(e.diag.after)}</p>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={copy} className="h-9 px-4 rounded-md border border-line-strong text-sm font-bold text-fg hover:bg-surface-3">まとめてコピー</button>
        <button type="button" onClick={clear} className="h-9 px-4 rounded-md text-sm font-bold text-down hover:bg-down-soft">記録を消す</button>
      </div>
    </div>
  );
}
