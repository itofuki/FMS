import { Download } from 'lucide-react';

export default function Tips() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold text-fg">💡 Tips</h1>
      
      {/* ガイドのダウンロードカード */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
        
        {/* --- 1. ヘッダー：タイトルとバッジ --- */}
        <div className="border-b border-line bg-surface-2 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded bg-accent-solid px-2 py-0.5 text-xs font-bold tracking-wider text-on-accent">
              NEW
            </span>
            <h2 className="text-xl font-bold text-fg">LMS爆速ログイン完全ガイド</h2>
          </div>
        </div>

        {/* --- 2. ボディ：詳細説明 --- */}
        <div className="px-5 py-6 sm:px-6">
          <p className="leading-relaxed text-fg-muted">
            毎回の「LMSの2段階認証」でメールやモバイルアプリ確認の手間をゼロに。PCとスマホ両方で、ワンタイムパスワードを「コピペ」や「自動入力」だけで突破する設定手順（約5分）をまとめました。
          </p>
        </div>

        {/* --- 3. フッター：アクションエリア --- */}
        <div className="border-t border-line bg-surface-2/50 px-5 py-4 sm:px-6">
          <div className="flex justify-end">
            <a
              href="/lms_fast_login_guide.pdf" 
              download="LMS爆速ログイン完全ガイド.pdf"
              className="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-accent-solid px-6 py-2.5 text-sm font-medium text-on-accent transition-all hover:bg-accent-solid-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface"
            >
              <Download className="h-4 w-4" />
              PDFマニュアルをダウンロード
            </a>
          </div>
        </div>
        
      </div>
    </div>
  );
}