import { useEffect, useMemo, useRef } from 'react';

// 時刻の型定義
type ReloadTime = {
  hour: number;
  minute: number;
};

const DEFER_RETRY_MS = 30_000;

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
    // 1. スケジュールする時刻がなければ何もしない
    if (times.length === 0) {
      return;
    }

    let timeoutId: number;

    const scheduleReload = () => {
      const now = new Date();

      // 2. 今日の日付で、指定された時刻のDateオブジェクトのリストを作成
      const todaySchedules = times.map(({ hour, minute }) => {
        const schedule = new Date();
        schedule.setHours(hour, minute, 0, 0);
        return schedule;
      });

      // 3. 今日の中で、まだ過ぎていない未来のスケジュールだけをフィルタリング
      const upcomingSchedules = todaySchedules
        .filter((schedule) => schedule.getTime() > now.getTime())
        .sort((a, b) => a.getTime() - b.getTime()); // 時刻が早い順にソート

      let nextReload: Date;

      // 4. もし今日中にリロードすべき時刻が残っていれば、その一番早い時刻を設定
      if (upcomingSchedules.length > 0) {
        nextReload = upcomingSchedules[0];
      } else {
        // 5. 今日中にリロードすべき時刻がなければ、明日のスケジュールの中で一番早いものを設定
        const tomorrowSchedules = times.map(({ hour, minute }) => {
          const schedule = new Date();
          schedule.setDate(schedule.getDate() + 1); // 日付を明日にする
          schedule.setHours(hour, minute, 0, 0);
          return schedule;
        });
        // 明日のスケジュールをソートして一番早いものを取得
        nextReload = tomorrowSchedules.sort((a, b) => a.getTime() - b.getTime())[0];
      }

      // 6. 次のリロードまでの残り時間を計算
      const delay = nextReload.getTime() - now.getTime();

      console.log(`次のリロードは ${nextReload.toLocaleString()} です。`);

      // 7. タイマーをセット（先送り中は一定間隔でリトライする）
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

    // 8. コンポーネントが不要になったらタイマーを解除
    return () => {
      clearTimeout(timeoutId);
    };
    
  }, [serializedTimes, times]); // times配列の内容が変わったときに再実行
}