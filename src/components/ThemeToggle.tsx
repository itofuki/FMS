/* src/components/ThemeToggle.tsx
 * テーマ切り替え（ライト / ダーク）。ヘッダー用のアイコンボタンと、設定画面用の2択を提供する。
 * 設定は Mantine が localStorage に保存する（端末ごと）。
 */
import { useEffect } from 'react';
import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { FiMoon, FiSun } from 'react-icons/fi';

// 最上部の帯（slate-800 固定）と揃える
const THEME_COLOR = { light: '#1e293b', dark: '#1e293b' } as const;

/** ブラウザのアドレスバー等の色（meta theme-color）を現在のテーマに合わせる */
export function ThemeColorSync() {
  const computed = useComputedColorScheme('light');
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[computed]);
  }, [computed]);
  return null;
}

// テーマはライトとダークの 2 つ。まだ選んでいない人は、最初だけ端末の設定に合わせて表示する
// （Mantine の初期値 auto）。押した時点でライト／ダークのどちらかとして保存される。

/** ヘッダー用: ライト ⇔ ダーク を切り替えるボタン。アイコンは押した後のテーマを表す */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  const next = computed === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? 'ダークモードにする' : 'ライトモードにする';
  return (
    <button
      type="button"
      onClick={() => setColorScheme(next)}
      title={label}
      aria-label={label}
      className={`p-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors ${className}`}
    >
      {next === 'dark' ? <FiMoon size={18} /> : <FiSun size={18} />}
    </button>
  );
}

const OPTIONS: { value: 'light' | 'dark'; label: string; icon: typeof FiSun }[] = [
  { value: 'light', label: 'ライト', icon: FiSun },
  { value: 'dark', label: 'ダーク', icon: FiMoon },
];

/** 設定画面用: ライト / ダーク の 2 択（選んだ瞬間に反映・この端末に保存） */
export function ThemeSelector() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  return (
    <div role="radiogroup" aria-label="テーマ" className="inline-flex w-full sm:w-auto rounded-lg border border-line bg-surface-2 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = computed === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setColorScheme(value)}
            className={`flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
              selected ? 'bg-surface text-fg font-semibold shadow-sm' : 'text-fg-muted hover:text-fg'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
