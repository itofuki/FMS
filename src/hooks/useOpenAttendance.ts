/* src/hooks/useOpenAttendance.ts
 * いま LMS の出欠で受け付けている回と、その入力画面（読むだけ）。
 * 授業の時間のあいだ（active）、1 分ごとと画面に戻ったときに確かめる。同じ出欠ページなら 1 回の取得を共有する。
 */
import { useQuery } from '@tanstack/react-query';
import { getLmsSession } from '../lib/lms';
import { debugOpenSession, isDebugAttend } from '../lib/debugAttend';
import { fetchSessionForm, findOpenSessions, type OpenSession, type SessionForm } from '../lib/attendanceMark';

export type AttendTarget = { name: string; cmid: number; courseId: number; url: string; subtitle?: string };

/** いま受け付けている回と入力画面（読むだけ）。active のあいだ 1 分ごとに確かめる */
export function useOpenAttendance(target: AttendTarget | null, active: boolean) {
  const token = getLmsSession()?.token ?? null;
  // 見た目を試しているときは、LMS を読まずに「受け付け中」にする
  const debug = isDebugAttend();
  return useQuery({
    queryKey: ['attendOpen', target?.cmid],
    enabled: (debug || !!token) && !!target && active,
    refetchInterval: active ? 60_000 : false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<{ session: OpenSession; form: SessionForm } | null> => {
      if (debug) return debugOpenSession(target!.cmid, target!.courseId);
      const sessions = await findOpenSessions(token!, target!.cmid, target!.courseId);
      const session = sessions[sessions.length - 1];
      if (!session) return null;
      return { session, form: await fetchSessionForm(token!, session) };
    },
  });
}
