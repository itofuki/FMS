/* src/components/Skeleton.tsx
 * 読み込み中の仮表示。実際の画面と同じ「真ん中の列 ＋ 右の列」の形で灰色の箱を出し、
 * 読み込みが終わったときに画面ががたつかないようにする。
 */

const bar = 'rounded bg-surface-3 motion-safe:animate-pulse';

/** 灰色の横棒（幅・高さは className で指定） */
export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`${bar} ${className}`} aria-hidden="true" />;
}

/** カードを縦に並べるページ（課題・テスト対策・設定など）の仮表示 */
export function PageSkeleton({ cards = 4, cardHeight = 'h-24', aside = true }: { cards?: number; cardHeight?: string; aside?: boolean }) {
  return (
    <div role="status" aria-label="読み込み中" className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8 xl:items-start">
      {aside && (
        <div className="mb-6 xl:mb-0 xl:order-2 bg-surface border border-line px-5 py-4 space-y-3" aria-hidden="true">
          <SkeletonBar className="h-4 w-24" />
          <SkeletonBar className="h-3 w-full" />
          <SkeletonBar className="h-3 w-2/3" />
        </div>
      )}
      <div className="xl:order-1 min-w-0 xl:px-6 flex flex-col gap-4" aria-hidden="true">
        <SkeletonBar className="h-5 w-28 mx-1 mb-1" />
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className={`rounded-xl shadow-sm bg-surface px-5 py-4 flex flex-col justify-center gap-2.5 ${cardHeight}`}>
            <SkeletonBar className="h-3 w-1/3" />
            <SkeletonBar className="h-4 w-2/3" />
          </div>
        ))}
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

/** 時間割（今日の流れ）の仮表示: 左に時刻、右に授業カード、広い画面では右の列 */
export function TimetableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="読み込み中">
      <div className="flex items-center justify-between mb-3 px-1 min-h-9" aria-hidden="true">
        <SkeletonBar className="h-4 w-40" />
        <SkeletonBar className="h-8 w-24 rounded-lg" />
      </div>
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-8 xl:items-start" aria-hidden="true">
        <div className="mb-6 xl:mb-0 xl:order-2 bg-surface border border-line px-5 py-4 space-y-3">
          <SkeletonBar className="h-4 w-20" />
          <SkeletonBar className="h-5 w-40" />
          <SkeletonBar className="h-9 w-full rounded-md" />
        </div>
        <ol className="xl:order-1 min-w-0 xl:px-6 pt-3 flex flex-col gap-5">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex gap-3 sm:gap-4">
              <div className="w-14 sm:w-16 flex-shrink-0 flex flex-col items-end gap-1.5 pt-1">
                <SkeletonBar className="h-4 w-11" />
                <SkeletonBar className="h-3 w-8" />
              </div>
              <div className="flex-1 rounded-xl shadow-sm bg-surface dark:bg-slate-700/80 px-5 py-4 space-y-2.5">
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
