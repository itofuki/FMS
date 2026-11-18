/* src/contexts/SidebarContext.tsx */

import { createContext, useState, useContext, useCallback, type ReactNode } from 'react';

// チャプターリンクの型
export type ChapterLink = {
  id: string;
  label: string;
};

// Contextが持つデータの型
type SidebarContextType = {
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (isOpen: boolean) => void;
  chapterLinks: ChapterLink[];
  setChapterLinks: (links: ChapterLink[]) => void;
  activeChapter: string;
  setActiveChapter: (id: string) => void;
  /** メニューから画面を移るとき用（今と同じ画面なら何もしない） */
  requestChapter: (id: string) => void;
};

// Contextを作成（初期値を設定）
const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

// Contextを提供するためのProviderコンポーネント
export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [chapterLinks, setChapterLinks] = useState<ChapterLink[]>([]);
  const [activeChapter, setActiveChapter] = useState<string>('');
  const requestChapter = useCallback((id: string) => {
    if (id === activeChapter) return;
    setActiveChapter(id);
  }, [activeChapter]);

  const value = {
    isMobileMenuOpen,
    setIsMobileMenuOpen,
    chapterLinks,
    setChapterLinks,
    activeChapter,
    setActiveChapter,
    requestChapter,
  };

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
};

// Contextを簡単に使うためのカスタムフック
// eslint-disable-next-line react-refresh/only-export-components -- Provider とフックを同じファイルに置く慣例のため
export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};