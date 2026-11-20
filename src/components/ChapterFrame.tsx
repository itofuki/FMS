import React from 'react';
import type { IconType } from 'react-icons';

/*
 * 各ページの枠。X（旧 Twitter）のブラウザ版と同じく、真ん中の列の上に
 * 「ページ名・補足・操作」と「下線のタブ」を半透明で貼り付ける（スクロールしても今どこにいるかが分かる）。
 * 中身（真ん中の白い列と右の補足）は各ページが PAGE_GRID / CENTER_PANEL / SIDE_WIDGET で並べる。
 */

/*
 * 寸法は X のブラウザ版に合わせる: 真ん中の列は 600px、右の列は 350px（狭い PC では 300px）。
 * ただし幅 1440px 以上の画面では、真ん中の列を 760px に広げる（時間割の表やカレンダーは横に広いほうが見やすく、
 * X の寸法のままだと左右の余白が多すぎるため）。
 * 右の列は PC（lg 以上）だけ。タブレット・スマホでは、真ん中の列の上に補足を出す。
 */
/** 真ん中の列の幅（見出し・お知らせ・一覧で共通） */
export const CENTER_WIDTH = 'md:max-w-[600px] min-[90rem]:max-w-[760px]';
/** 真ん中の列と右の列の並び */
// タブレット（md〜lg）では補足の箱が真ん中の列の中に入るので、列の左右の線はこの並び全体に引く（途切れないように）
export const PAGE_GRID = `${CENTER_WIDTH} md:border-x lg:border-x-0 border-line lg:max-w-none lg:grid lg:grid-cols-[600px_300px] xl:grid-cols-[600px_350px] min-[90rem]:grid-cols-[760px_350px] lg:gap-6 xl:gap-8 lg:items-start`;
/** 真ん中の列: 1 枚の面（地と同じ色）。左右の線で列を区切り、中の一覧は箱で囲まずに区切り線で並べる */
export const CENTER_PANEL = 'lg:order-1 min-w-0 bg-surface lg:border-x border-line min-h-dvh';
/** 右の列の補足: 角の丸い淡い灰色の箱（X の右の列の「おすすめ」などと同じ見え方） */
export const SIDE_WIDGET = 'mx-3 my-3 md:mx-4 lg:mx-0 lg:my-0 lg:mt-3 lg:order-2 lg:sticky lg:top-3 rounded-2xl bg-surface-2 dark:bg-bg overflow-hidden';
/*
 * 見出しの段（全ページ共通）: 大 = ページ名（22px）、中 = 一覧のまとまりの見出し（18px）、小 = 各項目の名前（16px）。
 * まとまりどうしは太い帯で区切る（設定の項目と同じ）。
 */
/** 一覧のまとまり（締切の近さ・科目など）を囲む section。2 つ目からは上を太い帯で区切る */
export const LIST_GROUP = 'border-t-8 border-bg first:border-t-0';
/** 一覧のまとまりの見出し（中見出し） */
export const LIST_GROUP_HEADING = 'flex items-center gap-2 px-4 sm:px-5 pt-4 pb-3 border-b border-line text-lg font-extrabold text-fg';
/** 右の列の補足の見出し */
export const SIDE_TITLE = 'text-[17px] font-extrabold text-fg';

export type FrameTab = { key: string; label: React.ReactNode; active: boolean; onSelect: () => void };

interface ChapterFrameProps {
  /** ページ名（列の見出しに大きく出す） */
  title: React.ReactNode;
  /** 互換のため受け取るが表示しない */
  icon?: IconType;
  /** ページ名の横に小さく出す補足（日付・件数など） */
  meta?: React.ReactNode;
  /** 見出しの右端に置く操作（追加ボタンなど） */
  actions?: React.ReactNode;
  /** 見出しの下の下線タブ */
  tabs?: FrameTab[];
  /** 見出しの下に出すお知らせ（LMS のエラーなど） */
  notice?: React.ReactNode;
  /** true なら中身をそのまま並べる（ページが自分で白い列・右の列を並べる） */
  bare?: boolean;
  /** true なら白い列の中に余白を付けない */
  flush?: boolean;
  children: React.ReactNode;
}

const ChapterFrame: React.FC<ChapterFrameProps> = ({ title, meta, actions, tabs, notice, bare = false, flush = false, children }) => {
  // 右の列がない画面（bare でない）は、片側だけ空かないよう真ん中の列を中央に置く
  const center = bare ? '' : 'lg:mx-auto';
  return (
  <section className="w-full">
    {/* 列の見出し（スマホは上の細いバーの下に、広い画面は画面の上に貼り付く）。右の列の幅だけ右をあける */}
    <header className={`sticky top-[var(--chrome-top,53px)] md:top-0 z-20 bg-surface/85 backdrop-blur-md md:border-x border-b border-line transition-[top] duration-200 ${CENTER_WIDTH} ${center}`}>
      <div className="flex items-center justify-between gap-3 px-4 sm:px-5 min-h-[3.25rem] py-2">
        {/* ページ名の行はどの画面でも 1 行の同じ高さにする（横の補足が長くても折り返さず、入りきらない分は「…」）。
            折り返すと画面ごとにタブの位置がずれるため */}
        <div className="flex items-baseline gap-x-3 min-w-0">
          <h1 className="flex-shrink-0 text-[22px] font-extrabold tracking-tight text-fg whitespace-nowrap">{title}</h1>
          {meta && <div className="text-sm text-fg-muted min-w-0 truncate">{meta}</div>}
        </div>
        {actions && <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">{actions}</div>}
      </div>
      {tabs && tabs.length > 0 && (
        <div role="tablist" className="flex">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={t.active}
              onClick={t.onSelect}
              className="relative flex-1 h-12 hover:bg-surface-3 transition-colors"
            >
              <span className={`text-[15px] ${t.active ? 'font-bold text-fg' : 'font-medium text-fg-muted'}`}>{t.label}</span>
              {t.active && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-1 w-14 rounded-full bg-accent" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </header>

    {notice && <div className={`px-3 md:px-4 pt-3 bg-surface md:border-x border-line ${CENTER_WIDTH} ${center}`}>{notice}</div>}

    {bare ? (
      <div className="flex flex-col">{children}</div>
    ) : (
      <div className={`${CENTER_PANEL} ${CENTER_WIDTH} ${center} md:border-x ${flush ? '' : 'p-4 sm:p-5'}`}>{children}</div>
    )}
  </section>
  );
};

export default ChapterFrame;
