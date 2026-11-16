import React from 'react';
import type { IconType } from 'react-icons';

interface ChapterFrameProps {
  /** セクション名。現在地はパンくずとメニューで分かるため画面には出さず、読み上げ用にだけ残す */
  title: React.ReactNode;
  /** 互換のため受け取るが表示しない（見出しの帯をなくしたため） */
  icon?: IconType;
  /** カードの上の操作行・左側に出す補足（件数・モード表示など） */
  meta?: React.ReactNode;
  /** カードの上の操作行・右側に置く操作（追加ボタンなど） */
  actions?: React.ReactNode;
  /** 操作行とカードの間に出すお知らせ（LMS のエラーなど。カードの中身と混ざらないよう外に置く） */
  notice?: React.ReactNode;
  /** true なら外側のカード（枠）を付けない。中身が自分でカードを並べる場合に使う（枠の重なりを避ける） */
  bare?: boolean;
  /** true なら本文に余白を付けない（区切り線で並べる一覧を端まで使うため） */
  flush?: boolean;
  children: React.ReactNode;
}

/**
 * 各セクションの枠。見出しの帯は置かず、
 * 「（必要なら）背景・線のない小さな操作行 ＋ 白いカード」だけで構成する。
 */
const ChapterFrame: React.FC<ChapterFrameProps> = ({ title, meta, actions, notice, bare = false, flush = false, children }) => {
  const hasToolbar = Boolean(meta || actions);
  return (
    <section className="w-full">
      <h2 className="sr-only">{title}</h2>

      {hasToolbar && (
        <div className="flex items-center justify-between gap-2 mb-3 px-1 min-h-9">
          <div className="flex items-center gap-2 min-w-0 text-sm text-fg-muted">{meta}</div>
          {actions && <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">{actions}</div>}
        </div>
      )}

      {notice && <div className="mb-3">{notice}</div>}

      {bare ? (
        <div className="flex flex-col">{children}</div>
      ) : (
        <div className={`flex flex-col bg-surface border border-line rounded-lg overflow-hidden ${flush ? '' : 'p-4 sm:p-5'}`}>
          {children}
        </div>
      )}
    </section>
  );
};

export default ChapterFrame;
