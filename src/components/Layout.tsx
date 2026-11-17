/* src/components/Layout.tsx */
import { useRef, useEffect } from 'react';
import { Outlet, Link } from "react-router-dom";
import { ThemeToggleButton } from "./ThemeToggle";
import { SUB_MENU_IDS } from "../lib/menu";
import { clearDebugTime, isDebugTime } from "../lib/schedule";
import { Toaster } from 'sonner';
import { useSidebar, type ChapterLink } from "../contexts/SidebarContext"; 
import { FiMenu, FiMoreHorizontal, FiSettings, FiCalendar, FiFileText, FiBookOpen, FiFolder, FiMessageSquare, FiExternalLink, FiCheckSquare } from "react-icons/fi";

const getChapterIcon = (id: string, size: number = 20) => {
  switch (id) {
    case 'timetable': return <FiCalendar size={size} />;
    case 'assignments': return <FiFileText size={size} />;
    case 'test-prep': return <FiCheckSquare size={size} />;
    case 'study-room': return <FiBookOpen size={size} />;
    case 'tips': return <FiFolder size={size} />;
    case 'setting': return <FiSettings size={size} />;
    case 'feedback': return <FiMessageSquare size={size} />;
    default: return <FiFolder size={size} />;
  }
};

const SidebarContent: React.FC<{
  links: ChapterLink[];
  activeId: string;
  onNavigate: (id: string) => void;
  closeMenu: () => void;
}> = ({ links, activeId, onNavigate, closeMenu }) => {
  const handleNavigate = (id: string) => {
    onNavigate(id);
    closeMenu();
  };
  
  const topLinks = links.filter(link => !SUB_MENU_IDS.includes(link.id));
  const bottomLinks = links.filter(link => SUB_MENU_IDS.includes(link.id));

  return (
    <div className="flex flex-col h-full pt-4 md:pt-6 overflow-y-auto">
      <h2 className="text-xs font-semibold tracking-wider text-fg-subtle mb-3 px-4">メニュー</h2>
      
      {/* 通常のメニュー項目 */}
      <ul className="space-y-1 px-2">
        {topLinks.map(link => (
          <li key={link.id}>
            <button
              onClick={() => handleNavigate(link.id)}
              aria-current={activeId === link.id ? 'page' : undefined}
              className={`w-full flex items-center text-left px-3 py-2.5 rounded-md transition-colors duration-150 text-[15px] ${
                activeId === link.id
                  ? 'bg-accent-solid text-on-accent font-bold shadow-sm'
                  : 'text-fg font-medium hover:bg-surface-3'
              }`}
            >
              <span className={`${activeId === link.id ? 'text-on-accent' : 'text-fg-muted'}`}>
                {getChapterIcon(link.id, 20)}
              </span>
              <span className="ml-3">{link.label}</span>
            </button>
          </li>
        ))}
      </ul>

      {/* サブメニュー（テスト対策・Tips・ご意見・設定） */}
      {bottomLinks.length > 0 && (
        <div className="mt-4 px-2 pb-4">
          <hr className="border-t border-line mb-4 transition-colors duration-300" />
          <h2 className="text-xs font-semibold tracking-wider text-fg-subtle mb-3 px-2">サブメニュー</h2>
          
          <ul className="space-y-1">
            {bottomLinks.map(link => (
              <li key={link.id}>
                <button 
                  onClick={() => handleNavigate(link.id)}
                  aria-current={activeId === link.id ? 'page' : undefined}
                  className={`w-full flex items-center text-left px-3 py-2 rounded-md transition-colors duration-150 ${
                    activeId === link.id
                      ? 'bg-accent-solid text-on-accent font-bold shadow-sm'
                      : 'text-fg-muted font-medium hover:bg-surface-3 hover:text-fg'
                  }`}
                >
                  <span className={`${activeId === link.id ? 'text-on-accent' : 'text-fg-muted'}`}>
                    {getChapterIcon(link.id, 18)}
                  </span>
                  <span className="text-sm ml-3">{link.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      
    </div>
  );
};

/** デバッグ用に時刻をずらしているときの帯（本当の時刻と取り違えないよう、画面の上に常に出す） */
function DebugTimeBanner() {
  const reset = () => {
    clearDebugTime();
    const url = new URL(window.location.href);
    url.searchParams.delete('debugTime');
    window.location.replace(url.toString());
  };
  return (
    <div role="status" className="flex items-center justify-center gap-3 px-4 py-1.5 bg-amber-400 text-slate-900 text-xs sm:text-sm font-bold">
      <span>デバッグ用の時刻で表示中</span>
      <button type="button" onClick={reset} className="underline underline-offset-2 hover:no-underline">元に戻す</button>
    </div>
  );
}

export default function Layout() {
  const { isMobileMenuOpen, setIsMobileMenuOpen, chapterLinks, activeChapter, requestChapter } = useSidebar();
  const isSubMenuActive = SUB_MENU_IDS.includes(activeChapter);
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
      className="fixed inset-0 w-full h-full bg-bg text-fg overflow-hidden overscroll-none touch-pan-y transition-colors duration-300"
    >
      {/* ① スマホ用サイドメニュー */}
      {chapterLinks.length > 0 && (
        <div className="md:hidden fixed inset-y-0 left-0 w-80 bg-surface z-0 p-4 border-r border-line">
          <SidebarContent links={chapterLinks} activeId={activeChapter} onNavigate={requestChapter} closeMenu={() => setIsMobileMenuOpen(false)} />
        </div>
      )}

      {/* タブレット用オーバーレイサイドメニュー */}
      {chapterLinks.length > 0 && (
        <>
          <div 
            className={`hidden md:block lg:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-[1px] transition-opacity duration-300 ${
              isMobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`} 
            onClick={() => setIsMobileMenuOpen(false)} 
            aria-hidden="true" 
          />
          <div 
            className={`hidden md:block lg:hidden fixed inset-y-0 left-0 w-80 bg-surface z-50 p-4 border-r border-line transition-transform duration-300 ease-out ${
              isMobileMenuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
            }`}
          >
            <SidebarContent links={chapterLinks} activeId={activeChapter} onNavigate={requestChapter} closeMenu={() => setIsMobileMenuOpen(false)} />
          </div>
        </>
      )}

      {/* ② メイン画面のラッパー */}
      <div 
        className={`relative z-10 flex flex-col h-full bg-bg transition-transform duration-300 ease-out ${
          isMobileMenuOpen ? 'translate-x-80 md:translate-x-0 shadow-xl' : 'translate-x-0'
        }`}
      >
        {isMobileMenuOpen && (
          <div className="md:hidden absolute inset-0 bg-black/40 z-50 backdrop-blur-[1px]" onClick={() => setIsMobileMenuOpen(false)} aria-hidden="true" />
        )}

        {/* ヘッダー */}
        <nav className="on-header absolute top-0 left-0 w-full z-20 bg-slate-800/95 backdrop-blur-lg border-b border-white/10">
          <div className="flex items-center justify-between h-15 md:h-16 px-4 sm:px-6 lg:px-8 max-w-[1500px] mx-auto w-full">
            
            {/* 左側：メニューボタンとFMSロゴ */}
            <div className="flex items-center gap-4">
              {chapterLinks.length > 0 && (
                <button onClick={() => setIsMobileMenuOpen(true)} aria-label="メニューを開く" className="lg:hidden p-2 -ml-2 text-slate-300">
                  <FiMenu size={24} />
                </button>
              )}
              
              {/* LinkをFlexコンテナにして、アイコンと文字を横並びにする */}
              <Link to="/" className="flex items-center gap-2">
                <img src="/favicon.svg" alt="FMS Logo" className="w-8 h-8" />
                <span className="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-500 to-purple-500">
                  FMS
                </span>
              </Link>
            </div>

            {/* 右側のリンク群 */}
            <div className="flex items-center space-x-4 md:space-x-6">
              
              {/* リンク1 */}
              <a 
                href="https://portal.nkz.ac.jp/campusweb/top.do" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm md:text-base font-semibold text-emerald-400 hover:text-emerald-300 underline decoration-emerald-400/50 hover:decoration-emerald-300 underline-offset-2 hover:underline-offset-4 transition-all duration-200"
              >
                <FiExternalLink size={16} className="flex-shrink-0" />
                <span>Portal</span>
              </a>

              {/* リンク2 */}
              <a 
                href="https://st.uc.career-tasu.jp/top/" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm md:text-base font-semibold text-amber-400 hover:text-amber-300 underline decoration-amber-400/50 hover:decoration-amber-300 underline-offset-2 hover:underline-offset-4 transition-all duration-200"
              >
                <FiExternalLink size={16} className="flex-shrink-0" />
                <span>Career</span>
              </a>

              <ThemeToggleButton className="-mr-2" />
              
            </div>

          </div>
        </nav>

        {/* デバッグ用の時刻ずらし中はヘッダーのすぐ下に帯を出す */}
        {isDebugTime() && <div className="absolute top-15 md:top-16 left-0 w-full z-20"><DebugTimeBanner /></div>}

        {/* コンテンツエリア */}
        <div className="flex-1 overflow-y-auto w-full pb-20 md:pb-0 [scrollbar-gutter:stable]">
          <div className="flex w-full max-w-[1500px] mx-auto px-2 sm:px-6 lg:px-8">
            {chapterLinks.length > 0 && (
              <aside className="hidden lg:flex sticky top-0 self-start h-screen w-72 flex-shrink-0 bg-surface border-r border-line p-4 pt-16 flex-col justify-between z-10">
                <SidebarContent links={chapterLinks} activeId={activeChapter} onNavigate={requestChapter} closeMenu={() => {}} />
              </aside>
            )}
            <main className="flex-1 min-w-0 relative z-10">
              <Outlet />
            </main>
          </div>
        </div>

        {/* ③ ボトムナビゲーション (スマホのみ・メニューがあるページだけ表示) */}
        {chapterLinks.length > 0 && (
        <nav className="md:hidden absolute bottom-0 left-0 w-full z-30 bg-surface/95 backdrop-blur-md border-t border-line pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <ul className="flex justify-around items-center h-14 px-1">
            {chapterLinks.filter(link => !SUB_MENU_IDS.includes(link.id)).map(link => (
              <li key={link.id} className="flex-1">
                <button
                  onClick={() => requestChapter(link.id)}
                  aria-current={activeChapter === link.id ? 'page' : undefined}
                  className={`w-full flex flex-col items-center justify-center space-y-1 transition-colors duration-200 ${
                    activeChapter === link.id ? 'text-accent' : 'text-fg-muted'
                  }`}
                >
                  {getChapterIcon(link.id, 24)}
                  <span className="text-[10px] font-bold">{link.label}</span>
                </button>
              </li>
            ))}
            {/* その他: サブメニュー（テスト対策・Tips・ご意見・設定）が入ったメニューを開く。サブメニューの画面にいるときは選択中にする */}
            <li className="flex-1">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label={isSubMenuActive ? `その他（${chapterLinks.find(l => l.id === activeChapter)?.label}を表示中）` : 'その他のメニューを開く'}
                className={`w-full flex flex-col items-center justify-center space-y-1 transition-colors duration-200 ${isSubMenuActive ? 'text-accent' : 'text-fg-muted'}`}
              >
                <FiMoreHorizontal size={24} />
                <span className="text-[10px] font-bold">{isSubMenuActive ? chapterLinks.find(l => l.id === activeChapter)?.label : 'その他'}</span>
              </button>
            </li>
          </ul>
        </nav>
        )}
      </div>
      <Toaster position="top-right" />
    </div>
  );
}