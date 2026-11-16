import { useEffect, useMemo, useRef } from 'react';

// 時刻の型定義
type ReloadTime = {
  hour: number;
  minute: number;
};

const DEFER_RETRY_MS = 30_000;

/**
 * 指定時刻のうち、now より後で最も近い時刻を返す（今日に残っていなければ明日の最も早い時刻）。
 * times が空なら null。
 */
export function getNextReloadTime(times: ReloadTime[], now: Date = new Date()): Date | null {
  if (times.length === 0) return null;
  const at = (dayOffset: number, { hour, minute }: ReloadTime) => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const upcoming = times
    .map((t) => at(0, t))
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
  if (upcoming.length > 0) return upcoming[0];
  return times.map((t) => at(1, t)).sort((a, b) => a.getTime() - b.getTime())[0];
}

/**
 * 指定した時刻の配列の中から、最も近い未来の時刻にページをリロードするカスタムフック
 * @param times - リロードしたい時刻の配列 (例: [{ hour: 5, minute: 0 }, { hour: 12, minute: 30 }])
 * @param shouldDefer - trueを返す間はリロードを先送りし、一定間隔で再チェックする（例: クイズ回答中など）
 */
export function useScheduledReloader(times: ReloadTime[], shouldDefer?: () => boolean) {
  // times配列が変更されたときだけ再計算するようにメモ化
  const serializedTimes = useMemo(() => JSON.stringify(times), [times]);

  // 最新のshouldDeferを常に参照できるようにrefで保持（effectの再実行は不要）
  const shouldDeferRef = useRef(shouldDefer);
  shouldDeferRef.current = shouldDefer;

  useEffect(() => {
    const times: ReloadTime[] = JSON.parse(serializedTimes);
    // 1. スケジュールする時刻がなければ何もしない
    if (times.length === 0) {
      return;
    }

    let timeoutId: number;

    const scheduleReload = () => {
      const now = new Date();
      const nextReload = getNextReloadTime(times, now);

      // 2. 次のリロードまでの残り時間を計算
      if (!nextReload) return;
      const delay = nextReload.getTime() - now.getTime();

      console.log(`次のリロードは ${nextReload.toLocaleString()} です。`);

      // 3. タイマーをセット（先送り中は一定間隔でリトライする）
      const attemptReload = () => {
        if (shouldDeferRef.current?.()) {
          timeoutId = window.setTimeout(attemptReload, DEFER_RETRY_MS);
          return;
        }
        window.location.reload();
      };
      timeoutId = window.setTimeout(attemptReload, delay);
    };

    scheduleReload();

    // 4. コンポーネントが不要になったらタイマーを解除
    return () => {
      clearTimeout(timeoutId);
    };
    
  }, [serializedTimes]); // times配列の「内容」が変わったときだけ再実行（毎レンダーの新しい配列では再実行しない）
}