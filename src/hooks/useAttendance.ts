/* src/hooks/useAttendance.ts
 * 時間割の科目ごとの出席率（LMS の出欠）を取りに行き、端末にキャッシュする。
 * その日のうちに出席すると記録が増えるので、取ってから 30 分たったら、開いたとき・画面に戻ったときに取り直す
 * （取り直している間は前の値を見せる）。LMS に接続していない・出欠ページのない科目は対象外。
 */
import { useQuery } from '@tanstack/react-query';
import { fetchAttendanceSummary, type AttendanceSummary } from '../lib/attendance';
import { attendanceCacheKey, getLmsSession } from '../lib/lms';
import { nowInJst, toYmd } from '../lib/schedule';
import { clearLmsIssue, reportLmsIssue } from '../lib/lmsStatus';
import type { Subject } from '../components/Timetable';

/** 出欠ページの id（cmid）→ 出席率 */
export type AttendanceMap = Record<number, AttendanceSummary>;
/** at: 取った時刻（ミリ秒）。以前の形（day だけ）のキャッシュは、取り直しの対象にする */
type Cache = { day: string; at?: number; data: AttendanceMap };
/** 取ってからこの時間がたったら取り直す */
const FRESH_MS = 30 * 60 * 1000;

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
  // 30 分以内に取った値なら、取り直さずにそのまま使う
  const fresh = !!cache?.at && Date.now() - cache.at < FRESH_MS && cmids.every((id) => id in cache.data);

  const { data } = useQuery({
    queryKey: ['attendance', session?.username, cmids.join(',')],
    enabled: !!session && cmids.length > 0,
    queryFn: async () => {
      const results = await Promise.allSettled(
        cmids.map(async (cmid) => [cmid, await fetchAttendanceSummary(session!.token, cmid, targets.get(cmid)!)] as const),
      );
      // 取れなかった科目は前回の値を残す
      const next: AttendanceMap = { ...(cache?.data ?? {}) };
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value[1]) next[r.value[0]] = r.value[1];
      }
      // 1 科目も取れなければ、時間割に「更新できませんでした」を出す。表示は前回の値のまま、
      // 今日取れたことにはしない（次に開いたときにまた取りに行く）
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length === results.length) {
        reportLmsIssue(failed[0].reason);
        return next;
      }
      clearLmsIssue();
      if (cacheKey) writeCache(cacheKey, { day: today, at: Date.now(), data: next });
      return next;
    },
    // 30 分以内に取っていれば取りに行かない。古ければ、前の値を見せながら取り直す
    initialData: fresh ? cache!.data : undefined,
    initialDataUpdatedAt: fresh ? cache!.at : undefined,
    placeholderData: cache?.data,
    staleTime: FRESH_MS,
    // 画面に戻ったとき（アプリを開き直したとき）に、30 分たっていれば取り直す
    refetchOnWindowFocus: true,
    retry: false,
  });
  return data ?? {};
}
