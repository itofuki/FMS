/* src/components/CalendarFeedSettings.tsx
 * 設定の「カレンダー連携」の中身。時間割と課題の締切を、iPhone / Google カレンダーなどで購読するための URL を扱う。
 * URL はユーザーごとの推測できないトークン付き（supabase の calendar_feeds）。知っている人は誰でも読めるため、
 * 作り直し（古い URL を無効にする）と停止をできるようにしている。
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiCopy, FiCalendar, FiExternalLink } from 'react-icons/fi';
import { supabase } from '../lib/supabaseClient';

const FEED_BASE = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/calendar-feed`;

export default function CalendarFeedSettings({ userId }: { userId: string }) {
  // undefined: 確認中、null: まだ作っていない
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from('calendar_feeds')
      .select('token')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => setToken(error ? null : data?.token ?? null));
  }, [userId]);

  const issue = async (rotate: boolean) => {
    if (rotate && !window.confirm('URL を作り直すと、今の URL で購読しているカレンダーは更新されなくなります。作り直しますか？')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('ensure_calendar_feed', { p_rotate: rotate });
    setBusy(false);
    if (error || typeof data !== 'string') {
      toast.error(`URL を作れませんでした: ${error?.message ?? '不明なエラー'}`);
      return;
    }
    setToken(data);
    toast.success(rotate ? '新しい URL を作りました。カレンダーに追加し直してください。' : '購読用の URL を作りました。');
  };

  const stop = async () => {
    if (!window.confirm('購読をやめると、この URL で追加したカレンダーは更新されなくなります。やめますか？')) return;
    setBusy(true);
    const { error } = await supabase.rpc('delete_calendar_feed');
    setBusy(false);
    if (error) {
      toast.error(`停止できませんでした: ${error.message}`);
      return;
    }
    setToken(null);
    toast.success('購読用の URL を無効にしました。カレンダーアプリからも削除してください。');
  };

  if (token === undefined) return <p className="text-sm text-fg-muted">確認中...</p>;

  if (token === null) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => issue(false)}
          disabled={busy}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors disabled:opacity-50"
        >
          <FiCalendar size={16} aria-hidden="true" />
          <span className="text-sm font-bold">{busy ? '作成中...' : '購読用の URL を作る'}</span>
        </button>
      </div>
    );
  }

  const httpsUrl = `${FEED_BASE}?token=${token}`;
  const webcalUrl = httpsUrl.replace(/^https?:\/\//, 'webcal://');
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      toast.success('URL をコピーしました');
    } catch {
      toast.error('コピーできませんでした。URL を長押しして選択してください。');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <a href={webcalUrl} className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors">
          <FiCalendar size={16} aria-hidden="true" />
          <span className="text-sm font-bold">iPhone / Mac のカレンダーに追加</span>
        </a>
        <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-line-strong text-fg hover:bg-surface-2 transition-colors">
          <span className="text-sm font-bold">Google カレンダーに追加</span>
          <FiExternalLink size={13} aria-hidden="true" />
        </a>
      </div>

      <div>
        <label htmlFor="calendar-feed-url" className="block text-sm font-semibold text-fg mb-1.5">購読用の URL（ほかのカレンダーアプリ用）</label>
        <div className="flex gap-2">
          <input
            id="calendar-feed-url"
            readOnly
            value={httpsUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 h-10 bg-surface-2 border border-line rounded-md px-3 text-fg-muted text-xs font-mono"
          />
          <button type="button" onClick={copy} aria-label="URL をコピー" className="flex-shrink-0 h-10 px-3 rounded-md border border-line-strong text-fg hover:bg-surface-2 transition-colors">
            <FiCopy size={16} />
          </button>
        </div>
      </div>

      <ul className="text-sm text-fg-muted leading-relaxed list-disc pl-5 space-y-1">
        <li><span className="font-semibold text-warn">この URL を知っている人は、あなたの時間割と締切を見られます。</span>人に教えないでください。</li>
        <li>締切は FMS を開いたときに更新されます。カレンダーへの反映は、カレンダーアプリの更新間隔（数時間〜1日）しだいです。</li>
        <li>休講や祝日は反映されません。</li>
      </ul>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <button type="button" onClick={() => issue(true)} disabled={busy} className="font-semibold text-link hover:underline disabled:opacity-50">URL を作り直す</button>
        <button type="button" onClick={stop} disabled={busy} className="font-semibold text-down hover:underline disabled:opacity-50">購読をやめる</button>
      </div>
    </div>
  );
}
