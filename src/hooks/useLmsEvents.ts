/* src/hooks/useLmsEvents.ts
 * LMS(Moodle)の課題・締切イベントを取得するフック。
 * 保存済みの Moodle トークンだけで同期し、パスワードは扱わない。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getLmsSession, saveLmsSession, lmsEventsCacheKey, lmsFullRefreshKey, LmsError,
  invokeFetchLms, purgeLegacyLmsSecrets,
} from '../lib/lms';
import type { LmsEvent } from '../lib/assignments';

const FULL_REFRESH_INTERVAL = 10 * 60 * 1000; // 10分に1回はフルリフレッシュ（提出削除を検知）
const CACHE_TTL = 24 * 60 * 60 * 1000;

type CachedEvent = Omit<LmsEvent, 'start' | 'end'> & { start: string; end: string };

const readCache = (username: string): CachedEvent[] | undefined => {
  try {
    const raw = localStorage.getItem(lmsEventsCacheKey(username));
    if (!raw) return undefined;
    const { events, ts } = JSON.parse(raw) as { events: CachedEvent[]; ts: number };
    if (Date.now() - ts > CACHE_TTL) return undefined;
    return events;
  } catch { return undefined; }
};

/** キャッシュから uid→submissionStatus のマップを作る（差分取得用） */
const getCachedStatuses = (username: string): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const e of readCache(username) ?? []) {
    if (e.uid && e.submissionStatus) map[e.uid] = e.submissionStatus;
  }
  return map;
};

export function useLmsEvents() {
  const [session] = useState(() => {
    purgeLegacyLmsSecrets();
    return getLmsSession();
  });
  const username = session?.username ?? '';

  const query = useQuery<LmsEvent[], LmsError>({
    queryKey: ['lmsEvents', 'api', username],
    queryFn: async () => {
      // 最新のトークンを都度読み直す（設定画面で再ログインした場合に追従）
      const current = getLmsSession();
      if (!current) throw new LmsError('TOKEN_EXPIRED', 'LMS未接続');

      const lastFull = Number(localStorage.getItem(lmsFullRefreshKey(username)) ?? 0);
      const isFullRefresh = Date.now() - lastFull > FULL_REFRESH_INTERVAL;
      const cachedStatuses = isFullRefresh ? {} : getCachedStatuses(username);

      const data = await invokeFetchLms({
        cachedToken: current.token,
        cachedUserId: current.userId,
        cachedStatuses,
      });

      if (data.token && data.userId) {
        saveLmsSession({ username: current.username, token: data.token, userId: data.userId });
      }
      if (isFullRefresh) localStorage.setItem(lmsFullRefreshKey(username), String(Date.now()));
      const events = (data.events ?? []) as LmsEvent[];
      localStorage.setItem(lmsEventsCacheKey(username), JSON.stringify({ events, ts: Date.now() }));
      return events;
    },
    placeholderData: () => readCache(username) as LmsEvent[] | undefined, // リロード時はキャッシュを即座に表示
    enabled: !!session,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.error?.code === 'TOKEN_EXPIRED' ? false : 2 * 60 * 1000),
    refetchIntervalInBackground: false,
    retry: false,
  });

  const forceFullRefresh = () => {
    if (!session || query.isFetching) return;
    localStorage.setItem(lmsFullRefreshKey(username), '0');
    query.refetch();
  };

  return {
    ...query,
    session,
    hasLmsSession: !!session,
    isTokenExpired: query.error?.code === 'TOKEN_EXPIRED',
    forceFullRefresh,
  };
}
