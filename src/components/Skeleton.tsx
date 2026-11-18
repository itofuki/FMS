/* src/components/Skeleton.tsx
 * 読み込み中の仮表示。実際の画面と同じ「列の見出し ＋ 真ん中の白い列（区切り線の行）＋ 右の補足」の形で灰色の箱を出し、
 * 読み込みが終わったときに画面ががたつかないようにする。
 */
import { CENTER_PANEL, CENTER_WIDTH, PAGE_GRID, SIDE_WIDGET } from './ChapterFrame';

const bar = 'rounded bg-surface-3 motion-safe:animate-pulse';

/** 灰色の横棒（幅・高さは className で指定） */
export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`${bar} ${className}`} aria-hidden="true" />;
}

/** 列の見出しの仮表示（ページ名・補足、必要ならタブの段） */
function HeaderSkeleton({ tabs = false }: { tabs?: boolean }) {
  return (
    <div className={`bg-surface md:border-x border-b border-line ${CENTER_WIDTH}`} aria-hidden="true">
      <div className="flex items-center gap-3 px-4 sm:px-5 h-[3.25rem]">
        <SkeletonBar className="h-5 w-20" />
        <SkeletonBar className="h-4 w-28" />
      </div>
      {tabs && <div className="h-12" />}
    </div>
  );
}

function SideSkeleton() {
  return (
    <div className={`${SIDE_WIDGET} px-5 py-4 space-y-3`} aria-hidden="true">
      <SkeletonBar className="h-4 w-24" />
      <SkeletonBar className="h-3 w-full" />
      <SkeletonBar className="h-3 w-2/3" />
    </div>
  );
}

/** 一覧のページ（課題・テスト対策・設定など）の仮表示 */
export function PageSkeleton({ rows = 5, aside = true }: { rows?: number; aside?: boolean }) {
  return (
    <div role="status" aria-label="読み込み中">
      <HeaderSkeleton />
      <div className={PAGE_GRID}>
        {aside && <SideSkeleton />}
        <div className={CENTER_PANEL} aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="px-4 sm:px-5 py-4 border-b border-line space-y-2.5">
              <SkeletonBar className="h-3 w-1/3" />
              <SkeletonBar className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 表（自習室の1日分など）の仮表示 */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="読み込み中" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-4 sm:px-5 py-4" aria-hidden="true">
          <SkeletonBar className="h-4 w-12" />
          <SkeletonBar className="h-4 w-20" />
          <SkeletonBar className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** 時間割（今日の流れ）の仮表示: 左に時刻、右に授業 */
export function TimetableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="読み込み中">
      <HeaderSkeleton tabs />
      <div className={PAGE_GRID}>
        <SideSkeleton />
        <ol className={CENTER_PANEL} aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex gap-4 px-4 sm:px-5 py-4 border-b border-line">
              <div className="w-12 flex-shrink-0 flex flex-col items-end gap-1.5">
                <SkeletonBar className="h-4 w-11" />
                <SkeletonBar className="h-3 w-8" />
              </div>
              <div className="flex-1 space-y-2.5">
                <SkeletonBar className="h-3 w-1/3" />
                <SkeletonBar className="h-4 w-1/2" />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
