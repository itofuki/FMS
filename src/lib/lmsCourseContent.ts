/* src/lib/lmsCourseContent.ts
 * コースの中身を LMS から読む（Open LMS のアプリがコースを開いたときと同じ情報）。
 *   - fetchCourseContents : セクション（週・トピック）と、その中の活動・資料（core_course_get_contents）
 *   - fetchForumDiscussions : お知らせ（フォーラム）の新しい投稿（mod_forum_get_forum_discussions）
 * LMS の説明文は HTML なので、画面には htmlToText で文字だけにして出す（HTML のまま差し込まない）。
 */
import { LMS_BASE } from './lms';

export type CourseFile = { filename: string; fileurl: string; mimetype?: string; filesize?: number; type?: string };
export type CourseModule = {
  id: number;
  instance?: number;
  name: string;
  modname: string;
  url?: string;
  description?: string;
  uservisible?: boolean;
  visible?: number;
  contents?: CourseFile[];
  dates?: { label: string; timestamp: number }[];
};
export type CourseSection = { id: number; name: string; summary?: string; uservisible?: boolean; visible?: number; modules: CourseModule[] };
export type ForumDiscussion = { id: number; name: string; subject?: string; message: string; created?: number; timemodified?: number; userfullname?: string };

async function call(token: string, wsfunction: string, params: Record<string, string>): Promise<unknown> {
  const body = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: 'json', ...params });
  const res = await fetch(`${LMS_BASE}/webservice/rest/server.php`, { method: 'POST', body });
  const data = await res.json();
  if (data && typeof data === 'object' && 'exception' in data) {
    const e = data as { errorcode?: string; message?: string };
    throw new Error(`${e.errorcode}: ${e.message}`);
  }
  return data;
}

/** コースのセクションと活動・資料（見えないものは除く） */
export async function fetchCourseContents(token: string, courseId: number): Promise<CourseSection[]> {
  const sections = (await call(token, 'core_course_get_contents', { courseid: String(courseId) })) as CourseSection[];
  return sections
    .filter((s) => s.uservisible !== false && s.visible !== 0)
    .map((s) => ({ ...s, modules: (s.modules ?? []).filter((m) => m.uservisible !== false && m.visible !== 0) }));
}

/** フォーラムの新しい投稿（新しい順に count 件） */
export async function fetchForumDiscussions(token: string, forumId: number, count = 5): Promise<ForumDiscussion[]> {
  const data = (await call(token, 'mod_forum_get_forum_discussions', {
    forumid: String(forumId), sortorder: '0', page: '0', perpage: String(count),
  })) as { discussions?: ForumDiscussion[] };
  return data.discussions ?? [];
}

/** LMS の HTML を文字だけにする（改行は残す）。画面には文字として出すので、スクリプトなどは動かない */
export function htmlToText(html: string | undefined | null): string {
  if (!html) return '';
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html
    // スクリプト・スタイルの中身は文字として出さない
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    // 文字参照（&amp; &#12354; &#x3042; など）を戻す
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return named[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
