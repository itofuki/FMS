/* src/components/CourseDetail.tsx
 * 時間割の「コース」タブで、コースを押したときの画面（Open LMS のアプリでコースを開いたときと同じ情報を FMS の中で見る）。
 *   - このコースの課題（FMS の課題一覧から）と出席率
 *   - お知らせ（コースのお知らせ用フォーラムの新しい投稿）
 *   - コースの内容（週・トピックごとの資料・リンク・説明）。資料は LMS から取り出して FMS から開く
 * 小テストやフォーラムへの投稿など、FMS ではできない活動だけ「LMS で開く」を付ける。
 * LMS の説明文は文字だけにして出す（HTML のまま差し込まない）。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  FiArrowLeft, FiBell, FiCheckCircle, FiChevronDown, FiChevronRight, FiClipboard, FiExternalLink, FiFile, FiFileText,
  FiFolder, FiLink, FiMessageSquare, FiHelpCircle,
} from 'react-icons/fi';
import { getLmsSession, withLmsToken, LMS_BASE } from '../lib/lms';
import {
  fetchCourseContents, fetchForumDiscussions, htmlToText,
  type CourseFile, type CourseModule, type CourseSection,
} from '../lib/lmsCourseContent';
import type { UnifiedAssignment } from '../lib/assignments';
import type { AttendanceSummary } from '../lib/attendance';
import { LIST_GROUP, LIST_GROUP_HEADING } from './ChapterFrame';

export type CourseInfo = { course_id: number; name: string; slot?: string; attendance?: AttendanceSummary };

const formatDate = (sec?: number) => {
  if (!sec) return '';
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 資料を LMS から取り出して、FMS から開く（ログインの情報は URL に残さない）。先に窓を開いてから中身を入れる（スマホで止められないように） */
async function openFile(file: CourseFile, token: string) {
  const win = window.open('', '_blank');
  try {
    const res = await fetch(withLmsToken(file.fileurl, token));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url;
    else window.location.href = url;
  } catch (e) {
    win?.close();
    toast.error(`資料を開けませんでした: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const MOD_ICON: Record<string, typeof FiFile> = {
  resource: FiFile, folder: FiFolder, url: FiLink, page: FiFileText, assign: FiClipboard, forum: FiMessageSquare, quiz: FiHelpCircle,
};
const MOD_LABEL: Record<string, string> = {
  resource: '資料', folder: 'フォルダ', url: 'リンク', page: 'ページ', assign: '課題', forum: 'フォーラム', quiz: '小テスト', attendance: '出欠',
};

function ModuleRow({ m, token }: { m: CourseModule; token: string }) {
  const [open, setOpen] = useState(false);
  const [pageText, setPageText] = useState<string | null>(null);
  const Icon = MOD_ICON[m.modname] ?? FiFile;
  const files = (m.contents ?? []).filter((f) => f.type === 'file' && f.fileurl);
  const desc = htmlToText(m.description);

  // ラベル（説明の文だけの項目）
  if (m.modname === 'label') {
    return desc ? <li className="px-4 sm:px-5 py-2.5 text-sm text-fg-muted whitespace-pre-wrap break-words">{desc}</li> : null;
  }

  const lmsUrl = m.url ?? `${LMS_BASE}/mod/${m.modname}/view.php?id=${m.id}`;
  // FMS の中で開けるもの: 資料・フォルダ（ファイル）、リンク（リンク先）、ページ（文を取り出して出す）
  const inApp = m.modname === 'resource' || m.modname === 'folder' || m.modname === 'url' || m.modname === 'page';

  const onClick = async () => {
    if (m.modname === 'url') {
      const target = m.contents?.[0]?.fileurl;
      if (target) window.open(target, '_blank', 'noopener');
      return;
    }
    if (m.modname === 'resource' && files.length === 1) { openFile(files[0], token); return; }
    if (m.modname === 'page' && pageText === null) {
      const index = (m.contents ?? []).find((f) => f.filename === 'index.html');
      if (index) {
        try {
          const html = await (await fetch(withLmsToken(index.fileurl, token))).text();
          setPageText(htmlToText(html));
        } catch {
          setPageText('ページを読み込めませんでした。');
        }
      } else setPageText(desc);
    }
    setOpen((v) => !v);
  };

  return (
    <li className="px-4 sm:px-5 py-2.5">
      <div className="flex items-start gap-3">
        <Icon size={16} className="mt-0.5 flex-shrink-0 text-fg-subtle" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          {inApp ? (
            <button type="button" onClick={onClick} className="text-left text-[15px] font-medium text-fg hover:text-link hover:underline">
              {m.name}
              {(m.modname === 'folder' || m.modname === 'page' || (m.modname === 'resource' && files.length > 1)) && (
                open ? <FiChevronDown size={14} className="inline ml-1" aria-hidden="true" /> : <FiChevronRight size={14} className="inline ml-1" aria-hidden="true" />
              )}
            </button>
          ) : (
            <p className="text-[15px] font-medium text-fg">{m.name}</p>
          )}
          <p className="text-xs text-fg-subtle">
            {MOD_LABEL[m.modname] ?? m.modname}
            {m.dates?.map((d) => <span key={d.label} className="ml-2">{d.label} {formatDate(d.timestamp)}</span>)}
          </p>
          {desc && m.modname !== 'page' && <p className="mt-1 text-sm text-fg-muted whitespace-pre-wrap break-words line-clamp-3">{desc}</p>}
          {/* フォルダ・複数ファイルの資料: ファイルの一覧 */}
          {open && (m.modname === 'folder' || (m.modname === 'resource' && files.length > 1)) && (
            <ul className="mt-1.5 space-y-1">
              {files.map((f) => (
                <li key={f.fileurl}>
                  <button type="button" onClick={() => openFile(f, token)} className="inline-flex items-center gap-1.5 text-sm text-link hover:underline">
                    <FiFile size={13} aria-hidden="true" />{f.filename}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* ページ: 文を取り出して出す */}
          {open && m.modname === 'page' && pageText !== null && (
            <p className="mt-1.5 text-sm text-fg whitespace-pre-wrap break-words">{pageText}</p>
          )}
        </div>
        {/* FMS ではできない活動（小テスト・フォーラムへの投稿など）だけ LMS で開く */}
        {!inApp && (
          <a href={lmsUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline">
            LMS<FiExternalLink size={12} aria-hidden="true" />
          </a>
        )}
      </div>
    </li>
  );
}

export default function CourseDetail({ course, assignments, onBack }: { course: CourseInfo; assignments: UnifiedAssignment[]; onBack: () => void }) {
  const session = getLmsSession();
  const token = session?.token ?? '';
  const contents = useQuery({
    queryKey: ['courseContents', course.course_id],
    enabled: !!token,
    queryFn: () => fetchCourseContents(token, course.course_id),
    staleTime: 10 * 60 * 1000,
  });
  // お知らせ用のフォーラム（最初のセクションにある「お知らせ」、なければ最初のフォーラム）
  const news = (contents.data ?? []).flatMap((s) => s.modules).filter((m) => m.modname === 'forum');
  const newsForum = news.find((m) => /お知らせ|announce|news/i.test(m.name)) ?? news[0];
  const discussions = useQuery({
    queryKey: ['courseNews', newsForum?.instance],
    enabled: !!token && !!newsForum?.instance,
    queryFn: () => fetchForumDiscussions(token, newsForum!.instance!, 5),
    staleTime: 10 * 60 * 1000,
  });
  const [openPost, setOpenPost] = useState<number | null>(null);
  const pending = assignments.filter((a) => !a.done);

  const sectionsWithItems = (contents.data ?? []).filter((s: CourseSection) => s.modules.some((m) => m.modname !== 'forum' || m.id !== newsForum?.id) || htmlToText(s.summary));

  return (
    <div>
      {/* 見出し: 戻る・コース名・曜日時限・出席率 */}
      <div className="px-4 sm:px-5 pt-3 pb-4 border-b border-line">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 -ml-1 px-1 py-1 rounded-md text-sm font-semibold text-link hover:bg-surface-3">
          <FiArrowLeft size={15} aria-hidden="true" />コース一覧
        </button>
        <h2 className="mt-1 text-lg font-extrabold text-fg leading-snug break-words">{course.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
          {course.slot && <span className="inline-flex items-center h-5 px-1.5 rounded bg-accent-soft text-accent text-xs font-bold"><span className="pill-text">{course.slot}</span></span>}
          {course.attendance && course.attendance.percent !== null && (
            <span className="inline-flex items-center gap-1"><FiCheckCircle size={12} className="text-up" aria-hidden="true" />出席率 {Math.round(course.attendance.percent)}%（{course.attendance.completed}/{course.attendance.total}回）</span>
          )}
        </div>
      </div>

      {!token && <p className="px-5 py-8 text-center text-sm text-fg-muted">LMS にログインすると、コースの内容が見られます。</p>}

      {/* このコースの課題 */}
      {pending.length > 0 && (
        <section className={LIST_GROUP}>
          <h3 className={LIST_GROUP_HEADING}>課題<span className="text-sm font-normal text-fg-muted">{pending.length}件</span></h3>
          <ul className="divide-y divide-line">
            {pending.map((a) => (
              <li key={String(a.id)} className="px-4 sm:px-5 py-2.5">
                <p className="text-[15px] font-medium text-fg">{a.name.replace(/の提出期限$/, '')}</p>
                <p className="text-xs text-fg-muted">締切 {new Date(a.deadline).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* お知らせ */}
      {newsForum && (
        <section className={LIST_GROUP}>
          <h3 className={LIST_GROUP_HEADING}><FiBell size={16} className="text-accent" aria-hidden="true" />お知らせ</h3>
          {discussions.isLoading ? (
            <p className="px-5 py-4 text-sm text-fg-muted">読み込み中...</p>
          ) : (discussions.data ?? []).length === 0 ? (
            <p className="px-5 py-4 text-sm text-fg-muted">お知らせはありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {(discussions.data ?? []).map((p) => (
                <li key={p.id} className="px-4 sm:px-5 py-2.5">
                  <button type="button" onClick={() => setOpenPost(openPost === p.id ? null : p.id)} className="w-full text-left">
                    <p className="text-[15px] font-medium text-fg">{p.subject || p.name}</p>
                    <p className="text-xs text-fg-subtle">{p.userfullname}{p.userfullname && ' · '}{formatDate(p.timemodified ?? p.created)}</p>
                  </button>
                  {openPost === p.id && <p className="mt-1.5 text-sm text-fg whitespace-pre-wrap break-words">{htmlToText(p.message)}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* コースの内容 */}
      {token && (contents.isLoading ? (
        <p className="px-5 py-8 text-center text-sm text-fg-muted">コースの内容を読み込み中...</p>
      ) : contents.isError ? (
        <p className="px-5 py-8 text-center text-sm text-down">コースの内容を読み込めませんでした。LMS に再ログインしてください。</p>
      ) : (
        sectionsWithItems.map((s) => {
          const summary = htmlToText(s.summary);
          const modules = s.modules.filter((m) => m.id !== newsForum?.id);
          return (
            <section key={s.id} className={LIST_GROUP}>
              <h3 className={LIST_GROUP_HEADING}>{s.name || '全般'}</h3>
              {summary && <p className="px-4 sm:px-5 pt-2.5 text-sm text-fg-muted whitespace-pre-wrap break-words">{summary}</p>}
              <ul className="divide-y divide-line">
                {modules.map((m) => <ModuleRow key={m.id} m={m} token={token} />)}
              </ul>
            </section>
          );
        })
      ))}
    </div>
  );
}
