/* src/components/ThemeToggle.tsx
 * テーマ切り替え。ヘッダー用のアイコンボタンと、設定画面用の3択を提供する。
 * 設定は Mantine が localStorage に保存する（端末ごと）。
 */
import { useEffect } from 'react';
import { useComputedColorScheme, useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import { FiMoon, FiSun, FiMonitor } from 'react-icons/fi';

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

// ヘッダーのボタンは 端末に合わせる → ライト → ダーク → 端末に合わせる… の順に切り替える（設定画面の3択と同じ並び）
const NEXT_SCHEME: Record<MantineColorScheme, MantineColorScheme> = { auto: 'light', light: 'dark', dark: 'auto' };
const SCHEME_LABEL: Record<MantineColorScheme, string> = { auto: '端末に合わせる', light: 'ライト', dark: 'ダーク' };

/** ヘッダー用: 押すたびにテーマを切り替えるボタン。アイコンは今のテーマを表す */
export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const next = NEXT_SCHEME[colorScheme];
  const label = `テーマ: ${SCHEME_LABEL[colorScheme]}（押すと${SCHEME_LABEL[next]}）`;
  const Icon = colorScheme === 'auto' ? FiMonitor : colorScheme === 'dark' ? FiMoon : FiSun;
  return (
    <button
      type="button"
      onClick={() => setColorScheme(next)}
      title={label}
      aria-label={label}
      className={`p-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface-3 transition-colors ${className}`}
    >
      <Icon size={18} />
    </button>
  );
}

const OPTIONS: { value: MantineColorScheme; label: string; icon: typeof FiSun }[] = [
  { value: 'auto', label: '端末に合わせる', icon: FiMonitor },
  { value: 'light', label: 'ライト', icon: FiSun },
  { value: 'dark', label: 'ダーク', icon: FiMoon },
];

/** 設定画面用: 端末に合わせる / ライト / ダーク の3択（選んだ瞬間に反映・この端末に保存） */
export function ThemeSelector() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <div role="radiogroup" aria-label="テーマ" className="inline-flex w-full sm:w-auto rounded-lg border border-line bg-surface-2 p-1">
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const selected = colorScheme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setColorScheme(value)}
            className={`flex flex-1 sm:flex-none items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm whitespace-nowrap transition-colors ${
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
