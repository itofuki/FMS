/* src/hooks/useAttendance.ts
 * 時間割の科目ごとの出席率（LMS の出欠）を、1 日 1 回だけ取りに行って端末にキャッシュする。
 * LMS に接続していない・出欠ページのない科目は対象外。
 */
import { useQuery } from '@tanstack/react-query';
import { fetchAttendanceSummary, type AttendanceSummary } from '../lib/attendance';
import { attendanceCacheKey, getLmsSession } from '../lib/lms';
import { nowInJst, toYmd } from '../lib/schedule';
import type { Subject } from '../components/Timetable';

/** 出欠ページの id（cmid）→ 出席率 */
export type AttendanceMap = Record<number, AttendanceSummary>;
type Cache = { day: string; data: AttendanceMap };

const readCache = (key: string): Cache | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Cache) : null;
  } catch {
    return null;
  }
};
const writeCache = (key: string, cache: Cache) => {
  try { localStorage.setItem(key, JSON.stringify(cache)); } catch { /* 保存できなくても表示はできる */ }
};

export function useAttendance(subjects: Subject[]): AttendanceMap {
  const session = getLmsSession();
  // 同じ科目が週に何コマあっても、出欠ページ（cmid）ごとに 1 回だけ取る
  const targets = new Map<number, number>();
  for (const s of subjects) {
    if (s.attendanceId) targets.set(s.attendanceId, Number(s.id.split('-')[0]));
  }
  const cmids = [...targets.keys()].sort((a, b) => a - b);
  const today = toYmd(nowInJst());
  const cacheKey = session ? attendanceCacheKey(session.username) : null;
  const cache = cacheKey ? readCache(cacheKey) : null;
  const cachedToday = cache?.day === today && cmids.every((id) => id in cache.data) ? cache.data : undefined;

  const { data } = useQuery({
    queryKey: ['attendance', session?.username, cmids.join(','), today],
    enabled: !!session && cmids.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        cmids.map(async (cmid) => [cmid, await fetchAttendanceSummary(session!.token, cmid, targets.get(cmid)!)] as const),
      );
      // 取れなかった科目は前回の値を残す（トークン切れなどは課題ページ側で再ログインを案内する）
      const next: AttendanceMap = { ...(cache?.data ?? {}) };
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value[1]) next[r.value[0]] = r.value[1];
      }
      if (cacheKey) writeCache(cacheKey, { day: today, data: next });
      return next;
    },
    // 今日すでに取っていれば取りに行かない。日付が変わったら、前日の値を見せながら取り直す
    initialData: cachedToday,
    placeholderData: cache?.data,
    staleTime: Infinity,
    retry: false,
  });
  return data ?? {};
}
