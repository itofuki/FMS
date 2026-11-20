/* src/components/RootMenuVisibility.tsx
 * 設定の「メニューの表示（root）」。root のアカウントだけに出す。
 * サブメニュー（テスト対策・Tips・ご意見）について、どちらも押した・離した時点で全員のメニューに反映する:
 *   - 表示・非表示: 右のスイッチ（root_set_menu_visibility）
 *   - 並び順: 左のつまみ（⋮⋮）をドラッグして離す（root_set_menu_order）。指でも動かせるよう、
 *     ブラウザ標準のドラッグではなくポインターの動きで並べ替える。つまみを選んで ↑↓ キーでも動かせる
 * 隠しても、その画面のデータは消えない。設定はいつもいちばん下。
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MdDragIndicator } from 'react-icons/md';
import { supabase } from '../lib/supabaseClient';
import { MENU_VISIBILITY_KEY, TOGGLEABLE_MENUS, useMenuVisibility } from '../hooks/useMenuVisibility';

const LABELS: Record<string, string> = Object.fromEntries(TOGGLEABLE_MENUS.map(m => [m.id, m.label]));

export default function RootMenuVisibility() {
  const queryClient = useQueryClient();
  const { isVisible, orderedMenus } = useMenuVisibility();
  const [busy, setBusy] = useState<string | null>(null);
  // ドラッグ中（または保存中）の並び。null のときは保存済みの並びを出す
  const [draft, setDraft] = useState<string[] | null>(null);
  // ドラッグの様子: 動かしている項目・指の移動量（dy）・入る位置（to）と、始めたときの各行の位置と高さ
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; tops: number[]; heights: number[]; releasing?: boolean } | null>(null);
  // 離した直後の 1 回だけ、行の移動のアニメーションを止める（並びの確定と位置のずれの解消を同時に行うため）
  const [settling, setSettling] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const dragId = drag?.id ?? null;

  const ids = draft ?? orderedMenus.map(m => m.id);

  const toggle = async (id: string, visible: boolean) => {
    setBusy(id);
    const { error } = await supabase.rpc('root_set_menu_visibility', { p_menu_id: id, p_visible: visible });
    setBusy(null);
    if (error) {
      toast.error(`${LABELS[id]}の表示を変えられませんでした: ${error.message}`);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: MENU_VISIBILITY_KEY });
  };

  // 並びを保存する（変わっていなければ何もしない）
  const saveOrder = async (next: string[]) => {
    if (next.every((id, i) => id === orderedMenus[i]?.id)) { setDraft(null); return; }
    setDraft(next);
    setBusy('order');
    const { error } = await supabase.rpc('root_set_menu_order', { p_menu_ids: next });
    if (error) toast.error(`並び順を保存できませんでした: ${error.message}`);
    await queryClient.invalidateQueries({ queryKey: MENU_VISIBILITY_KEY });
    setBusy(null);
    setDraft(null);
  };

  // つまみを押したらドラッグ開始。動かしている行は指に合わせて滑らかに動き、ほかの行はよけるように滑って空きを作る。
  // 並びが確定するのは離したとき（そこで保存する）。動きと離したことは画面全体（window）で受ける
  const onGripPointerDown = (e: React.PointerEvent, id: string) => {
    if (busy || e.button > 0 || !listRef.current) return;
    e.preventDefault();
    const listTop = listRef.current.getBoundingClientRect().top;
    const rects = (Array.from(listRef.current.children) as HTMLElement[]).map(el => el.getBoundingClientRect());
    const tops = rects.map(r => r.top - listTop);
    const heights = rects.map(r => r.height);
    const from = ids.indexOf(id);
    const total = tops[tops.length - 1] + heights[heights.length - 1];
    const startY = e.clientY;
    const order = ids;
    let state = { id, from, to: from, dy: 0, tops, heights };
    setDrag(state);

    const onMove = (ev: PointerEvent) => {
      // 一覧の外には出さない
      const dy = Math.max(-tops[from], Math.min(total - tops[from] - heights[from], ev.clientY - startY));
      // 動かしている行の真ん中より上に真ん中がある、ほかの行の数 = 入る位置
      const center = tops[from] + heights[from] / 2 + dy;
      let to = 0;
      // （端まで動かすと真ん中どうしがほぼ重なる。行の高さの端数で届かないことがないよう、動かす向きに 2px の余裕を見る）
      for (let i = 0; i < tops.length; i++) {
        const mid = tops[i] + heights[i] / 2;
        if ((i < from && mid < center - 2) || (i > from && mid <= center + 2)) to++;
      }
      state = { ...state, dy, to };
      setDrag(state);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const next = [...order];
      next.splice(state.from, 1);
      next.splice(state.to, 0, id);
      // まず動かしていた行を、入る位置まで滑らせる
      const { to } = state;
      const targetTop = from < to ? tops[to] + heights[to] - heights[from] : tops[to];
      setDrag({ ...state, dy: targetTop - tops[from], releasing: true });
      // 滑り終わったら、並びの確定と、ずらしていた位置の解消を同じ描画で行う（そのときだけアニメーションを止める）
      window.setTimeout(() => {
        setSettling(true);
        setDrag(null);
        setDraft(next);
        requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
        void saveOrder(next);
      }, 160);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // ドラッグ中の各行のずらし量（動かしている行は指の移動量、ほかの行はよける分）
  const offsetOf = (index: number): number => {
    if (!drag) return 0;
    const { from, to, dy, heights } = drag;
    if (index === from) return dy;
    if (from < to && index > from && index <= to) return -heights[from];
    if (to < from && index >= to && index < from) return heights[from];
    return 0;
  };

  // キーボード: つまみを選んで ↑↓ で 1 つずつ動かす
  const onGripKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (busy || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const to = e.key === 'ArrowUp' ? index - 1 : index + 1;
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    [next[index], next[to]] = [next[to], next[index]];
    void saveOrder(next).then(() => {
      // 動かした項目のつまみを選んだままにする
      requestAnimationFrame(() => (listRef.current?.querySelector(`[data-grip="${next[to]}"]`) as HTMLElement | null)?.focus());
    });
  };

  return (
    <div>
      <ul ref={listRef} className="divide-y divide-line border border-line rounded-lg">
        {ids.map((id, index) => {
          const on = isVisible(id);
          const dragging = dragId === id;
          return (
            <li
              key={id}
              style={{ transform: `translateY(${offsetOf(index)}px)${dragging && !drag?.releasing ? ' scale(1.02)' : ''}` }}
              className={`relative flex items-center gap-2 pl-1.5 pr-4 py-3 bg-surface ${
                dragging
                  ? `z-10 shadow-xl ring-2 ring-accent rounded-lg ${drag?.releasing ? 'transition-transform duration-150 ease-out' : ''}`
                  : settling ? '' : 'transition-transform duration-200 ease-out'
              }`}
            >
              {/* つまみ（ドラッグ・↑↓ キーで並べ替え） */}
              <button
                type="button"
                data-grip={id}
                aria-label={`${LABELS[id]}の並び順（ドラッグか ↑↓ キーで動かす。今は ${index + 1} 番目）`}
                onPointerDown={(e) => onGripPointerDown(e, id)}
                onKeyDown={(e) => onGripKeyDown(e, index)}
                className={`w-8 h-10 flex-shrink-0 rounded-md flex items-center justify-center text-fg-subtle hover:text-fg hover:bg-surface-3 touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              >
                <MdDragIndicator size={22} />
              </button>
              <span className="flex-1 min-w-0 select-none">
                <span className="block text-[15px] font-semibold text-fg">{LABELS[id]}</span>
                <span className={`block text-xs ${on ? 'text-up' : 'text-fg-subtle'}`}>{on ? '全員に表示中' : '非表示（データは残っています）'}</span>
              </span>
              {/* 表示・非表示のスイッチ */}
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${LABELS[id]}を表示する`}
                disabled={busy === id}
                onClick={() => toggle(id, !on)}
                className={`relative flex-shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-accent-solid' : 'bg-surface-3 border border-line-strong'}`}
              >
                <span className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-fg-subtle">
        左のつまみをドラッグすると並び順が変わります（離した時点で全員に反映）。「設定」はいつもいちばん下に出ます。
      </p>
    </div>
  );
}
