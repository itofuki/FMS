/* src/components/AttendPrompt.tsx
 * 授業前の通知を押して FMS が開いたとき、通知の授業が今日の時間割に見つからない場合だけ出す「出席のしかた」の選択
 * （見つかれば、時間割のその授業の行へ移る）。
 * iPhone の Web アプリの通知にはボタンを付けられないため、通知を押したらここで
 * 「出席ページを開く」か「QR を読み取る」を選んでもらう（Android・PC で本文を押したときも同じ）。
 * 出席ページの URL は通知から受け取るが、LMS のページ以外は開かない（ほかのサイトへ飛ばされないように）。
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiCheckCircle, FiExternalLink } from 'react-icons/fi';
import { BsQrCodeScan } from 'react-icons/bs';
import type { AttendPromptInfo } from '../lib/attendPrompt';

export default function AttendPrompt({ info, onScan, onClose }: { info: AttendPromptInfo; onScan: () => void; onClose: () => void }) {
  // Esc で閉じる
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
        aria-labelledby="attend-prompt-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-surface rounded-t-2xl sm:rounded-2xl shadow-xl px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5"
      >
        <p className="text-sm font-semibold text-accent">{info.period ? `${info.period}限` : '授業'}{info.start && ` · ${info.start} 開始`}{info.room && ` · ${info.room}`}</p>
        <h2 id="attend-prompt-title" className="mt-1 text-lg font-extrabold text-fg leading-snug">{info.name || '出席'}</h2>
        <p className="mt-1 text-[13px] text-fg-muted">出席のしかたを選んでください</p>

        <div className="mt-4 flex flex-col gap-2">
          {info.link && (
            <a
              href={info.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="inline-flex items-center justify-center gap-2 h-12 rounded-full bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors"
            >
              <FiCheckCircle size={17} aria-hidden="true" />
              <span className="text-[15px] font-bold">出席ページを開く</span>
              <FiExternalLink size={14} className="opacity-70" aria-hidden="true" />
            </a>
          )}
          <button
            type="button"
            onClick={() => { onClose(); onScan(); }}
            className="inline-flex items-center justify-center gap-2 h-12 rounded-full border border-line-strong text-fg hover:bg-surface-3 transition-colors"
          >
            <BsQrCodeScan size={17} aria-hidden="true" />
            <span className="text-[15px] font-bold">QR を読み取る</span>
          </button>
          <button type="button" onClick={onClose} className="h-10 rounded-full text-fg-muted hover:bg-surface-3 transition-colors">
            <span className="text-sm font-semibold">閉じる</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
