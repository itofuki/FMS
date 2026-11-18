/* src/components/Layout.tsx
 * 画面の骨組み。X（旧 Twitter）のブラウザ版の寸法と動きに合わせる:
 *   - 全体を中央に寄せる（最大 1265px）。画面の地は真ん中の列と同じ色で、列どうしは線だけで区切る
 *   - 広い PC（xl 以上）: 左に文字付きのナビ（275px。いちばん上にロゴ、下に Portal・Career・テーマ）
 *   - 狭い PC・タブレット（md〜xl）: 左にアイコンだけのナビ（88px）
 *   - スマホ: 上にアカウントのアイコンとロゴのバー、下にアイコンだけのタブ。
 *     下にスクロールするとバーが隠れて列の見出しだけが残り、上に戻すと出てくる
 * 全体を通した濃い帯（ヘッダー）は置かず、各ページの列の上に見出し（ChapterFrame）を貼り付ける。
 */
import { useRef, useEffect, useState } from 'react';
import { Outlet, Link } from "react-router-dom";
import { ThemeToggleButton } from "./ThemeToggle";
import { SUB_MENU_IDS } from "../lib/menu";
import { clearDebugTime, isDebugTime } from "../lib/schedule";
import { Toaster } from 'sonner';
import { useSidebar, type ChapterLink } from "../contexts/SidebarContext";
import Avatar from "./Avatar";
import { displayName, useCurrentUser } from "../hooks/useCurrentUser";
import { FiMoreHorizontal, FiSettings, FiCalendar, FiFileText, FiBookOpen, FiFolder, FiMessageSquare, FiExternalLink, FiCheckSquare } from "react-icons/fi";

const getChapterIcon = (id: string, size: number = 20, strokeWidth = 2) => {
  const p = { size, strokeWidth };
  switch (id) {
    case 'timetable': return <FiCalendar {...p} />;
    case 'assignments': return <FiFileText {...p} />;
    case 'test-prep': return <FiCheckSquare {...p} />;
    case 'study-room': return <FiBookOpen {...p} />;
    case 'tips': return <FiFolder {...p} />;
    case 'setting': return <FiSettings {...p} />;
    case 'feedback': return <FiMessageSquare {...p} />;
    default: return <FiFolder {...p} />;
  }
};

// 外部サイト。ナビでは文字はほかの項目と同じ色にし、アイコンだけ色を付ける（選択中の項目より目立たないように）
const EXTERNAL_LINKS = [
  { href: 'https://portal.nkz.ac.jp/campusweb/top.do', label: 'Portal', iconClass: 'text-emerald-600 dark:text-emerald-400' },
  { href: 'https://st.uc.career-tasu.jp/top/', label: 'Career', iconClass: 'text-amber-600 dark:text-amber-400' },
];

function Logo({ withText = true }: { withText?: boolean }) {
  return (
    <Link to="/" className="inline-flex items-center gap-2 rounded-full p-1.5 -m-1.5 hover:bg-surface-3 transition-colors" aria-label="FMS">
      <img src="/favicon.svg" alt="" className="w-8 h-8" />
      {withText && (
        <span className="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-sky-500 to-purple-500">FMS</span>
      )}
    </Link>
  );
}

/**
 * ナビの中身。compact = アイコンだけ（タブレットの細い列）。
 * 選択中は X と同じく「文字を太く・アイコンを強調」するだけで、色付きの箱にはしない。
 */
