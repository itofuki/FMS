/* src/hooks/useMenuVisibility.ts
 * サブメニュー（テスト対策・Tips・ご意見）を全員に見せるかどうかと、その並び順。
 * root が設定の「メニューの表示（root）」で変える。値はデータベース（menu_visibility）にあり、行がない項目は表示する。
 * 読み込みの間にメニューが出たり消えたりしないよう、前回の値をこの端末に覚えておき、それを先に使う。
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

/** root が出し入れできるサブメニュー（設定は戻せなくならないよう対象にしない） */
export const TOGGLEABLE_MENUS = [
  { id: 'test-prep', label: 'テスト対策' },
  { id: 'tips', label: 'Tips' },
  { id: 'feedback', label: 'ご意見' },
] as const;

/** visible: 項目ごとの表示、order: 項目ごとの並び順（小さいほど上） */
export type MenuVisibility = { visible: Record<string, boolean>; order: Record<string, number> };
export const MENU_VISIBILITY_KEY = ['menu-visibility'] as const;
const CACHE_KEY = 'fms_menu_visibility_v2';

function readCache(): MenuVisibility | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const v = raw ? JSON.parse(raw) : undefined;
    return v && typeof v.visible === 'object' && typeof v.order === 'object' ? (v as MenuVisibility) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchMenuVisibility(): Promise<MenuVisibility> {
  const { data, error } = await supabase.from('menu_visibility').select('menu_id, visible, sort_order');
  if (error) throw error;
  const result: MenuVisibility = { visible: {}, order: {} };
  for (const row of data ?? []) {
    result.visible[row.menu_id as string] = row.visible as boolean;
    result.order[row.menu_id as string] = row.sort_order as number;
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch { /* 保存できなくても動く */ }
  return result;
}

const DEFAULT_ORDER: string[] = TOGGLEABLE_MENUS.map(m => m.id);

export function useMenuVisibility() {
  const query = useQuery({
    queryKey: MENU_VISIBILITY_KEY,
    queryFn: fetchMenuVisibility,
    placeholderData: readCache,
    staleTime: 5 * 60 * 1000,
  });
  const map = query.data ?? { visible: {}, order: {} };
  /** その項目を出すか（設定に行がなければ出す） */
  const isVisible = (id: string) => map.visible[id] !== false;
  /** 並び順のキー（設定がなければ、もともとの順） */
  const rank = (id: string) => map.order[id] ?? DEFAULT_ORDER.indexOf(id) + 1;
  /** 切り替えられる項目を、決められた順に並べたもの */
  const orderedMenus = [...TOGGLEABLE_MENUS].sort((a, b) => rank(a.id) - rank(b.id));
  return { isVisible, rank, orderedMenus, map, isLoaded: query.isFetched && !query.isPlaceholderData };
}
