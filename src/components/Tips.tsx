/* src/components/Tips.tsx
 * 便利な使い方ガイドの一覧。課題ページと同じく「1件 = 1枚のカード」、広い画面では右に補足の列。
 * ガイドを増やすときは TIPS に追加する。
 */
import { Link } from 'react-router-dom';
import { FiDownload, FiArrowRight, FiInfo } from 'react-icons/fi';
import ChapterFrame, { CENTER_PANEL, PAGE_GRID, SIDE_TITLE, SIDE_WIDGET } from './ChapterFrame';

type Tip = {
  title: string;
  description: string;
  isNew?: boolean;
  meta: string;
  file: { href: string; downloadName: string; label: string };
};

const TIPS: Tip[] = [
  {
    title: 'LMS爆速ログイン完全ガイド',
    description:
      '毎回の「LMSの2段階認証」でメールやモバイルアプリ確認の手間をゼロに。PCとスマホ両方で、ワンタイムパスワードを「コピペ」や「自動入力」だけで突破する設定手順をまとめました。',
    isNew: true,
    meta: 'PDF・設定は約5分',
    file: { href: '/lms_fast_login_guide.pdf', downloadName: 'LMS爆速ログイン完全ガイド.pdf', label: 'PDFをダウンロード' },
  },
];

export default function Tips() {
  return (
    <ChapterFrame title="Tips" meta={<span>ガイド <span className="font-semibold text-fg">{TIPS.length}</span>件</span>} bare>
      <div className={PAGE_GRID}>
        {/* 右の列: Tips について */}
        <aside className={`${SIDE_WIDGET} px-4 sm:px-5 py-4`}>
          <p className={`${SIDE_TITLE} flex items-center gap-1.5`}><FiInfo size={16} />Tips について</p>
          <p className="mt-2 text-sm text-fg-muted leading-relaxed">
            FMS や LMS をもっと便利に使うための手順をまとめています。
          </p>
          <Link to="?tab=feedback" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-link hover:underline">
            ほしいガイドを提案する <FiArrowRight size={14} />
          </Link>
        </aside>

        {/* 左: ガイドの一覧 */}
        <ul className={`${CENTER_PANEL} flex flex-col`}>
          {TIPS.map(tip => (
            <li key={tip.title} className="px-4 sm:px-5 py-5 border-b border-line">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {tip.isNew && <span className="inline-flex items-center h-5 px-2 rounded-full bg-accent-soft text-accent text-xs font-bold"><span className="pill-text">NEW</span></span>}
                <span className="text-fg-muted">{tip.meta}</span>
              </div>
              <h3 className="mt-2 text-lg sm:text-xl font-bold text-fg leading-snug">{tip.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{tip.description}</p>
              <div className="mt-4 flex justify-end">
                <a
                  href={tip.file.href}
                  download={tip.file.downloadName}
                  className="inline-flex w-full sm:w-auto items-center justify-center gap-2 h-10 px-5 rounded-md bg-accent-solid hover:bg-accent-solid-hover text-on-accent transition-colors"
                >
                  <FiDownload size={16} />
                  <span className="text-sm font-bold">{tip.file.label}</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </ChapterFrame>
  );
}