function SidebarContent({ links, activeId, onNavigate, closeMenu, compact = false }: {
  links: ChapterLink[];
  activeId: string;
  onNavigate: (id: string) => void;
  closeMenu: () => void;
  compact?: boolean;
}) {
  const handleNavigate = (id: string) => {
    onNavigate(id);
    closeMenu();
  };
  const topLinks = links.filter(link => !SUB_MENU_IDS.includes(link.id));
  const bottomLinks = links.filter(link => SUB_MENU_IDS.includes(link.id));
  const user = useCurrentUser();

  const item = (link: ChapterLink, sub: boolean) => {
    const active = activeId === link.id;
    return (
      <li key={link.id}>
        <button
          onClick={() => handleNavigate(link.id)}
          aria-current={active ? 'page' : undefined}
          title={compact ? link.label : undefined}
          aria-label={compact ? link.label : undefined}
          className={`group flex items-center rounded-full transition-colors duration-150 hover:bg-surface-3 ${
            compact ? 'justify-center w-12 h-12 mx-auto' : `w-full gap-4 px-4 ${sub ? 'py-2' : 'py-2.5'}`
          }`}
        >
          <span className={active ? 'text-accent' : 'text-fg'}>{getChapterIcon(link.id, sub && !compact ? 20 : 24, active ? 2.6 : 1.8)}</span>
          {!compact && (
            <span className={`${sub ? 'text-[15px]' : 'text-[17px]'} ${active ? 'font-bold text-accent' : 'text-fg'}`}>{link.label}</span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className={`pt-3 pb-4 ${compact ? 'flex justify-center' : 'px-4'}`}>
        <Logo withText={!compact} />
      </div>

      <ul className={`space-y-1 ${compact ? '' : 'px-1'}`}>{topLinks.map(l => item(l, false))}</ul>

      {/* サブメニュー（テスト対策・Tips・ご意見・設定） */}
      {bottomLinks.length > 0 && (
        <div className={`mt-4 pt-4 border-t border-line ${compact ? '' : 'px-1'}`}>
          {!compact && <h2 className="text-xs font-semibold tracking-wider text-fg-subtle mb-2 px-4">サブメニュー</h2>}
          <ul className="space-y-0.5">{bottomLinks.map(l => item(l, true))}</ul>
        </div>
      )}

      {/* リンク: Portal・Career（外部サイト）を、ほかの項目と同じ形で並べる。テーマの切り替えは設定の「表示」にある */}
      <div className={`mt-4 pt-4 border-t border-line ${compact ? '' : 'px-1'}`}>
        {!compact && <h2 className="text-xs font-semibold tracking-wider text-fg-subtle mb-2 px-4">リンク</h2>}
        <ul className="space-y-0.5">
          {EXTERNAL_LINKS.map(l => (
            <li key={l.label}>
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                title={compact ? l.label : undefined}
                aria-label={compact ? l.label : undefined}
                className={`flex items-center rounded-full text-fg transition-colors hover:bg-surface-3 ${compact ? 'justify-center w-12 h-12 mx-auto' : 'w-full gap-4 px-4 py-2'}`}
              >
                <FiExternalLink size={20} strokeWidth={1.8} className={l.iconClass} />
                {!compact && <span className="text-[15px]">{l.label}</span>}
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* X の左下のアカウント欄: 自分のアイコンと名前（押すと設定のアカウントへ） */}
      <div className="mt-auto pt-4 pb-3">
        <button
          type="button"
          onClick={() => handleNavigate('setting')}
          title={compact ? displayName(user) : undefined}
          aria-label={`${displayName(user)}（アカウントの設定）`}
          className={`flex items-center rounded-full hover:bg-surface-3 transition-colors ${compact ? 'mx-auto p-1.5' : 'w-full gap-3 px-3 py-2.5 text-left'}`}
        >
          <Avatar user={user} size={40} />
          {!compact && <span className="min-w-0 text-[15px] font-bold text-fg truncate">{displayName(user)}</span>}
        </button>
      </div>

    </div>
  );
}

/**
 * スマホとログイン画面の上のバー（X と同じく、左にアカウント・真ん中にロゴ）。
 * onOpenMenu があるとき（マイページ）は左のアイコンでナビ全体を開く。Portal・Career はナビの中にある。
 * hidden のときは上に隠す（下にスクロール中）。
 */
function TopBar({ onOpenMenu, hidden = false, className = '' }: { onOpenMenu?: () => void; hidden?: boolean; className?: string }) {
  const user = useCurrentUser();
  return (
    <div className={`sticky top-0 z-30 grid grid-cols-[3rem_1fr_3rem] items-center h-12 px-2 bg-surface/85 backdrop-blur-md transition-transform duration-200 ${hidden ? '-translate-y-full pointer-events-none' : ''} ${className}`}>
      <div>
        {onOpenMenu && (
          <button type="button" onClick={onOpenMenu} aria-label="メニューを開く" className="rounded-full hover:opacity-80 transition-opacity">
            <Avatar user={user} size={32} />
          </button>
        )}
      </div>
      <div className="flex justify-center"><Logo /></div>
      <div className="flex justify-end">{!onOpenMenu && <ThemeToggleButton />}</div>
    </div>
  );
}

/** デバッグ用に時刻をずらしているときの帯（本当の時刻と取り違えないよう、画面の上に常に出す） */
function DebugTimeBanner() {
  const reset = () => {
    clearDebugTime();
    const url = new URL(window.location.href);
    url.searchParams.delete('debugTime');
    window.location.replace(url.toString());
  };
  return (
    <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-3 px-4 py-1.5 bg-amber-400 text-slate-900 text-xs sm:text-sm font-bold">
      <span>デバッグ用の時刻で表示中</span>
      <button type="button" onClick={reset} className="underline underline-offset-2 hover:no-underline">元に戻す</button>
    </div>
  );
}

export default function Layout() {
  const { isMobileMenuOpen, setIsMobileMenuOpen, chapterLinks, activeChapter, requestChapter } = useSidebar();
  const isSubMenuActive = SUB_MENU_IDS.includes(activeChapter);
  const hasNav = chapterLinks.length > 0;

  // 下にスクロールしている間は、スマホの上のバーを隠して下のタブを半透明にする（上に戻すと元に戻る）
  const [chromeHidden, setChromeHidden] = useState(false);
  const scrollRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    let last = root.scrollTop;
    const onScroll = () => {
      const y = root.scrollTop;
      if (y < 60) setChromeHidden(false);
      else if (y > last + 6) setChromeHidden(true);
      else if (y < last - 6) setChromeHidden(false);
      last = y;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ x: number, y: number } | null>(null);
  const isDraggingRef = useRef<boolean | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isDraggingRef.current = null;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - touchStartRef.current.x;
      const diffY = currentY - touchStartRef.current.y;
      if (isDraggingRef.current === null) {
        if (Math.abs(diffX) > 5 || Math.abs(diffY) > 5) isDraggingRef.current = Math.abs(diffX) > Math.abs(diffY);
      }
      if (isDraggingRef.current === true && e.cancelable) e.preventDefault(); 
    };
    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      if (isDraggingRef.current === true) {
        const diffX = e.changedTouches[0].clientX - touchStartRef.current.x;
        const minSwipeDistance = 30;
        if (!isMobileMenuOpen && diffX > minSwipeDistance) setIsMobileMenuOpen(true);
        else if (isMobileMenuOpen && diffX < -minSwipeDistance) setIsMobileMenuOpen(false);
      }
      touchStartRef.current = null;
      isDraggingRef.current = null;
    };
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isMobileMenuOpen, setIsMobileMenuOpen]);


  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-full h-full bg-surface text-fg overflow-hidden overscroll-none touch-pan-y transition-colors duration-300"
    >
      {/* スマホ: スワイプや「その他」で引き出すナビ（メイン画面の下に置き、メイン画面を右にずらして見せる） */}
      {hasNav && (
        <div className="md:hidden fixed inset-y-0 left-0 w-80 bg-surface z-0 px-3 border-r border-line">
          <SidebarContent links={chapterLinks} activeId={activeChapter} onNavigate={requestChapter} closeMenu={() => setIsMobileMenuOpen(false)} />
        </div>
      )}

      {/* メイン画面 */}
      <div
        className={`relative z-10 flex flex-col h-full bg-surface transition-transform duration-300 ease-out ${
          isMobileMenuOpen ? 'translate-x-80 md:translate-x-0 shadow-xl' : 'translate-x-0'
        }`}
      >
        {isMobileMenuOpen && (
          <div className="md:hidden absolute inset-0 bg-black/40 z-50 backdrop-blur-[1px]" onClick={() => setIsMobileMenuOpen(false)} aria-hidden="true" />
        )}

        {/* スクロールするのはここ（タブごとのスクロール位置の記憶に使うため data-scroll-root を付ける） */}
        <div
          ref={scrollRootRef}
          data-scroll-root
          // 列の見出しを貼り付ける位置（スマホで上のバーが出ている間はその下、隠れたら画面の上端）
          style={{ ['--chrome-top' as string]: chromeHidden ? '0px' : '3rem' }}
          className="flex-1 overflow-y-auto w-full pb-16 md:pb-0 [scrollbar-gutter:stable]"
        >
          {isDebugTime() && <DebugTimeBanner />}
          {/* ナビのない画面（ログインなど）と、スマホでは上のバー */}
          <TopBar
            className={hasNav ? 'md:hidden' : ''}
            onOpenMenu={hasNav ? () => setIsMobileMenuOpen(true) : undefined}
            hidden={hasNav && chromeHidden}
          />

          {/* X と同じく全体を中央に寄せる（左のナビ＋真ん中 600px＋右 350px） */}
          <div className="flex w-full max-w-[1265px] mx-auto justify-center">
            {hasNav && (
              <>
                {/* 狭い PC・タブレット: アイコンだけのナビ（88px） */}
                <aside className="hidden md:flex xl:hidden sticky top-0 self-start h-dvh w-[88px] flex-shrink-0 px-2 z-20">
                  <SidebarContent compact links={chapterLinks} activeId={activeChapter} onNavigate={requestChapter} closeMenu={() => {}} />
                </aside>
                {/* 広い PC: 文字付きのナビ（275px） */}
                <aside className="hidden xl:flex sticky top-0 self-start h-dvh w-[275px] flex-shrink-0 px-2 z-20">
                  <div className="w-full"><SidebarContent links={chapterLinks} activeId={activeChapter} onNavigate={requestChapter} closeMenu={() => {}} /></div>
                </aside>
              </>
            )}
            {/* 中身の幅: 真ん中 600px（PC では＋右の列 300〜350px）。ナビと合わせて画面の中央に置く */}
            <main className={`flex-1 min-w-0 relative z-10 ${hasNav ? 'md:flex-none md:w-[600px] lg:w-[924px] xl:w-[982px]' : ''}`}>
              <Outlet />
            </main>
          </div>
        </div>

        {/* スマホ: 下のタブ（X と同じくアイコンだけ。下にスクロール中は半透明） */}
        {hasNav && (
        <nav className={`md:hidden absolute bottom-0 left-0 w-full z-30 bg-surface/90 backdrop-blur-md border-t border-line pb-[env(safe-area-inset-bottom)] transition-opacity duration-200 ${chromeHidden ? 'opacity-50' : ''}`}>
          <ul className="flex justify-around items-center h-[53px]">
            {chapterLinks.filter(link => !SUB_MENU_IDS.includes(link.id)).map(link => {
              const active = activeChapter === link.id;
              return (
                <li key={link.id} className="flex-1 flex justify-center">
                  <button
                    onClick={() => requestChapter(link.id)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={link.label}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${active ? 'text-accent' : 'text-fg'}`}
                  >
                    {getChapterIcon(link.id, 26, active ? 2.6 : 1.8)}
                  </button>
                </li>
              );
            })}
            {/* その他: サブメニュー（テスト対策・Tips・ご意見・設定）が入ったナビを開く。サブメニューの画面にいるときは選択中にする */}
            <li className="flex-1 flex justify-center">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label={isSubMenuActive ? `その他（${chapterLinks.find(l => l.id === activeChapter)?.label}を表示中）` : 'その他のメニューを開く'}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isSubMenuActive ? 'text-accent' : 'text-fg'}`}
              >
                <FiMoreHorizontal size={26} strokeWidth={isSubMenuActive ? 2.6 : 1.8} />
              </button>
            </li>
          </ul>
        </nav>
        )}
      </div>
      {/* お知らせは X と同じく画面の下の中央（スマホでは下のタブの上） */}
      <Toaster position="bottom-center" offset={24} mobileOffset={{ bottom: 72 }} />
    </div>
  );
}
